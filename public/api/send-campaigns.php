<?php
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require_once __DIR__ . '/booking.php';
require_once __DIR__ . '/mailer.php';

try {
    $configuration = bookili_configuration();
    $sender = $configuration['mail_from'] ?? '';
    if (!is_string($sender) || filter_var($sender, FILTER_VALIDATE_EMAIL) === false
        || preg_match('/[\r\n\x00-\x20\x7f]/', $sender)) {
        throw new RuntimeException('Set a valid mail_from address in the private BOOKILI configuration.');
    }
    $publicUrl = $configuration['public_url'] ?? '';
    $parts = is_string($publicUrl) ? parse_url($publicUrl) : false;
    if (!is_array($parts) || ($parts['scheme'] ?? '') !== 'https' || empty($parts['host'])
        || isset($parts['query']) || isset($parts['fragment']) || isset($parts['user']) || isset($parts['pass'])) {
        throw new RuntimeException('Set public_url to the HTTPS root URL of BOOKILI in the private configuration.');
    }
    $unsubscribeBase = rtrim($publicUrl, '/') . '/api/unsubscribe.php?token=';
    $pdo = bookili_database();
    $now = bookili_now();
    $nowText = $now->format('Y-m-d H:i:s');
    $expiredLease = $now->modify('-15 minutes')->format('Y-m-d H:i:s');

    $pdo->beginTransaction();
    $statement = $pdo->prepare(
        "UPDATE marketing_campaign_recipients
         SET status = CASE WHEN attempts >= 5 THEN 'failed' ELSE 'retry' END, locked_at = NULL,
             last_error = CASE WHEN attempts >= 5 THEN 'Envoi interrompu cinq fois.' ELSE last_error END
         WHERE status = 'sending' AND locked_at < :expired"
    );
    $statement->execute(['expired' => $expiredLease]);
    $statement = $pdo->prepare(
        "SELECT r.id, r.account_id, r.campaign_id, r.recipient, r.attempts,
                c.subject, c.message_body
         FROM marketing_campaign_recipients r
         INNER JOIN marketing_campaigns c ON c.id = r.campaign_id
         WHERE r.status IN ('queued', 'retry') AND r.attempts < 5 AND r.send_after <= :now
           AND c.status IN ('queued', 'sending')
         ORDER BY r.id LIMIT 25 FOR UPDATE"
    );
    $statement->execute(['now' => $nowText]);
    $recipients = $statement->fetchAll();
    $claim = $pdo->prepare(
        "UPDATE marketing_campaign_recipients
         SET status = 'sending', locked_at = :now, attempts = attempts + 1
         WHERE id = :id AND status IN ('queued', 'retry')"
    );
    foreach ($recipients as &$recipient) {
        $claim->execute(['now' => $nowText, 'id' => $recipient['id']]);
        $recipient['claimed'] = $claim->rowCount() === 1;
        if ($recipient['claimed']) {
            $recipient['attempts'] = (int) $recipient['attempts'] + 1;
            $pdo->prepare("UPDATE marketing_campaigns SET status = 'sending' WHERE id = :id AND status = 'queued'")
                ->execute(['id' => $recipient['campaign_id']]);
        }
    }
    unset($recipient);
    $pdo->commit();

    $sent = 0;
    $retried = 0;
    $skipped = 0;
    foreach ($recipients as $recipient) {
        if (!$recipient['claimed']) continue;
        $pdo->beginTransaction();
        try {
            $statement = $pdo->prepare(
                'SELECT mp.consent, a.status FROM client_marketing_preferences mp
                 INNER JOIN accounts a ON a.id = mp.account_id
                 WHERE mp.account_id = :account FOR UPDATE'
            );
            $statement->execute(['account' => $recipient['account_id']]);
            $preference = $statement->fetch();
            // A lease can be recovered while this worker waits for the preference lock.
            $statement = $pdo->prepare(
                "SELECT id FROM marketing_campaign_recipients
                 WHERE id = :id AND status = 'sending' AND attempts = :attempts AND locked_at = :locked_at FOR UPDATE"
            );
            $statement->execute(['id' => $recipient['id'], 'attempts' => $recipient['attempts'], 'locked_at' => $nowText]);
            if (!$statement->fetch()) {
                $pdo->commit();
                $skipped++;
                continue;
            }
            if (!$preference || (int) $preference['consent'] !== 1 || $preference['status'] !== 'active') {
                $pdo->prepare("UPDATE marketing_campaign_recipients SET status = 'cancelled', locked_at = NULL WHERE id = :id")
                    ->execute(['id' => $recipient['id']]);
                $pdo->commit();
                $skipped++;
                continue;
            }

            $token = bin2hex(random_bytes(32));
            $pdo->prepare(
                'INSERT INTO marketing_unsubscribe_tokens (recipient_id, token_hash, created_at)
                 VALUES (:recipient, :hash, :created)'
            )->execute([
                'recipient' => $recipient['id'], 'hash' => hash('sha256', $token),
                'created' => $nowText,
            ]);
            $body = $recipient['message_body'] . "\n\n---\n"
                . "Vous recevez cet e-mail car vous avez accepté les communications marketing BOOKILI.\n"
                . "Pour vous désinscrire : " . $unsubscribeBase . $token;
            bookili_send_email([
                'recipient' => $recipient['recipient'],
                'subject' => $recipient['subject'],
                'message_body' => $body,
            ], $sender);
            $pdo->prepare(
                "UPDATE marketing_campaign_recipients
                 SET status = 'sent', sent_at = :sent, locked_at = NULL, last_error = NULL
                 WHERE id = :id AND status = 'sending'"
            )->execute(['sent' => $nowText, 'id' => $recipient['id']]);
            $pdo->commit();
            $sent++;
        } catch (Throwable $mailError) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            error_log('BOOKILI campaign recipient ' . $recipient['id'] . ' delivery failed: ' . $mailError->getMessage());
            $attempt = (int) $recipient['attempts'];
            $backoff = [15, 60, 360, 1440][min(max($attempt - 1, 0), 3)];
            $status = $attempt >= 5 ? 'failed' : 'retry';
            $pdo->prepare(
                'UPDATE marketing_campaign_recipients
                 SET status = :status, send_after = :send_after, locked_at = NULL, last_error = :error
                 WHERE id = :id AND status = \'sending\' AND attempts = :attempts AND locked_at = :locked_at'
            )->execute([
                'status' => $status,
                'send_after' => $now->modify('+' . $backoff . ' minutes')->format('Y-m-d H:i:s'),
                'error' => 'Échec de préparation ou d’envoi de l’e-mail (tentative ' . $attempt . '/5).',
                'id' => $recipient['id'],
                'attempts' => $attempt,
                'locked_at' => $nowText,
            ]);
            if ($status === 'retry') $retried++;
        }
    }

    $pdo->prepare(
        "UPDATE marketing_campaigns AS campaign SET status = 'completed', completed_at = :completed
         WHERE campaign.status IN ('queued', 'sending')
           AND EXISTS (SELECT 1 FROM marketing_campaign_recipients r WHERE r.campaign_id = campaign.id)
           AND NOT EXISTS (
             SELECT 1 FROM marketing_campaign_recipients r
             WHERE r.campaign_id = campaign.id AND r.status IN ('queued', 'sending', 'retry')
           )"
    )->execute(['completed' => $nowText]);
    fwrite(STDOUT, "BOOKILI : {$sent} message(s) envoyé(s), {$retried} en attente de reprise, {$skipped} traitement(s) ignoré(s).\n");
    exit(0);
} catch (Throwable $error) {
    if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
    error_log('BOOKILI campaign worker failed: ' . $error->getMessage());
    fwrite(STDERR, "BOOKILI : le traitement des campagnes a échoué. Vérifiez le journal PHP.\n");
    exit(1);
}
