<?php
declare(strict_types=1);
require_once __DIR__ . '/booking.php';

function bookili_professional_client_detail(PDO $pdo, int $salonId, int $clientId, int $historyPage): never
{
    $statement = $pdo->prepare(
        'SELECT c.account_id AS id, c.first_name, c.last_name, c.phone_number, c.date_of_birth, a.email
         FROM client_profiles c INNER JOIN accounts a ON a.id = c.account_id AND a.role = \'client\'
         WHERE c.account_id = :client
           AND EXISTS (SELECT 1 FROM appointments b WHERE b.salon_id = :salon AND b.client_id = c.account_id)'
    );
    $statement->execute(['client' => $clientId, 'salon' => $salonId]);
    $client = $statement->fetch();
    if (!$client) bookili_json_response(404, ['error' => 'Client introuvable dans votre établissement.']);

    $now = bookili_now()->format('Y-m-d H:i:s');
    $statement = $pdo->prepare(
        "SELECT COUNT(*) AS appointment_count,
                COALESCE(SUM(status = 'confirmed'), 0) AS confirmed_count,
                COALESCE(SUM(status = 'no_show'), 0) AS no_show_count,
                COALESCE(SUM(status = 'cancelled'), 0) AS cancelled_count,
                MAX(CASE WHEN status = 'confirmed' AND ends_at <= :last_now THEN starts_at END) AS latest_visit,
                MIN(CASE WHEN status = 'confirmed' AND starts_at > :next_now THEN starts_at END) AS next_appointment
         FROM appointments WHERE salon_id = :salon AND client_id = :client"
    );
    $statement->execute([
        'last_now' => $now, 'next_now' => $now, 'salon' => $salonId, 'client' => $clientId,
    ]);
    $stats = $statement->fetch();

    $statement = $pdo->prepare(
        "SELECT COALESCE(SUM(cs.total_dzd), 0) AS total_spent_dzd,
                COALESCE(SUM(cs.collected_dzd), 0) AS total_collected_dzd,
                COALESCE(SUM(cs.gift_card_applied_dzd), 0) AS total_gift_card_dzd,
                COUNT(DISTINCT CASE WHEN b.status = 'confirmed' AND b.ends_at <= :visit_now THEN DATE(b.starts_at) END) AS paid_visit_days,
                MIN(CASE WHEN b.status = 'confirmed' AND b.ends_at <= :first_now THEN b.starts_at END) AS first_paid_visit,
                MAX(CASE WHEN b.status = 'confirmed' AND b.ends_at <= :last_now THEN b.starts_at END) AS last_paid_visit
         FROM appointments b
         INNER JOIN cash_sales cs ON cs.appointment_id = b.id AND cs.voided_at IS NULL
         WHERE b.salon_id = :salon AND b.client_id = :client AND cs.salon_id = b.salon_id"
    );
    $statement->execute(['salon' => $salonId, 'client' => $clientId, 'visit_now' => $now, 'first_now' => $now, 'last_now' => $now]);
    $activity = $statement->fetch();
    foreach (['total_spent_dzd', 'total_collected_dzd', 'total_gift_card_dzd', 'paid_visit_days'] as $field) {
        $client[$field] = (int) $activity[$field];
    }
    $client['last_paid_visit'] = $activity['last_paid_visit'];
    $client['average_visit_interval_days'] = null;
    if ($client['paid_visit_days'] > 1) {
        $first = bookili_calendar_date(substr($activity['first_paid_visit'], 0, 10));
        $last = bookili_calendar_date(substr($activity['last_paid_visit'], 0, 10));
        $client['average_visit_interval_days'] = round($first->diff($last)->days / ($client['paid_visit_days'] - 1), 1);
    }

    $statement = $pdo->prepare(
        'SELECT note, updated_at FROM professional_client_notes WHERE salon_id = :salon AND client_id = :client'
    );
    $statement->execute(['salon' => $salonId, 'client' => $clientId]);
    $note = $statement->fetch();
    $client['private_note'] = $note['note'] ?? '';
    $client['private_note_updated_at'] = $note['updated_at'] ?? null;
    $client['id'] = (int) $client['id'];
    foreach (['appointment_count', 'confirmed_count', 'cancelled_count', 'no_show_count'] as $field) $stats[$field] = (int) $stats[$field];
    $client += $stats;

    $statement = $pdo->prepare(
        'SELECT b.id, b.starts_at, b.ends_at, b.service_name, b.price_dzd, b.status,
                COALESCE(n.note, \'\') AS private_note, cs.total_dzd AS sale_total_dzd,
                cs.payment_method, cs.voided_at
         FROM appointments b
         LEFT JOIN appointment_private_notes n ON n.appointment_id = b.id
         LEFT JOIN cash_sales cs ON cs.appointment_id = b.id AND cs.salon_id = b.salon_id
         WHERE b.salon_id = :salon AND b.client_id = :client
         ORDER BY b.starts_at DESC, b.id DESC LIMIT 51 OFFSET ' . (($historyPage - 1) * 50)
    );
    $statement->execute(['salon' => $salonId, 'client' => $clientId]);
    $appointments = $statement->fetchAll();
    foreach ($appointments as &$appointment) {
        $appointment['id'] = (int) $appointment['id'];
        $appointment['price_dzd'] = (int) $appointment['price_dzd'];
        if ($appointment['sale_total_dzd'] !== null) $appointment['sale_total_dzd'] = (int) $appointment['sale_total_dzd'];
    }
    unset($appointment);
    bookili_json_response(200, [
        'client' => $client,
        'appointments' => array_slice($appointments, 0, 50),
        'historyPage' => $historyPage,
        'hasMoreHistory' => count($appointments) > 50,
    ]);
}

$method = bookili_booking_method();
$data = $method === 'POST' ? bookili_read_json() : [];

try {
    $pdo = bookili_database();
    $account = bookili_require_role($pdo, ['professional']);
    $salon = bookili_own_salon($pdo, (int) $account['id']);
    $salonId = (int) $salon['id'];

    if ($method === 'POST') {
        if (($data['action'] ?? '') !== 'save_note') {
            bookili_json_response(422, ['error' => 'Action de fiche client invalide.']);
        }
        $clientId = bookili_id($data['clientId'] ?? null);
        $note = $data['note'] ?? null;
        if (!is_string($note) || strlen($note) > 4000 || str_contains($note, "\0")) {
            bookili_json_response(422, ['error' => 'La note client doit contenir au maximum 4 000 octets.']);
        }
        bookili_rate_limit($pdo, 'professional-client-notes', 120);
        $pdo->beginTransaction();
        bookili_own_salon($pdo, (int) $account['id'], true);
        $statement = $pdo->prepare(
            'SELECT id FROM appointments WHERE salon_id = :salon AND client_id = :client ORDER BY id LIMIT 1 FOR UPDATE'
        );
        $statement->execute(['salon' => $salonId, 'client' => $clientId]);
        if (!$statement->fetchColumn()) {
            $pdo->rollBack();
            bookili_json_response(404, ['error' => 'Client introuvable dans votre établissement.']);
        }
        $updatedAt = bookili_now()->format('Y-m-d H:i:s');
        $pdo->prepare(
            'INSERT INTO professional_client_notes (salon_id, client_id, note, updated_at)
             VALUES (:salon, :client, :note, :updated)
             ON DUPLICATE KEY UPDATE note = VALUES(note), updated_at = VALUES(updated_at)'
        )->execute([
            'salon' => $salonId, 'client' => $clientId, 'note' => trim($note), 'updated' => $updatedAt,
        ]);
        $pdo->commit();
        bookili_json_response(200, ['message' => 'Note privée de la fiche client enregistrée.', 'updatedAt' => $updatedAt]);
    }

    if (isset($_GET['clientId'])) {
        $clientId = bookili_id($_GET['clientId']);
        $historyPage = isset($_GET['historyPage']) ? bookili_id($_GET['historyPage']) : 1;
        if ($historyPage > 10000) bookili_json_response(422, ['error' => 'Page d’historique invalide.']);
        bookili_professional_client_detail($pdo, $salonId, $clientId, $historyPage);
    }

    $page = isset($_GET['page']) ? bookili_id($_GET['page']) : 1;
    $queryInput = $_GET['q'] ?? '';
    if (!is_string($queryInput)) bookili_json_response(422, ['error' => 'Recherche invalide.']);
    $query = trim($queryInput);
    if (strlen($query) > 120 || ($query !== '' && strlen($query) < 2) || $page > 10000) {
        bookili_json_response(422, ['error' => 'Recherche invalide ou trop courte. Saisissez au moins 2 caractères.']);
    }
    $where = "b.salon_id = :salon AND b.status = 'confirmed'";
    $params = ['salon' => $salonId];
    if ($query !== '') {
        $phoneSearch = preg_match('/^[+0-9\s().-]+$/D', $query)
            ? preg_replace('/[^0-9+]/', '', $query)
            : $query;
        $where .= ' AND (LOCATE(:full_name, CONCAT(c.first_name, \' \', c.last_name)) > 0
                        OR LOCATE(:first_name, c.first_name) > 0 OR LOCATE(:last_name, c.last_name) > 0
                        OR LOCATE(:phone, REPLACE(c.phone_number, \' \', \'\')) > 0
                        OR LOCATE(:email, a.email) > 0)';
        $params += [
            'full_name' => $query, 'first_name' => $query, 'last_name' => $query,
            'phone' => $phoneSearch, 'email' => $query,
        ];
    }
    $statement = $pdo->prepare(
        "SELECT COUNT(DISTINCT b.client_id) FROM appointments b
         INNER JOIN client_profiles c ON c.account_id = b.client_id
         INNER JOIN accounts a ON a.id = c.account_id AND a.role = 'client'
         WHERE $where"
    );
    $statement->execute($params);
    $total = (int) $statement->fetchColumn();

    $statement = $pdo->prepare(
        "SELECT c.account_id AS id, c.first_name, c.last_name, c.phone_number, a.email,
                COUNT(*) AS appointment_count,
                MAX(CASE WHEN b.ends_at <= :latest_now THEN b.starts_at END) AS latest_visit
         FROM appointments b
         INNER JOIN client_profiles c ON c.account_id = b.client_id
         INNER JOIN accounts a ON a.id = c.account_id AND a.role = 'client'
         WHERE $where
         GROUP BY c.account_id, c.first_name, c.last_name, c.phone_number, a.email
         ORDER BY c.last_name, c.first_name, c.account_id LIMIT 51 OFFSET " . (($page - 1) * 50)
    );
    $statement->execute(['latest_now' => bookili_now()->format('Y-m-d H:i:s')] + $params);
    $clients = $statement->fetchAll();
    foreach ($clients as &$client) {
        foreach (['id', 'appointment_count'] as $field) $client[$field] = (int) $client[$field];
    }
    unset($client);
    bookili_json_response(200, [
        'clients' => array_slice($clients, 0, 50),
        'hasMore' => count($clients) > 50,
        'total' => $total,
        'page' => $page,
        'query' => $query,
    ]);
} catch (Throwable $error) {
    if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
    bookili_database_error($error);
}
