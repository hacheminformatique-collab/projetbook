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
    $statement = $pdo->prepare('SELECT id, email FROM accounts WHERE role = ? AND status = ? ORDER BY id LIMIT 1');
    $statement->execute([$role, 'active']);
    $account = $statement->fetch();
    if (!$account) throw new RuntimeException('Test account is missing: ' . $role);
    $curl = curl_init();
    curl_setopt_array($curl, [CURLOPT_RETURNTRANSFER => true, CURLOPT_COOKIEFILE => '', CURLOPT_TIMEOUT => 15]);
    [$code, $csrf] = request($curl, 'csrf.php');
    verify($code === 200, 'Could not obtain a CSRF token.');
    [$code, $login] = request($curl, 'login.php', [
        'email' => $account['email'], 'password' => 'Mot-de-passe-test-123',
    ], $csrf['csrfToken']);
    verify($code === 200, 'Could not log in as ' . $role);
    return [$curl, $login['csrfToken'], (int) $account['id']];
}

function startWorker(): array
{
    $process = proc_open(
        [PHP_BINARY, '-d', 'sendmail_path=' . __DIR__ . '/fake-sendmail.sh', __DIR__ . '/../public/api/send-campaigns.php'],
        [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes
    );
    if (!is_resource($process)) throw new RuntimeException('Cannot start the campaign worker.');
    fclose($pipes[0]);
    return [$process, $pipes[1], $pipes[2]];
}

function finishWorker(array $worker): void
{
    [$process, $stdout, $stderr] = $worker;
    stream_get_contents($stdout);
    $error = stream_get_contents($stderr);
    fclose($stdout);
    fclose($stderr);
    verify(proc_close($process) === 0, 'Campaign worker failed: ' . $error);
}

function recipient(PDO $pdo, int $campaignId): array
{
    $statement = $pdo->prepare('SELECT * FROM marketing_campaign_recipients WHERE campaign_id = ?');
    $statement->execute([$campaignId]);
    $rows = $statement->fetchAll();
    verify(count($rows) === 1, 'Expected one campaign recipient.');
    return $rows[0];
}

function awaitAttempts(PDO $pdo, int $campaignId, int $attempts): void
{
    for ($i = 0; $i < 200; $i++) {
        $row = recipient($pdo, $campaignId);
        if ($row['status'] === 'sending' && (int) $row['attempts'] === $attempts) return;
        usleep(50000);
    }
    throw new RuntimeException('Worker did not claim the campaign.');
}

function createCampaign(CurlHandle $admin, string $token, string $subject, int $expectedRecipients = 1): int
{
    [$code, $result] = request($admin, 'admin-campaigns.php', ['action' => 'create', 'subject' => $subject, 'body' => 'Message de test'], $token);
    verify($code === 201 && $result['recipients'] === $expectedRecipients, 'Campaign creation failed.');
    return (int) $result['campaignId'];
}

$mailbox = tempnam(sys_get_temp_dir(), 'bookili-campaign-test-');
if ($mailbox === false) throw new RuntimeException('Cannot create a test mailbox.');
putenv('BOOKILI_TEST_MAILBOX=' . $mailbox);
putenv('BOOKILI_TEST_MAIL_FAIL=0');
$pdo = bookili_database();
$lockPdo = bookili_database();
$sessions = [];
$workers = [];
try {
    [$client, $clientToken, $clientId] = session($pdo, 'client');
    [$admin, $adminToken, $adminId] = session($pdo, 'super_admin');
    [$professional, $professionalToken] = session($pdo, 'professional');
    $sessions = [$client, $admin, $professional];
    verify(request($client, 'client-profile.php', ['marketingConsent' => true], $clientToken)[0] === 200, 'Could not enable test consent.');
    verify(request($client, 'admin-campaigns.php')[0] === 403, 'Client can read campaigns.');
    verify(request($professional, 'admin-campaigns.php', ['action' => 'retry-failed', 'campaignId' => 1], $professionalToken)[0] === 403, 'Professional can retry campaigns.');
    verify(request($admin, 'admin-campaigns.php', ['action' => 'retry-failed', 'campaignId' => 1])[0] === 403, 'Missing CSRF token was accepted.');
    verify(request($admin, 'admin-campaigns.php?page=0')[0] === 422, 'Invalid page was accepted.');

    $raceId = createCampaign($admin, $adminToken, 'Campagne concurrence');
    $lockPdo->beginTransaction();
    $lock = $lockPdo->prepare('SELECT account_id FROM client_marketing_preferences WHERE account_id = ? FOR UPDATE');
    $lock->execute([$clientId]);
    $workers[] = startWorker();
    awaitAttempts($pdo, $raceId, 1);
    $pdo->prepare("UPDATE marketing_campaign_recipients SET locked_at = '2000-01-01 00:00:00' WHERE campaign_id = ?")->execute([$raceId]);
    $workers[] = startWorker();
    awaitAttempts($pdo, $raceId, 2);
    $lockPdo->commit();
    while ($workers) finishWorker(array_shift($workers));
    verify(recipient($pdo, $raceId)['status'] === 'sent', 'Recovered campaign was not sent.');
    $captured = file_get_contents($mailbox);
    verify(substr_count($captured, '--- BOOKILI TEST MESSAGE ---') === 1, 'Recovered campaign was sent more than once.');
    $tokens = $pdo->prepare('SELECT COUNT(*) FROM marketing_unsubscribe_tokens WHERE recipient_id = ?');
    $tokens->execute([recipient($pdo, $raceId)['id']]);
    verify((int) $tokens->fetchColumn() === 1, 'Recovered campaign created duplicate unsubscribe tokens.');
    verify(preg_match('/unsubscribe\\.php\\?token=([a-f0-9]{64})/', $captured, $match) === 1, 'Unsubscribe link is missing.');

    $withdrawnId = createCampaign($admin, $adminToken, 'Campagne consentement en cours');
    $lockPdo->beginTransaction();
    $lock->execute([$clientId]);
    $workers[] = startWorker();
    awaitAttempts($pdo, $withdrawnId, 1);
    $lockPdo->prepare('UPDATE client_marketing_preferences SET consent = 0 WHERE account_id = ?')->execute([$clientId]);
    $lockPdo->commit();
    while ($workers) finishWorker(array_shift($workers));
    verify(recipient($pdo, $withdrawnId)['status'] === 'cancelled' && file_get_contents($mailbox) === $captured, 'A claimed campaign ignored withdrawn consent.');
    verify(request($client, 'client-profile.php', ['marketingConsent' => true], $clientToken)[0] === 200, 'Could not restore consent.');

    $pendingId = createCampaign($admin, $adminToken, 'Campagne à désinscrire');
    $link = curl_init(rtrim(getenv('BOOKILI_TEST_URL'), '/') . '/api/unsubscribe.php?token=' . $match[1]);
    $sessions[] = $link;
    curl_setopt_array($link, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 15]);
    verify(curl_exec($link) !== false && curl_getinfo($link, CURLINFO_RESPONSE_CODE) === 200, 'Unsubscribe confirmation page failed.');
    verify((int) $pdo->query("SELECT consent FROM client_marketing_preferences WHERE account_id = {$clientId}")->fetchColumn() === 1, 'GET unexpectedly withdrew consent.');
    curl_setopt_array($link, [CURLOPT_URL => rtrim(getenv('BOOKILI_TEST_URL'), '/') . '/api/unsubscribe.php', CURLOPT_POST => true, CURLOPT_POSTFIELDS => http_build_query(['token' => $match[1]])]);
    verify(curl_exec($link) !== false && curl_getinfo($link, CURLINFO_RESPONSE_CODE) === 200, 'Unsubscribe failed.');
    verify(recipient($pdo, $pendingId)['status'] === 'cancelled', 'Unsubscribe did not cancel the pending campaign.');
    finishWorker(startWorker());
    verify(file_get_contents($mailbox) === $captured, 'A campaign was sent after unsubscribe.');

    verify(request($client, 'client-profile.php', ['marketingConsent' => true], $clientToken)[0] === 200, 'Could not restore consent.');
    $cancelledId = createCampaign($admin, $adminToken, 'Campagne annulée');
    verify(request($admin, 'admin-campaigns.php', ['action' => 'cancel', 'campaignId' => $cancelledId], $adminToken)[0] === 200, 'Campaign cancellation failed.');
    verify(request($admin, 'admin-campaigns.php', ['action' => 'retry-failed', 'campaignId' => $cancelledId], $adminToken)[0] === 409, 'Cancelled campaign was retried.');

    $failedId = createCampaign($admin, $adminToken, 'Campagne en échec');
    putenv('BOOKILI_TEST_MAIL_FAIL=1');
    for ($i = 1; $i <= 5; $i++) {
        $pdo->prepare("UPDATE marketing_campaign_recipients SET send_after = '2000-01-01 00:00:00' WHERE campaign_id = ?")->execute([$failedId]);
        finishWorker(startWorker());
        $row = recipient($pdo, $failedId);
        verify((int) $row['attempts'] === $i && $row['status'] === ($i === 5 ? 'failed' : 'retry'), 'Incorrect failed campaign state.');
    }
    [$code, $data] = request($admin, 'admin-campaigns.php');
    $campaigns = array_column($data['campaigns'], null, 'id');
    verify($code === 200 && $campaigns[$failedId]['status'] === 'completed' && (int) $campaigns[$failedId]['failed'] === 1 && $campaigns[$failedId]['completed_at'] !== null, 'Failed campaign was not reported.');
    verify(!array_intersect(['recipient', 'message_body', 'last_error'], array_keys($campaigns[$failedId])), 'Campaign recipient information leaked.');
    [$code, $result] = request($admin, 'admin-campaigns.php', ['action' => 'retry-failed', 'campaignId' => $failedId], $adminToken);
    verify($code === 200 && $result['retried'] === 1, 'Campaign retry failed.');
    [$code, $data] = request($admin, 'admin-campaigns.php');
    $campaigns = array_column($data['campaigns'], null, 'id');
    verify($campaigns[$failedId]['status'] === 'sending' && $campaigns[$failedId]['completed_at'] === null && (int) $campaigns[$failedId]['retrying'] === 1 && $campaigns[$failedId]['next_retry'] !== null, 'Reopened campaign state is incorrect.');
    verify(request($admin, 'admin-campaigns.php', ['action' => 'retry-failed', 'campaignId' => $failedId], $adminToken)[0] === 409, 'Non-failed messages were retried.');
    putenv('BOOKILI_TEST_MAIL_FAIL=0');
    finishWorker(startWorker());
    verify(recipient($pdo, $failedId)['status'] === 'sent' && substr_count(file_get_contents($mailbox), '--- BOOKILI TEST MESSAGE ---') === 2, 'Retry did not deliver exactly once.');

    $revokedId = createCampaign($admin, $adminToken, 'Campagne consentement retiré');
    $pdo->prepare("UPDATE marketing_campaign_recipients SET status = 'failed', attempts = 5 WHERE campaign_id = ?")->execute([$revokedId]);
    verify(request($client, 'client-profile.php', ['marketingConsent' => false], $clientToken)[0] === 200, 'Could not withdraw consent.');
    verify(request($admin, 'admin-campaigns.php', ['action' => 'retry-failed', 'campaignId' => $revokedId], $adminToken)[0] === 200, 'Could not retry the failed campaign.');
    finishWorker(startWorker());
    verify(recipient($pdo, $revokedId)['status'] === 'cancelled' && substr_count(file_get_contents($mailbox), '--- BOOKILI TEST MESSAGE ---') === 2, 'Retry ignored withdrawn consent.');

    verify(request($client, 'client-profile.php', ['marketingConsent' => true], $clientToken)[0] === 200, 'Could not restore first client consent.');
    $otherClient = (int) $pdo->query("SELECT id FROM accounts WHERE role = 'client' AND status = 'active' AND id <> {$clientId} ORDER BY id LIMIT 1")->fetchColumn();
    verify($otherClient > 0, 'Expected a second client.');
    $pdo->prepare(
        'INSERT INTO client_marketing_preferences (account_id, consent, updated_at) VALUES (?, 1, ?)
         ON DUPLICATE KEY UPDATE consent = 1, updated_at = VALUES(updated_at)'
    )->execute([$otherClient, bookili_now()->format('Y-m-d H:i:s')]);
    $mixedId = createCampaign($admin, $adminToken, 'Campagne partielle', 2);
    $pdo->prepare("UPDATE marketing_campaign_recipients SET status = 'sent', attempts = 1 WHERE campaign_id = ? AND account_id = ?")->execute([$mixedId, $clientId]);
    $pdo->prepare("UPDATE marketing_campaign_recipients SET status = 'failed', attempts = 5 WHERE campaign_id = ? AND account_id = ?")->execute([$mixedId, $otherClient]);
    $pdo->prepare("UPDATE marketing_campaigns SET status = 'completed', completed_at = ? WHERE id = ?")->execute([bookili_now()->format('Y-m-d H:i:s'), $mixedId]);
    [$code, $result] = request($admin, 'admin-campaigns.php', ['action' => 'retry-failed', 'campaignId' => $mixedId], $adminToken);
    verify($code === 200 && $result['retried'] === 1, 'Partial retry included the wrong recipients.');
    finishWorker(startWorker());
    $statement = $pdo->prepare('SELECT status, attempts FROM marketing_campaign_recipients WHERE campaign_id = ? ORDER BY account_id');
    $statement->execute([$mixedId]);
    $mixedRows = $statement->fetchAll();
    verify(count($mixedRows) === 2 && $mixedRows[0]['status'] === 'sent' && (int) $mixedRows[0]['attempts'] === 1 && $mixedRows[1]['status'] === 'sent', 'Partial retry changed an already sent recipient.');
    verify(substr_count(file_get_contents($mailbox), '--- BOOKILI TEST MESSAGE ---') === 3, 'Partial retry sent an incorrect number of messages.');

    $insert = $pdo->prepare("INSERT INTO marketing_campaigns (created_by, subject, message_body, status, created_at) VALUES (?, 'Pagination', 'Test', 'cancelled', ?)");
    for ($i = 0; $i < 51; $i++) $insert->execute([$adminId, bookili_now()->format('Y-m-d H:i:s')]);
    [$code, $first] = request($admin, 'admin-campaigns.php?page=1');
    [$secondCode, $second] = request($admin, 'admin-campaigns.php?page=2');
    verify($code === 200 && $secondCode === 200 && count($first['campaigns']) === 50 && $first['hasMore'] && !$second['hasMore'], 'Campaign pagination failed.');
    verify(!array_intersect(array_column($first['campaigns'], 'id'), array_column($second['campaigns'], 'id')), 'Campaign pagination repeated rows.');
    echo "Campaign delivery, lease recovery, consent, retries and tracking passed.\n";
} finally {
    if ($lockPdo->inTransaction()) $lockPdo->rollBack();
    foreach ($workers as $worker) {
        proc_terminate($worker[0]);
        fclose($worker[1]);
        fclose($worker[2]);
        proc_close($worker[0]);
    }
    foreach ($sessions as $curl) curl_close($curl);
    unlink($mailbox);
    putenv('BOOKILI_TEST_MAILBOX');
    putenv('BOOKILI_TEST_MAIL_FAIL');
}
