<?php
declare(strict_types=1);
require_once __DIR__ . '/bootstrap.php';

$method = $_SERVER['REQUEST_METHOD'] ?? '';
if (!in_array($method, ['GET', 'POST'], true)) {
    header('Allow: GET, POST');
    bookili_json_response(405, ['error' => 'Méthode non autorisée.']);
}
if ($method === 'POST') {
    bookili_require_csrf();
}

try {
    $pdo = bookili_database();
    bookili_require_role($pdo, ['super_admin']);
    if ($method === 'POST') {
        $data = bookili_read_json();
        if (($data['action'] ?? '') !== 'retry-failed') {
            bookili_json_response(422, ['error' => 'Action invalide.']);
        }
        $statement = $pdo->prepare(
            "UPDATE notification_outbox SET status = 'retry', attempts = 0, send_after = :now,
             last_error = NULL, locked_at = NULL WHERE status = 'failed'"
        );
        $statement->execute(['now' => (new DateTimeImmutable('now', new DateTimeZone('Africa/Algiers')))->format('Y-m-d H:i:s')]);
        bookili_json_response(200, ['retried' => $statement->rowCount()]);
    }

    $statement = $pdo->query(
        'SELECT status, COUNT(*) AS total FROM notification_outbox GROUP BY status'
    );
    $counts = ['queued' => 0, 'sending' => 0, 'retry' => 0, 'sent' => 0, 'failed' => 0, 'cancelled' => 0];
    foreach ($statement->fetchAll() as $row) $counts[$row['status']] = (int) $row['total'];
    $schedule = $pdo->query(
        "SELECT MIN(CASE WHEN status IN ('queued', 'retry') THEN send_after END) AS next_send,
                MAX(sent_at) AS last_sent FROM notification_outbox"
    )->fetch();
    bookili_json_response(200, ['counts' => $counts, 'nextSend' => $schedule['next_send'], 'lastSent' => $schedule['last_sent']]);
} catch (Throwable $error) {
    bookili_database_error($error);
}
