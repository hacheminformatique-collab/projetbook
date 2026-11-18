<?php
declare(strict_types=1);
require_once __DIR__ . '/booking.php';

$method = bookili_booking_method();
$data = $method === 'POST' ? bookili_read_json() : [];

try {
    $pdo = bookili_database();
    $admin = bookili_require_role($pdo, ['super_admin']);
    if ($method === 'POST') {
        $action = $data['action'] ?? null;
        $accountId = bookili_id($data['accountId'] ?? null);
        $reason = bookili_required_text($data, 'reason', 255);
        if (!in_array($action, ['suspend', 'restore'], true)) bookili_json_response(422, ['error' => 'Action invalide.']);
        if ($accountId === (int) $admin['id']) bookili_json_response(409, ['error' => 'Vous ne pouvez pas désactiver votre propre compte.']);
        $pdo->beginTransaction();
        $statement = $pdo->prepare('SELECT id, role, status FROM accounts WHERE id = :id FOR UPDATE');
        $statement->execute(['id' => $accountId]);
        $target = $statement->fetch();
        if (!$target || !in_array($target['role'], ['client', 'professional'], true)) {
            $pdo->rollBack();
            bookili_json_response(404, ['error' => 'Compte client ou professionnel introuvable.']);
        }
        $desired = $action === 'suspend' ? 'suspended' : 'active';
        if ($target['status'] === $desired) {
            $pdo->rollBack();
            bookili_json_response(409, ['error' => 'Le compte possède déjà ce statut.']);
        }
        if ($action === 'restore' && $target['role'] === 'professional') {
            $statement = $pdo->prepare(
                "SELECT 1 FROM professional_applications
                 WHERE account_id = :id AND status = 'approved' ORDER BY reviewed_at DESC LIMIT 1"
            );
            $statement->execute(['id' => $accountId]);
            if (!$statement->fetchColumn()) {
                $pdo->rollBack();
                bookili_json_response(409, ['error' => 'Une demande professionnelle approuvée est nécessaire avant la réactivation.']);
            }
        }
        $pdo->prepare('UPDATE accounts SET status = :status WHERE id = :id')
            ->execute(['status' => $desired, 'id' => $accountId]);
        $pdo->prepare(
            'INSERT INTO admin_account_events (account_id, admin_id, old_status, new_status, reason, created_at)
             VALUES (:account, :admin, :old_status, :new_status, :reason, :created_at)'
        )->execute([
            'account' => $accountId, 'admin' => $admin['id'], 'old_status' => $target['status'],
            'new_status' => $desired, 'reason' => $reason, 'created_at' => bookili_now()->format('Y-m-d H:i:s'),
        ]);
        $pdo->commit();
        bookili_json_response(200, ['status' => $desired, 'message' => $desired === 'suspended' ? 'Compte suspendu. Ses sessions ne pourront plus accéder aux espaces protégés.' : 'Compte réactivé.']);
    }

    $query = $_GET['q'] ?? '';
    $role = $_GET['role'] ?? 'all';
    $status = $_GET['status'] ?? 'all';
    $page = isset($_GET['page']) ? bookili_id($_GET['page']) : 1;
    if (!is_string($query) || strlen($query) > 180 || !in_array($role, ['all', 'client', 'professional'], true)
        || !in_array($status, ['all', 'active', 'pending', 'suspended'], true) || $page > 10000) {
        bookili_json_response(422, ['error' => 'Filtres de comptes invalides.']);
    }
    $where = "a.role IN ('client', 'professional')";
    $params = [];
    if ($role !== 'all') {
        $where .= ' AND a.role = :role';
        $params['role'] = $role;
    }
    if ($status !== 'all') {
        $where .= ' AND a.status = :status';
        $params['status'] = $status;
    }
    if (trim($query) !== '') {
        $where .= ' AND (LOCATE(:email_q, a.email) > 0 OR LOCATE(:name_q, COALESCE(c.first_name, \'\')) > 0
                    OR LOCATE(:last_q, COALESCE(c.last_name, \'\')) > 0 OR LOCATE(:business_q, COALESCE(pa.business_name, \'\')) > 0)';
        $params['email_q'] = $params['name_q'] = $params['last_q'] = $params['business_q'] = trim($query);
    }
    $statement = $pdo->prepare(
        'SELECT a.id, a.email, a.role, a.status, a.created_at, c.first_name, c.last_name,
                pa.business_name, s.status AS subscription_status
         FROM accounts a
         LEFT JOIN client_profiles c ON c.account_id = a.id
         LEFT JOIN professional_applications pa ON pa.id = (
           SELECT MAX(pa2.id) FROM professional_applications pa2 WHERE pa2.account_id = a.id
         )
         LEFT JOIN professional_profiles pp ON pp.account_id = a.id
         LEFT JOIN professional_subscriptions s ON s.professional_profile_id = pp.id
         WHERE ' . $where . ' ORDER BY a.created_at DESC, a.id DESC LIMIT 51 OFFSET ' . (($page - 1) * 50)
    );
    $statement->execute($params);
    $accounts = $statement->fetchAll();
    bookili_json_response(200, ['accounts' => array_slice($accounts, 0, 50), 'hasMore' => count($accounts) > 50]);
} catch (Throwable $error) {
    if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
    bookili_database_error($error);
}
