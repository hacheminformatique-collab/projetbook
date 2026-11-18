<?php
declare(strict_types=1);
require_once __DIR__ . '/booking.php';
bookili_require_method('GET');

$salonId = bookili_id($_GET['salonId'] ?? null);
$serviceIdsValue = $_GET['serviceIds'] ?? null;
if ($serviceIdsValue !== null) {
    if (!is_string($serviceIdsValue) || !preg_match('/^[1-9][0-9]*(?:,[1-9][0-9]*){0,5}$/D', $serviceIdsValue)) {
        bookili_json_response(422, ['error' => 'Sélection de prestations invalide.']);
    }
    $serviceIds = explode(',', $serviceIdsValue);
} else {
    $serviceIds = [$_GET['serviceId'] ?? null];
}
$day = bookili_booking_date($_GET['date'] ?? null);
$excludeId = isset($_GET['appointmentId']) ? bookili_id($_GET['appointmentId']) : 0;
$staffId = isset($_GET['staffId']) ? bookili_id($_GET['staffId']) : 0;

try {
    $pdo = bookili_database();
    if ($excludeId) {
        $account = bookili_require_role($pdo, ['client', 'professional']);
        if ($account['role'] === 'professional') {
            $salon = bookili_own_salon($pdo, (int) $account['id']);
            if ((int) $salon['id'] !== $salonId) bookili_json_response(404, ['error' => 'Rendez-vous introuvable.']);
            $statement = $pdo->prepare("SELECT id FROM appointments WHERE id = :id AND salon_id = :salon_id AND status = 'confirmed'");
            $statement->execute(['id' => $excludeId, 'salon_id' => $salonId]);
        } else {
            bookili_public_salon($pdo, $salonId);
            $statement = $pdo->prepare(
                "SELECT id FROM appointments WHERE id = :id AND salon_id = :salon_id AND client_id = :client_id AND status = 'confirmed'"
            );
            $statement->execute(['id' => $excludeId, 'salon_id' => $salonId, 'client_id' => $account['id']]);
        }
        if (!$statement->fetch()) bookili_json_response(404, ['error' => 'Rendez-vous introuvable.']);
    } else bookili_public_salon($pdo, $salonId);
    $service = bookili_selected_services($pdo, $salonId, $serviceIds);
    $staff = bookili_salon_staff($pdo, $salonId);
    $slots = count($staff) > 0 && $staffId === 0
        ? []
        : bookili_slots($pdo, $salonId, $service, $day, $excludeId, $staffId);
    bookili_json_response(200, ['slots' => $slots, 'staff' => $staff, 'timezone' => 'Africa/Algiers']);
} catch (Throwable $error) {
    bookili_database_error($error);
}
