<?php
declare(strict_types=1);

// Run after professional-agenda.py, only against the same disposable installation.
if (getenv('BOOKILI_DISPOSABLE_TEST') !== '1' || !getenv('BOOKILI_TEST_URL')) {
    throw new RuntimeException('An explicitly disposable test installation and BOOKILI_TEST_URL are required.');
}
require_once __DIR__ . '/../public/api/booking.php';

function verify(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

function request(CurlHandle $curl, string $path, ?array $body = null, string $csrf = ''): array
{
    curl_setopt_array($curl, [
        CURLOPT_URL => rtrim(getenv('BOOKILI_TEST_URL'), '/') . '/api/' . $path,
        CURLOPT_HTTPGET => true, CURLOPT_HTTPHEADER => [],
    ]);
    if ($body !== null) {
        curl_setopt_array($curl, [
            CURLOPT_POST => true, CURLOPT_POSTFIELDS => json_encode($body, JSON_THROW_ON_ERROR),
            CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'X-CSRF-Token: ' . $csrf],
        ]);
    }
    $result = curl_exec($curl);
    if ($result === false) throw new RuntimeException(curl_error($curl));
    return [curl_getinfo($curl, CURLINFO_RESPONSE_CODE), json_decode($result, true, 512, JSON_THROW_ON_ERROR)];
}

function session(PDO $pdo, string $role): array
{
    $statement = $pdo->prepare('SELECT email FROM accounts WHERE role = ? AND status = ? ORDER BY id LIMIT 1');
    $statement->execute([$role, 'active']);
    $email = $statement->fetchColumn();
    if (!$email) throw new RuntimeException('Test account is missing: ' . $role);
    $curl = curl_init();
    curl_setopt_array($curl, [CURLOPT_RETURNTRANSFER => true, CURLOPT_COOKIEFILE => '', CURLOPT_TIMEOUT => 15]);
    [$status, $csrf] = request($curl, 'csrf.php');
    verify($status === 200, 'Could not obtain a CSRF token.');
    [$status, $account] = request($curl, 'login.php', [
        'email' => $email, 'password' => 'Mot-de-passe-test-123',
    ], $csrf['csrfToken']);
    verify($status === 200, 'Could not log in as ' . $role);
    return [$curl, $account['csrfToken']];
}

function runWorker(): void
{
    $process = proc_open(
        [PHP_BINARY, '-d', 'sendmail_path=' . __DIR__ . '/fake-sendmail.sh', __DIR__ . '/../public/api/send-notifications.php'],
        [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes
    );
    if (!is_resource($process)) throw new RuntimeException('Cannot start the notification worker.');
    fclose($pipes[0]);
    stream_get_contents($pipes[1]);
    $error = stream_get_contents($pipes[2]);
    fclose($pipes[1]);
    fclose($pipes[2]);
    verify(proc_close($process) === 0, 'Notification worker failed: ' . $error);
}

function notification(PDO $pdo, int $id): array
{
    $statement = $pdo->prepare('SELECT * FROM notification_outbox WHERE id = ?');
    $statement->execute([$id]);
    $row = $statement->fetch();
    if (!$row) throw new RuntimeException('Notification missing.');
    return $row;
}

$pdo = bookili_database();
$rows = $pdo->query(
    "SELECT n.id FROM notification_outbox n INNER JOIN appointments b ON b.id = n.appointment_id
     WHERE n.status = 'queued' AND n.kind IN ('reminder_7d', 'reminder_1d')
       AND n.appointment_version = b.notification_version AND b.status = 'confirmed'
     ORDER BY n.id LIMIT 2"
)->fetchAll();
verify(count($rows) === 2, 'Expected two reminders from professional-agenda.py.');
[$failedId, $retryId] = array_map(static fn(array $row): int => (int) $row['id'], $rows);
$obsoleteId = (int) $pdo->query(
    "SELECT n.id FROM notification_outbox n INNER JOIN appointments b ON b.id = n.appointment_id
     WHERE n.status = 'queued' AND n.appointment_version <> b.notification_version ORDER BY n.id LIMIT 1"
)->fetchColumn();
verify($obsoleteId > 0, 'Expected an obsolete notification.');
$mailbox = tempnam(sys_get_temp_dir(), 'bookili-admin-mail-test-');
if ($mailbox === false) throw new RuntimeException('Cannot create a test mailbox.');
putenv('BOOKILI_TEST_MAILBOX=' . $mailbox);
putenv('BOOKILI_TEST_MAIL_FAIL=1');
$sessions = [];
try {
    $pdo->exec("UPDATE notification_outbox SET send_after = '9999-12-31 23:59:59' WHERE status IN ('queued', 'retry')");
    $due = $pdo->prepare("UPDATE notification_outbox SET send_after = '2000-01-01 00:00:00' WHERE id = ?");
    foreach ([15, 60, 360, 1440, 1440] as $index => $minutes) {
        $due->execute([$failedId]);
        $before = bookili_now()->getTimestamp();
        runWorker();
        $row = notification($pdo, $failedId);
        $delay = (new DateTimeImmutable($row['send_after'], new DateTimeZone('Africa/Algiers')))->getTimestamp() - $before;
        verify((int) $row['attempts'] === $index + 1 && $row['status'] === ($index === 4 ? 'failed' : 'retry'), 'Incorrect failure state.');
        verify($delay >= $minutes * 60 - 2 && $delay <= $minutes * 60 + 10, 'Incorrect retry delay.');
    }
    $due->execute([$retryId]);
    runWorker();
    $pdo->prepare("UPDATE notification_outbox SET status = 'failed', attempts = 5, last_error = 'Envoi interrompu cinq fois.' WHERE id = ?")
        ->execute([$obsoleteId]);

    $guest = curl_init();
    curl_setopt_array($guest, [CURLOPT_RETURNTRANSFER => true, CURLOPT_COOKIEFILE => '', CURLOPT_TIMEOUT => 15]);
    $sessions[] = $guest;
    verify(request($guest, 'admin-notifications.php')[0] === 401, 'Guest has access to notifications.');
    foreach (['client', 'professional'] as $role) {
        [$restricted, $token] = session($pdo, $role);
        $sessions[] = $restricted;
        verify(request($restricted, 'admin-notifications.php')[0] === 403, $role . ' has access to notifications.');
        verify(request($restricted, 'admin-notifications.php', ['action' => 'retry-failed'], $token)[0] === 403, $role . ' can retry notifications.');
    }
    [$admin, $token] = session($pdo, 'super_admin');
    $sessions[] = $admin;
    verify(request($admin, 'admin-notifications.php', ['action' => 'retry-failed'])[0] === 403, 'Missing CSRF token was accepted.');
    verify(request($admin, 'admin-notifications.php?page=0')[0] === 422, 'Invalid page was accepted.');
    [$code, $response] = request($admin, 'admin-notifications.php');
    verify($code === 200 && $response['counts']['failed'] === 2 && $response['counts']['retry'] === 1, 'Incorrect notification counts.');
    $items = array_column($response['problems'], null, 'id');
    verify($items[$failedId]['status'] === 'failed' && $items[$failedId]['attempts'] === 5 && $items[$failedId]['nextAttempt'] === null && $items[$failedId]['reason'] === 'delivery', 'Failed delivery details are incorrect.');
    verify($items[$retryId]['status'] === 'retry' && $items[$retryId]['attempts'] === 1 && $items[$retryId]['nextAttempt'] !== null, 'Automatic retry details are incorrect.');
    verify($items[$obsoleteId]['obsolete'] && $items[$obsoleteId]['reason'] === 'interrupted', 'Obsolete interrupted notification was not reported.');
    foreach ($items as $item) {
        verify(!array_intersect(['recipient', 'subject', 'message_body', 'last_error'], array_keys($item)), 'Private notification content leaked.');
    }
    verify(request($admin, 'admin-notifications.php', ['action' => 'retry-one', 'notificationId' => 0], $token)[0] === 422, 'Invalid notification ID was accepted.');
    [$code, $result] = request($admin, 'admin-notifications.php', ['action' => 'retry-one', 'notificationId' => $failedId], $token);
    verify($code === 200 && $result['retried'] === 1 && notification($pdo, $failedId)['status'] === 'retry', 'Individual retry failed.');
    verify(request($admin, 'admin-notifications.php', ['action' => 'retry-one', 'notificationId' => $failedId], $token)[0] === 409, 'A non-failed message was retried.');
    verify(notification($pdo, $obsoleteId)['status'] === 'failed', 'Individual retry changed another message.');
    [$code, $result] = request($admin, 'admin-notifications.php', ['action' => 'retry-failed'], $token);
    verify($code === 200 && $result['retried'] === 1, 'Bulk retry failed.');
    putenv('BOOKILI_TEST_MAIL_FAIL=0');
    runWorker();
    verify(notification($pdo, $failedId)['status'] === 'sent' && notification($pdo, $obsoleteId)['status'] === 'cancelled', 'Retried messages were not correctly processed.');
    verify(substr_count(file_get_contents($mailbox), '--- BOOKILI TEST MESSAGE ---') === 1, 'Obsolete message was delivered or retry was duplicated.');

    $insert = $pdo->prepare(
        "INSERT INTO notification_outbox (appointment_id, appointment_version, kind, recipient, subject, message_body, send_after, status, attempts)
         SELECT appointment_id, :version, kind, recipient, subject, message_body, send_after, 'retry', 1
         FROM notification_outbox WHERE id = :id"
    );
    for ($i = 1; $i <= 51; $i++) $insert->execute(['version' => 100000 + $i, 'id' => $retryId]);
    [$code, $first] = request($admin, 'admin-notifications.php?page=1');
    [$secondCode, $second] = request($admin, 'admin-notifications.php?page=2');
    verify($code === 200 && $secondCode === 200 && count($first['problems']) === 50 && $first['hasMoreProblems'], 'First page is incorrect.');
    verify(count($second['problems']) === 2 && !$second['hasMoreProblems'], 'Second page is incorrect.');
    verify(!array_intersect(array_column($first['problems'], 'id'), array_column($second['problems'], 'id')), 'Pagination repeated a message.');
    echo "Notification failure tracking, access and retries passed.\n";
} finally {
    foreach ($sessions as $curl) curl_close($curl);
    unlink($mailbox);
    putenv('BOOKILI_TEST_MAILBOX');
    putenv('BOOKILI_TEST_MAIL_FAIL');
}
