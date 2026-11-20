<?php
declare(strict_types=1);
require_once __DIR__ . '/booking.php';
require_once __DIR__ . '/mailer.php';

$method = bookili_booking_method();
$data = $method === 'POST' ? bookili_read_json() : [];

function bookili_campaign_replay(PDO $pdo, string $key, int $adminId, string $subject, string $body, int $count): bool
{
    $statement = $pdo->prepare(
        'SELECT id, created_by, subject, message_body, expected_recipients FROM marketing_campaigns WHERE request_key = ?'
    );
    $statement->execute([$key]);
    $campaign = $statement->fetch();
    if (!$campaign) return false;
    if ((int) $campaign['created_by'] !== $adminId || $campaign['subject'] !== $subject
        || $campaign['message_body'] !== $body || (int) $campaign['expected_recipients'] !== $count) {
        bookili_json_response(409, ['code' => 'campaign_request_conflict', 'error' => 'Cette demande correspond à une autre campagne. Consultez l’historique avant de continuer.']);
    }
    bookili_json_response(200, [
        'campaignId' => (int) $campaign['id'], 'recipients' => $count,
        'message' => 'Campagne déjà enregistrée. Consultez son statut dans l’historique.',
    ]);
}

try {
    $pdo = bookili_database();
    $admin = bookili_require_role($pdo, ['super_admin']);
    if ($method === 'POST') {
        $action = $data['action'] ?? null;
        if (in_array($action, ['preview', 'create'], true)) {
            $subject = bookili_required_text($data, 'subject', 200);
            $body = bookili_required_text($data, 'body', 10000);
            if (preg_match('/[\r\n\x00-\x1f\x7f]/', $subject)) {
                bookili_json_response(422, ['error' => 'L’objet du courriel ne peut pas contenir de saut de ligne.']);
            }
            if ($action === 'create') {
                $requestKey = $data['requestKey'] ?? null;
                if (!is_string($requestKey) || !preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/D', $requestKey)) {
                    bookili_json_response(422, ['error' => 'Demande de campagne invalide. Rechargez le formulaire.']);
                }
                if (!is_int($data['expectedRecipients'] ?? null) || $data['expectedRecipients'] < 1 || $data['expectedRecipients'] > 5000) {
                    bookili_json_response(422, ['error' => 'Vérifiez l’aperçu et le nombre de destinataires avant de confirmer.']);
                }
                bookili_campaign_replay($pdo, $requestKey, (int) $admin['id'], $subject, $body, $data['expectedRecipients']);
            }
            $configuration = bookili_configuration();
            $publicUrl = $configuration['public_url'] ?? '';
            $urlParts = is_string($publicUrl) ? parse_url($publicUrl) : false;
            $sender = $configuration['mail_from'] ?? '';
            if (!is_array($urlParts) || ($urlParts['scheme'] ?? '') !== 'https' || empty($urlParts['host'])
                || isset($urlParts['query']) || isset($urlParts['fragment']) || isset($urlParts['user']) || isset($urlParts['pass'])
                || !is_string($sender) || filter_var($sender, FILTER_VALIDATE_EMAIL) === false
                || preg_match('/[\r\n\x00-\x20\x7f]/', $sender)) {
                bookili_json_response(503, ['error' => 'Configurez une adresse e-mail d’expédition et public_url en HTTPS avant de créer une campagne.']);
            }
            if ($action === 'preview') {
                $count = (int) $pdo->query(
                "SELECT COUNT(*) FROM client_marketing_preferences mp
                 INNER JOIN accounts a ON a.id = mp.account_id
                 INNER JOIN client_profiles c ON c.account_id = a.id
                 WHERE mp.consent = 1 AND a.status = 'active'"
                )->fetchColumn();
                bookili_json_response(200, [
                    'subject' => $subject, 'body' => $body, 'recipients' => $count,
                    'previewBody' => bookili_campaign_message(
                        $body, rtrim($publicUrl, '/') . '/api/unsubscribe.php?token=[lien-personnel]'
                    ),
                ]);
            }
            $pdo->beginTransaction();
            $now = bookili_now()->format('Y-m-d H:i:s');
            try {
                $pdo->prepare(
                    "INSERT INTO marketing_campaigns (created_by, subject, message_body, request_key, expected_recipients, status, created_at)
                     VALUES (:admin, :subject, :body, :request_key, :expected, 'queued', :created)"
                )->execute([
                    'admin' => $admin['id'], 'subject' => $subject, 'body' => $body,
                    'request_key' => $requestKey, 'expected' => $data['expectedRecipients'], 'created' => $now,
                ]);
            } catch (PDOException $error) {
                if ((int) ($error->errorInfo[1] ?? 0) !== 1062) throw $error;
                $pdo->rollBack();
                if (!bookili_campaign_replay($pdo, $requestKey, (int) $admin['id'], $subject, $body, $data['expectedRecipients'])) throw $error;
            }
            $campaignId = (int) $pdo->lastInsertId();
            $recipients = $pdo->query(
                "SELECT a.id, a.email FROM client_marketing_preferences mp
                 INNER JOIN accounts a ON a.id = mp.account_id
                 INNER JOIN client_profiles c ON c.account_id = a.id
                 WHERE mp.consent = 1 AND a.status = 'active' ORDER BY a.id LIMIT 5001"
            )->fetchAll();
            $count = count($recipients);
            if ($count !== $data['expectedRecipients']) {
                $pdo->rollBack();
                bookili_json_response(409, [
                    'code' => 'campaign_audience_changed',
                    'error' => 'Le nombre de destinataires a changé. Vérifiez un nouvel aperçu avant de confirmer.',
                ]);
            }
            $insert = $pdo->prepare(
                "INSERT INTO marketing_campaign_recipients (campaign_id, account_id, recipient, send_after)
                 VALUES (:campaign, :account, :recipient, :send_after)"
            );
            foreach ($recipients as $recipient) {
                $insert->execute([
                    'campaign' => $campaignId, 'account' => $recipient['id'],
                    'recipient' => $recipient['email'], 'send_after' => $now,
                ]);
            }
            $pdo->commit();
            bookili_json_response(201, ['campaignId' => $campaignId, 'recipients' => $count, 'message' => 'Campagne mise en file pour les clients ayant donné leur accord.']);
        }
        if ($action === 'cancel') {
            $campaignId = bookili_id($data['campaignId'] ?? null);
            $pdo->beginTransaction();
            $statement = $pdo->prepare('SELECT status FROM marketing_campaigns WHERE id = :id FOR UPDATE');
            $statement->execute(['id' => $campaignId]);
            $status = $statement->fetchColumn();
            if ($status === false) {
                $pdo->rollBack();
                bookili_json_response(404, ['error' => 'Campagne introuvable.']);
            }
            if ($status !== 'queued') {
                $pdo->rollBack();
                bookili_json_response(409, ['error' => 'Seules les campagnes qui n’ont pas commencé peuvent être annulées.']);
            }
            $pdo->prepare("UPDATE marketing_campaigns SET status = 'cancelled' WHERE id = :id")->execute(['id' => $campaignId]);
            $pdo->prepare(
                "UPDATE marketing_campaign_recipients SET status = 'cancelled'
                 WHERE campaign_id = :id AND status IN ('queued', 'retry')"
            )->execute(['id' => $campaignId]);
            $pdo->commit();
            bookili_json_response(200, ['message' => 'Campagne annulée.']);
        }
        if ($action === 'retry-failed') {
            $campaignId = bookili_id($data['campaignId'] ?? null);
            $pdo->beginTransaction();
            $statement = $pdo->prepare('SELECT status FROM marketing_campaigns WHERE id = :id FOR UPDATE');
            $statement->execute(['id' => $campaignId]);
            $status = $statement->fetchColumn();
            if ($status === false) {
                $pdo->rollBack();
                bookili_json_response(404, ['error' => 'Campagne introuvable.']);
            }
            if ($status === 'cancelled') {
                $pdo->rollBack();
                bookili_json_response(409, ['error' => 'Une campagne annulée ne peut pas être relancée.']);
            }
            $statement = $pdo->prepare(
                "UPDATE marketing_campaign_recipients SET status = 'retry', attempts = 0, send_after = :now,
                 locked_at = NULL, last_error = NULL WHERE campaign_id = :id AND status = 'failed'"
            );
            $statement->execute(['id' => $campaignId, 'now' => bookili_now()->format('Y-m-d H:i:s')]);
            $retried = $statement->rowCount();
            if ($retried === 0) {
                $pdo->rollBack();
                bookili_json_response(409, ['error' => 'Cette campagne ne comporte plus d’e-mails en échec. Actualisez la liste.']);
            }
            if ($status === 'completed') {
                $pdo->prepare("UPDATE marketing_campaigns SET status = 'sending', completed_at = NULL WHERE id = :id")
                    ->execute(['id' => $campaignId]);
            }
            $pdo->commit();
            bookili_json_response(200, [
                'retried' => $retried,
                'message' => $retried . ' e-mail(s) remis en attente. Le consentement sera vérifié avant l’envoi.',
            ]);
        }
        bookili_json_response(422, ['error' => 'Action de campagne invalide.']);
    }

    $page = isset($_GET['page']) ? bookili_id($_GET['page']) : 1;
    $query = $_GET['q'] ?? '';
    $status = $_GET['status'] ?? 'all';
    if ($page > 10000 || !is_string($query) || strlen($query) > 800 || preg_match('//u', $query) !== 1
        || preg_match('/[\x00-\x1f\x7f]/', $query)
        || !in_array($status, ['all', 'queued', 'sending', 'completed', 'cancelled'], true)) {
        bookili_json_response(422, ['error' => 'Filtres de campagnes invalides.']);
    }
    $where = [];
    $params = [];
    if (trim($query) !== '') {
        $where[] = 'LOCATE(:query, c.subject) > 0';
        $params['query'] = trim($query);
    }
    if ($status !== 'all') {
        $where[] = 'c.status = :status';
        $params['status'] = $status;
    }
    $statement = $pdo->prepare(
        'SELECT c.id, c.subject, c.status, c.created_at, c.completed_at,
                COUNT(r.id) AS recipients,
                COALESCE(SUM(r.status = \'sent\'), 0) AS sent,
                COALESCE(SUM(r.status IN (\'queued\', \'retry\', \'sending\')), 0) AS pending,
                COALESCE(SUM(r.status = \'retry\'), 0) AS retrying,
                COALESCE(SUM(r.status = \'failed\'), 0) AS failed,
                COALESCE(SUM(r.status = \'cancelled\'), 0) AS cancelled,
                MIN(CASE WHEN r.status = \'retry\' THEN r.send_after END) AS next_retry
         FROM marketing_campaigns c
         LEFT JOIN marketing_campaign_recipients r ON r.campaign_id = c.id
         ' . ($where ? 'WHERE ' . implode(' AND ', $where) : '') . '
         GROUP BY c.id ORDER BY c.id DESC LIMIT 51 OFFSET ' . (($page - 1) * 50)
    );
    $statement->execute($params);
    $campaigns = $statement->fetchAll();
    $consentingClients = (int) $pdo->query(
        "SELECT COUNT(*) FROM client_marketing_preferences mp
         INNER JOIN accounts a ON a.id = mp.account_id
         INNER JOIN client_profiles c ON c.account_id = a.id
         WHERE mp.consent = 1 AND a.status = 'active'"
    )->fetchColumn();
    bookili_json_response(200, [
        'campaigns' => array_slice($campaigns, 0, 50), 'hasMore' => count($campaigns) > 50,
        'consentingClients' => $consentingClients,
    ]);
} catch (Throwable $error) {
    if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
    bookili_database_error($error);
}
