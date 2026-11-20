<?php
declare(strict_types=1);

// Run after professional-agenda.py, exclusively on the same disposable database.
if (getenv('BOOKILI_DISPOSABLE_TEST') !== '1') {
    throw new RuntimeException('This test requires a disposable database.');
}
require_once __DIR__ . '/../public/api/booking.php';

function check(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

function startWorker(): array
{
    $process = proc_open(
        [PHP_BINARY, '-d', 'sendmail_path=' . __DIR__ . '/fake-sendmail.sh', __DIR__ . '/../public/api/send-notifications.php'],
        [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']],
        $pipes
    );
    if (!is_resource($process)) throw new RuntimeException('Cannot start the notification worker.');
    fclose($pipes[0]);
    return [$process, $pipes[1], $pipes[2]];
}

function finishWorker(array $worker): string
{
    [$process, $stdout, $stderr] = $worker;
    $output = stream_get_contents($stdout);
    $errors = stream_get_contents($stderr);
    fclose($stdout);
    fclose($stderr);
    $exit = proc_close($process);
    check($exit === 0, 'Notification worker failed: ' . $errors);
    return $output;
}

function row(PDO $pdo, int $id): array
{
    $statement = $pdo->prepare('SELECT * FROM notification_outbox WHERE id = ?');
    $statement->execute([$id]);
    $result = $statement->fetch();
    if (!$result) throw new RuntimeException('Missing notification.');
    return $result;
}

function awaitAttempts(PDO $pdo, int $id, int $attempts): void
{
    for ($i = 0; $i < 200; $i++) {
        $notification = row($pdo, $id);
        if ($notification['status'] === 'sending' && (int) $notification['attempts'] === $attempts) return;
        usleep(50000);
    }
    throw new RuntimeException("Worker did not claim notification {$id} on attempt {$attempts}.");
}

$mailbox = tempnam(sys_get_temp_dir(), 'bookili-worker-test-');
if ($mailbox === false) throw new RuntimeException('Cannot create a test mailbox.');
putenv('BOOKILI_TEST_MAILBOX=' . $mailbox);
putenv('BOOKILI_TEST_MAIL_FAIL=0');
$pdo = bookili_database();
$lockPdo = bookili_database();
$workers = [];
try {
    $candidates = $pdo->query(
        "SELECT n.id, n.appointment_id, n.kind, n.appointment_version, b.notification_version, b.status AS appointment_status, b.service_name
         FROM notification_outbox n INNER JOIN appointments b ON b.id = n.appointment_id
         WHERE n.status = 'queued' ORDER BY n.id"
    )->fetchAll();
    $find = static function (callable $predicate) use ($candidates): array {
        foreach ($candidates as $candidate) if ($predicate($candidate)) return $candidate;
        throw new RuntimeException('Expected test notification was not found.');
    };
    $valid = static fn(array $n): bool => (int) $n['appointment_version'] === (int) $n['notification_version'];
    $confirmation = $find(static fn(array $n): bool => $valid($n) && $n['kind'] === 'confirmation' && $n['appointment_status'] === 'confirmed' && $n['service_name'] === 'Coupe + Soin');
    $rescheduled = $find(static fn(array $n): bool => $valid($n) && $n['kind'] === 'rescheduled' && $n['appointment_status'] === 'confirmed' && $n['service_name'] === 'Coupe + Soin');
    $cancelled = $find(static fn(array $n): bool => $valid($n) && $n['kind'] === 'cancelled' && $n['appointment_status'] === 'cancelled');
    $obsolete = $find(static fn(array $n): bool => !$valid($n) && $n['kind'] === 'confirmation');
    $reminder = $find(static fn(array $n): bool => $valid($n) && $n['kind'] === 'reminder_1d' && $n['appointment_status'] === 'confirmed');
    $retry = $find(static fn(array $n): bool => $valid($n) && $n['kind'] === 'reminder_7d' && $n['appointment_status'] === 'confirmed');
    $race = $find(static fn(array $n): bool => $valid($n) && $n['kind'] === 'reminder_7d'
        && $n['appointment_status'] === 'confirmed' && $n['id'] !== $retry['id']);

    $schedule = $pdo->prepare(
        "SELECT n.kind, n.send_after,
                CASE n.kind WHEN 'reminder_7d' THEN DATE_SUB(b.starts_at, INTERVAL 7 DAY)
                            ELSE DATE_SUB(b.starts_at, INTERVAL 1 DAY) END AS expected
         FROM notification_outbox n INNER JOIN appointments b ON b.id = n.appointment_id
         WHERE n.appointment_id = ? AND n.appointment_version = b.notification_version
           AND n.kind IN ('reminder_7d', 'reminder_1d') AND n.status = 'queued'"
    );
    $schedule->execute([$confirmation['appointment_id']]);
    $reminders = $schedule->fetchAll();
    check(count($reminders) === 2, 'The two reminders were not scheduled.');
    foreach ($reminders as $item) check($item['send_after'] === $item['expected'], 'Reminder scheduled at the wrong time.');

    $pdo->exec("UPDATE notification_outbox SET send_after = '9999-12-31 23:59:59' WHERE status IN ('queued', 'retry')");
    $due = $pdo->prepare("UPDATE notification_outbox SET send_after = '2000-01-01 00:00:00' WHERE id = ?");
    foreach ([$confirmation, $rescheduled, $cancelled, $obsolete, $reminder] as $n) $due->execute([$n['id']]);
    finishWorker(startWorker());
    foreach ([$confirmation, $rescheduled, $cancelled, $reminder] as $n) {
        check(row($pdo, (int) $n['id'])['status'] === 'sent', 'A current notification was not delivered.');
    }
    check(row($pdo, (int) $obsolete['id'])['status'] === 'cancelled', 'An obsolete notification was delivered.');
    $captured = file_get_contents($mailbox);
    check(substr_count($captured, '--- BOOKILI TEST MESSAGE ---') === 4, 'Unexpected number of delivered messages.');
    check(substr_count($captured, 'Content-Type: text/calendar;') === 2, 'Calendar attachments are incorrect.');
    preg_match_all('/Content-Type: text\/calendar;[^\r\n]*\r?\nContent-Transfer-Encoding: base64\r?\nContent-Disposition: attachment;[^\r\n]*\r?\n\r?\n([A-Za-z0-9+\/=\r\n]+)/', $captured, $attachments);
    check(count($attachments[1]) === 2, 'Cannot decode calendar attachments.');
    foreach ($attachments[1] as $encoded) {
        $calendar = base64_decode($encoded, true);
        check(is_string($calendar), 'Invalid calendar encoding.');
        $calendar = preg_replace("/\r\n[ \t]/", '', $calendar);
        check(str_contains($calendar, 'SUMMARY:Coupe + Soin -')
            && str_contains($calendar, '- Coupe : 30 min\\, 1 500 DA\\n- Soin : 45 min\\, 2 000 DA'), 'Calendar does not contain the saved service details.');
    }
    finishWorker(startWorker());
    check(file_get_contents($mailbox) === $captured, 'A notification was sent twice.');

    $due->execute([$retry['id']]);
    putenv('BOOKILI_TEST_MAIL_FAIL=1');
    finishWorker(startWorker());
    $retried = row($pdo, (int) $retry['id']);
    check($retried['status'] === 'retry' && (int) $retried['attempts'] === 1 && $retried['last_error'] !== null, 'Failed delivery was not queued for retry.');
    putenv('BOOKILI_TEST_MAIL_FAIL=0');
    finishWorker(startWorker());
    check(file_get_contents($mailbox) === $captured, 'A retry was sent before its backoff elapsed.');
    $due->execute([$retry['id']]);
    finishWorker(startWorker());
    $retried = row($pdo, (int) $retry['id']);
    check($retried['status'] === 'sent' && (int) $retried['attempts'] === 2 && $retried['last_error'] === null, 'Retry was not delivered.');
    check(substr_count(file_get_contents($mailbox), '--- BOOKILI TEST MESSAGE ---') === 5, 'Retry delivered the wrong number of messages.');

    $raceId = (int) $race['id'];
    $lockPdo->beginTransaction();
    $lock = $lockPdo->prepare('SELECT id FROM appointments WHERE id = ? FOR UPDATE');
    $lock->execute([$race['appointment_id']]);
    $due->execute([$raceId]);
    $workers[] = startWorker();
    awaitAttempts($pdo, $raceId, 1);
    $pdo->prepare("UPDATE notification_outbox SET locked_at = '2000-01-01 00:00:00' WHERE id = ?")->execute([$raceId]);
    $workers[] = startWorker();
    awaitAttempts($pdo, $raceId, 2);
    $lockPdo->commit();
    while ($workers) finishWorker(array_shift($workers));
    check(row($pdo, $raceId)['status'] === 'sent', 'Reclaimed notification was not delivered.');
    check(substr_count(file_get_contents($mailbox), '--- BOOKILI TEST MESSAGE ---') === 6, 'A reclaimed notification was delivered more than once.');
    echo "Notification worker delivery, retry and concurrent lease recovery checks passed.\n";
} finally {
    if ($lockPdo->inTransaction()) $lockPdo->rollBack();
    foreach ($workers as $worker) {
        proc_terminate($worker[0]);
        fclose($worker[1]);
        fclose($worker[2]);
        proc_close($worker[0]);
    }
    unlink($mailbox);
    putenv('BOOKILI_TEST_MAILBOX');
    putenv('BOOKILI_TEST_MAIL_FAIL');
}
