<?php
declare(strict_types=1);
require_once __DIR__ . '/booking.php';
bookili_require_method('GET');

try {
    $pdo = bookili_database();
    $account = bookili_require_role($pdo, ['professional']);
    $salon = bookili_own_salon($pdo, (int) $account['id']);
    $page = isset($_GET['page']) ? bookili_id($_GET['page']) : 1;
    if ($page > 10000) bookili_json_response(422, ['error' => 'Page invalide.']);
    $statement = $pdo->prepare(
        "SELECT c.first_name, c.last_name, c.phone_number, COUNT(*) AS appointment_count,
                MAX(b.starts_at) AS latest_appointment
         FROM appointments b INNER JOIN client_profiles c ON c.account_id = b.client_id
         WHERE b.salon_id = :id AND b.status = 'confirmed'
         GROUP BY c.account_id, c.first_name, c.last_name, c.phone_number
         ORDER BY c.last_name, c.first_name, c.account_id LIMIT 51 OFFSET " . (($page - 1) * 50)
    );
    $statement->execute(['id' => $salon['id']]);
    $clients = $statement->fetchAll();
    bookili_json_response(200, ['clients' => array_slice($clients, 0, 50), 'hasMore' => count($clients) > 50]);
} catch (Throwable $error) {
    bookili_database_error($error);
}
