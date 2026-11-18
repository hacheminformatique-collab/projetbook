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
        if ($action === 'create') {
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
            $subject = bookili_required_text($data, 'subject', 200);
            $body = bookili_required_text($data, 'body', 10000);
            if (preg_match('/[\r\n\x00-\x1f\x7f]/', $subject)) {
                bookili_json_response(422, ['error' => 'L’objet du courriel ne peut pas contenir de saut de ligne.']);
            }
            $pdo->beginTransaction();
            $count = (int) $pdo->query(
                "SELECT COUNT(*) FROM client_marketing_preferences mp
                 INNER JOIN accounts a ON a.id = mp.account_id
                 INNER JOIN client_profiles c ON c.account_id = a.id
                 WHERE mp.consent = 1 AND a.status = 'active'"
            )->fetchColumn();
            if ($count === 0 || $count > 5000) {
                $pdo->rollBack();
                bookili_json_response(422, ['error' => $count === 0
                    ? 'Aucun client actif n’a accepté les communications marketing.'
                    : 'Une campagne est limitée à 5 000 destinataires consentants. Réduisez son audience.']);
            }
            $now = bookili_now()->format('Y-m-d H:i:s');
            $pdo->prepare(
                "INSERT INTO marketing_campaigns (created_by, subject, message_body, status, created_at)
                 VALUES (:admin, :subject, :body, 'queued', :created)"
            )->execute(['admin' => $admin['id'], 'subject' => $subject, 'body' => $body, 'created' => $now]);
            $campaignId = (int) $pdo->lastInsertId();
            $statement = $pdo->query(
                "SELECT a.id, a.email FROM client_marketing_preferences mp
                 INNER JOIN accounts a ON a.id = mp.account_id
                 INNER JOIN client_profiles c ON c.account_id = a.id
                 WHERE mp.consent = 1 AND a.status = 'active' ORDER BY a.id"
            );
            $insert = $pdo->prepare(
                "INSERT INTO marketing_campaign_recipients (campaign_id, account_id, recipient, send_after)
                 VALUES (:campaign, :account, :recipient, :send_after)"
            );
            foreach ($statement->fetchAll() as $recipient) {
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
        bookili_json_response(422, ['error' => 'Action de campagne invalide.']);
    }

    $campaigns = $pdo->query(
        'SELECT c.id, c.subject, c.status, c.created_at, c.completed_at,
                COUNT(r.id) AS recipients,
                COALESCE(SUM(r.status = \'sent\'), 0) AS sent,
                COALESCE(SUM(r.status IN (\'queued\', \'retry\', \'sending\')), 0) AS pending,
                COALESCE(SUM(r.status = \'failed\'), 0) AS failed,
                COALESCE(SUM(r.status = \'cancelled\'), 0) AS cancelled
         FROM marketing_campaigns c
         LEFT JOIN marketing_campaign_recipients r ON r.campaign_id = c.id
         GROUP BY c.id ORDER BY c.id DESC LIMIT 50'
    )->fetchAll();
    $consentingClients = (int) $pdo->query(
        "SELECT COUNT(*) FROM client_marketing_preferences mp
         INNER JOIN accounts a ON a.id = mp.account_id
         WHERE mp.consent = 1 AND a.status = 'active'"
    )->fetchColumn();
    bookili_json_response(200, ['campaigns' => $campaigns, 'consentingClients' => $consentingClients]);
} catch (Throwable $error) {
    if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
    bookili_database_error($error);
}
