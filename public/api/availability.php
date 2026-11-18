<?php
declare(strict_types=1);
require_once __DIR__ . '/booking.php';
bookili_require_method('GET');

$salonId = bookili_id($_GET['salonId'] ?? null);
$serviceId = bookili_id($_GET['serviceId'] ?? null);
$day = bookili_booking_date($_GET['date'] ?? null);
$excludeId = isset($_GET['appointmentId']) ? bookili_id($_GET['appointmentId']) : 0;

try {
    $pdo = bookili_database();
    bookili_public_salon($pdo, $salonId);
    if ($excludeId) {
        $account = bookili_require_role($pdo, ['client']);
        $statement = $pdo->prepare(
            "SELECT id FROM appointments WHERE id = :id AND salon_id = :salon_id AND client_id = :client_id AND status = 'confirmed'"
        );
        $statement->execute(['id' => $excludeId, 'salon_id' => $salonId, 'client_id' => $account['id']]);
        if (!$statement->fetch()) bookili_json_response(404, ['error' => 'Rendez-vous introuvable.']);
    }
    $service = bookili_service($pdo, $salonId, $serviceId);
    bookili_json_response(200, ['slots' => bookili_slots($pdo, $salonId, $service, $day, $excludeId), 'timezone' => 'Africa/Algiers']);
} catch (Throwable $error) {
    bookili_database_error($error);
}
