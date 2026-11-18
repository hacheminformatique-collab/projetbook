<?php
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require_once __DIR__ . '/booking.php';

function bookili_send_queued_email(PDO $pdo, array $email, string $sender): void
{
    $fromName = bookili_configuration()['mail_from_name'] ?? 'BOOKILI';
    if (!is_string($fromName) || trim($fromName) === '' || strlen($fromName) > 100
        || preg_match('/[\r\n\x00-\x1f\x7f]/', $fromName)) {
        throw new RuntimeException('The configured sender name is invalid.');
    }

    $headers = [
        'From: =?UTF-8?B?' . base64_encode($fromName) . '?= <' . $sender . '>',
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: 8bit',
        'X-Mailer: BOOKILI',
    ];
    $subject = '=?UTF-8?B?' . base64_encode($email['subject']) . '?=';
    if (!@mail($email['recipient'], $subject, $email['message_body'], implode("\r\n", $headers), '-f' . $sender)) {
        throw new RuntimeException('The configured mail transport rejected a notification.');
    }
}

try {
    $configuration = bookili_configuration();
    $sender = $configuration['mail_from'] ?? '';
    if (!is_string($sender) || filter_var($sender, FILTER_VALIDATE_EMAIL) === false
        || preg_match('/[\r\n\x00-\x20\x7f]/', $sender)) {
        throw new RuntimeException('Set a valid mail_from address in the private BOOKILI configuration.');
    }

    $pdo = bookili_database();
    $now = bookili_now();
    $nowText = $now->format('Y-m-d H:i:s');
    $expiredLease = $now->modify('-15 minutes')->format('Y-m-d H:i:s');

    $pdo->beginTransaction();
    $statement = $pdo->prepare(
        "UPDATE notification_outbox
         SET status = CASE WHEN attempts >= 5 THEN 'failed' ELSE 'retry' END, locked_at = NULL,
             last_error = CASE WHEN attempts >= 5 THEN 'Envoi interrompu cinq fois.' ELSE last_error END
         WHERE status = 'sending' AND locked_at < :expired_lease"
    );
    $statement->execute(['expired_lease' => $expiredLease]);

    $statement = $pdo->prepare(
        "SELECT id, appointment_id, appointment_version, kind, recipient, subject, message_body, attempts
         FROM notification_outbox
         WHERE status IN ('queued', 'retry') AND send_after <= :now AND attempts < 5
         ORDER BY send_after, id LIMIT 25 FOR UPDATE"
    );
    $statement->execute(['now' => $nowText]);
    $emails = $statement->fetchAll();
    $claim = $pdo->prepare(
        "UPDATE notification_outbox SET status = 'sending', locked_at = :now, attempts = attempts + 1
         WHERE id = :id AND status IN ('queued', 'retry')"
    );
    foreach ($emails as &$email) {
        $claim->execute(['now' => $nowText, 'id' => $email['id']]);
        if ($claim->rowCount() !== 1) {
            $email['claimed'] = false;
        } else {
            $email['claimed'] = true;
            $email['attempts'] = (int) $email['attempts'] + 1;
        }
    }
    unset($email);
    $pdo->commit();

    $sent = 0;
    $retried = 0;
    $skipped = 0;
    foreach ($emails as $email) {
        if (!$email['claimed']) continue;
        $pdo->beginTransaction();
        try {
            $statement = $pdo->prepare(
                'SELECT status, notification_version, starts_at FROM appointments WHERE id = :id FOR UPDATE'
            );
            $statement->execute(['id' => $email['appointment_id']]);
            $appointment = $statement->fetch();
            $matchesVersion = $appointment && (int) $appointment['notification_version'] === (int) $email['appointment_version'];
            $isReminder = str_starts_with($email['kind'], 'reminder_');
            $shouldSend = $matchesVersion && (
                $email['kind'] === 'cancelled'
                    ? $appointment['status'] === 'cancelled'
                    : $appointment['status'] === 'confirmed'
                        && (!$isReminder || $appointment['starts_at'] > $nowText)
            );
            if (!$shouldSend) {
                $pdo->prepare(
                    "UPDATE notification_outbox SET status = 'cancelled', locked_at = NULL
                     WHERE id = :id AND status = 'sending'"
                )->execute(['id' => $email['id']]);
                $pdo->commit();
                $skipped++;
                continue;
            }

            bookili_send_queued_email($pdo, $email, $sender);
            $pdo->prepare(
                "UPDATE notification_outbox SET status = 'sent', sent_at = :sent_at, locked_at = NULL, last_error = NULL
                 WHERE id = :id AND status = 'sending'"
            )->execute(['sent_at' => $nowText, 'id' => $email['id']]);
            $pdo->commit();
            $sent++;
        } catch (Throwable $mailError) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            error_log('BOOKILI notification ' . $email['id'] . ' delivery failed: ' . $mailError->getMessage());
            $attempt = (int) $email['attempts'];
            $backoff = [15, 60, 360, 1440][min(max($attempt - 1, 0), 3)];
            $status = $attempt >= 5 ? 'failed' : 'retry';
            $retryAt = $now->modify('+' . $backoff . ' minutes')->format('Y-m-d H:i:s');
            $pdo->prepare(
                'UPDATE notification_outbox
                 SET status = :status, send_after = :send_after, locked_at = NULL, last_error = :last_error
                 WHERE id = :id AND status = \'sending\''
            )->execute([
                'status' => $status,
                'send_after' => $retryAt,
                'last_error' => 'Échec du transport e-mail (tentative ' . $attempt . '/5).',
                'id' => $email['id'],
            ]);
            if ($status === 'retry') $retried++;
        }
    }

    fwrite(STDOUT, "BOOKILI : {$sent} envoyé(s), {$retried} en attente de reprise, {$skipped} obsolète(s).\n");
    exit(0);
} catch (Throwable $error) {
    error_log('BOOKILI notification worker failed: ' . $error->getMessage());
    fwrite(STDERR, "BOOKILI : le traitement des e-mails a échoué. Vérifiez le journal PHP.\n");
    exit(1);
}
