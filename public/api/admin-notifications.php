<?php
declare(strict_types=1);
require_once __DIR__ . '/booking.php';

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
        $action = $data['action'] ?? '';
        if (!in_array($action, ['retry-failed', 'retry-one'], true)) {
            bookili_json_response(422, ['error' => 'Action invalide.']);
        }
        $id = $action === 'retry-one' ? bookili_id($data['notificationId'] ?? null) : null;
        $statement = $pdo->prepare(
            "UPDATE notification_outbox SET status = 'retry', attempts = 0, send_after = :now,
             last_error = NULL, locked_at = NULL WHERE status = 'failed'" . ($id !== null ? ' AND id = :id' : '')
        );
        $params = ['now' => bookili_now()->format('Y-m-d H:i:s')];
        if ($id !== null) $params['id'] = $id;
        $statement->execute($params);
        if ($id !== null && $statement->rowCount() !== 1) {
            bookili_json_response(409, ['error' => 'Cet e-mail n’est plus en erreur définitive. Actualisez la liste.']);
        }
        bookili_json_response(200, ['retried' => $statement->rowCount()]);
    }

    $page = isset($_GET['page']) ? bookili_id($_GET['page']) : 1;
    if ($page > 10000) bookili_json_response(422, ['error' => 'Page invalide.']);
    $statement = $pdo->query(
        'SELECT status, COUNT(*) AS total FROM notification_outbox GROUP BY status'
    );
    $counts = ['queued' => 0, 'sending' => 0, 'retry' => 0, 'sent' => 0, 'failed' => 0, 'cancelled' => 0];
    foreach ($statement->fetchAll() as $row) $counts[$row['status']] = (int) $row['total'];
    $schedule = $pdo->query(
        "SELECT MIN(CASE WHEN status IN ('queued', 'retry') THEN send_after END) AS next_send,
                MAX(sent_at) AS last_sent FROM notification_outbox"
    )->fetch();
    $statement = $pdo->query(
        "SELECT n.id, n.appointment_id, n.kind, n.status, n.attempts, n.send_after, n.last_error,
                n.appointment_version, b.notification_version, b.status AS appointment_status,
                b.starts_at, s.name AS salon_name
         FROM notification_outbox n
         INNER JOIN appointments b ON b.id = n.appointment_id
         INNER JOIN salons s ON s.id = b.salon_id
         WHERE n.status IN ('failed', 'retry')
         ORDER BY n.status = 'failed' DESC, n.id DESC LIMIT 51 OFFSET " . (($page - 1) * 50)
    );
    $rows = $statement->fetchAll();
    $now = bookili_now()->format('Y-m-d H:i:s');
    $problems = array_map(static function (array $row) use ($now): array {
        $obsolete = (int) $row['appointment_version'] !== (int) $row['notification_version']
            || ($row['kind'] === 'cancelled' ? $row['appointment_status'] !== 'cancelled'
                : $row['appointment_status'] !== 'confirmed'
                    || (str_starts_with($row['kind'], 'reminder_') && $row['starts_at'] <= $now));
        $reason = $row['last_error'] === 'Envoi interrompu cinq fois.' ? 'interrupted'
            : ($row['last_error'] !== null ? 'delivery' : 'unknown');
        return [
            'id' => (int) $row['id'], 'appointmentId' => (int) $row['appointment_id'],
            'kind' => $row['kind'], 'status' => $row['status'], 'attempts' => (int) $row['attempts'],
            'nextAttempt' => $row['status'] === 'retry' ? $row['send_after'] : null,
            'reason' => $reason, 'obsolete' => $obsolete, 'appointmentStartsAt' => $row['starts_at'],
            'salonName' => $row['salon_name'],
        ];
    }, array_slice($rows, 0, 50));
    bookili_json_response(200, [
        'counts' => $counts, 'nextSend' => $schedule['next_send'], 'lastSent' => $schedule['last_sent'],
        'problems' => $problems, 'hasMoreProblems' => count($rows) > 50,
    ]);
} catch (Throwable $error) {
    bookili_database_error($error);
}
