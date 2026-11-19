<?php
declare(strict_types=1);
require_once __DIR__ . '/booking.php';

$method = bookili_booking_method();
$data = $method === 'POST' ? bookili_read_json() : [];

try {
    $pdo = bookili_database();
    $account = bookili_require_role($pdo, ['professional']);
    if ($method === 'POST') {
        $name = bookili_required_text($data, 'name', 180);
        $city = bookili_required_text($data, 'city', 120);
        $address = bookili_required_text($data, 'address', 255);
        $phone = bookili_required_text($data, 'phone', 32);
        $bookingMessage = $data['bookingMessage'] ?? null;
        if ($bookingMessage !== null && (
            !is_string($bookingMessage) || strlen($bookingMessage) > 4000
            || preg_match('/\A.{0,1000}\z/us', $bookingMessage) !== 1
        )) {
            bookili_json_response(422, ['error' => 'Le message destiné aux clients ne peut pas dépasser 1 000 caractères.']);
        }
        $bookingMessage = $bookingMessage === null ? null : trim($bookingMessage);
        $wilaya = $data['wilaya'] ?? '';
        $isPublic = $data['isPublic'] ?? null;
        if (!is_string($wilaya) || !preg_match('/^(0[1-9]|[1-4][0-9]|5[0-8])$/D', $wilaya)
            || !is_bool($isPublic) || !bookili_valid_phone($phone)) {
            bookili_json_response(422, ['error' => 'Vérifiez la wilaya, le téléphone et la visibilité.']);
        }
        $hours = $data['hours'] ?? null;
        if (!is_array($hours) || !array_is_list($hours) || count($hours) > 7) {
            bookili_json_response(422, ['error' => 'Les horaires sont invalides.']);
        }
        $seen = [];
        foreach ($hours as $hour) {
            if (!is_array($hour) || !is_int($hour['weekday'] ?? null) || $hour['weekday'] < 1 || $hour['weekday'] > 7
                || isset($seen[$hour['weekday']]) || !is_string($hour['opens_at'] ?? null) || !is_string($hour['closes_at'] ?? null)
                || !preg_match('/^([01][0-9]|2[0-3]):[0-5][0-9]$/D', $hour['opens_at'])
                || !preg_match('/^([01][0-9]|2[0-3]):[0-5][0-9]$/D', $hour['closes_at'])
                || $hour['opens_at'] >= $hour['closes_at']) {
                bookili_json_response(422, ['error' => 'Chaque jour doit avoir une plage horaire valide et unique, sans passage à minuit.']);
            }
            $seen[$hour['weekday']] = true;
        }
        $pdo->beginTransaction();
        $salon = bookili_own_salon($pdo, (int) $account['id'], true);
        if ($isPublic) {
            $statement = $pdo->prepare('SELECT COUNT(*) FROM services WHERE salon_id = :id AND is_active = 1');
            $statement->execute(['id' => $salon['id']]);
            if (!$hours || (int) $statement->fetchColumn() === 0) {
                $pdo->rollBack();
                bookili_json_response(422, ['error' => 'Ajoutez une prestation active et des horaires avant de publier votre salon.']);
            }
        }
        $statement = $pdo->prepare(
            'UPDATE salons SET name = :name, city = :city, address = :address, phone_number = :phone,
             wilaya_code = :wilaya, is_public = :is_public,
             booking_message = COALESCE(:booking_message, booking_message) WHERE id = :id'
        );
        $statement->execute([
            'name' => $name, 'city' => $city, 'address' => $address, 'phone' => $phone,
            'wilaya' => $wilaya, 'is_public' => (int) $isPublic, 'booking_message' => $bookingMessage, 'id' => $salon['id'],
        ]);
        $statement = $pdo->prepare('DELETE FROM salon_hours WHERE salon_id = :id');
        $statement->execute(['id' => $salon['id']]);
        $statement = $pdo->prepare('INSERT INTO salon_hours (salon_id, weekday, opens_at, closes_at) VALUES (:id, :weekday, :opens_at, :closes_at)');
        foreach ($hours as $hour) $statement->execute(['id' => $salon['id']] + $hour);
        $pdo->commit();
    }
    $salon = bookili_own_salon($pdo, (int) $account['id']);
    $statement = $pdo->prepare('SELECT weekday, opens_at, closes_at FROM salon_hours WHERE salon_id = :id ORDER BY weekday');
    $statement->execute(['id' => $salon['id']]);
    bookili_json_response(200, ['salon' => $salon, 'hours' => $statement->fetchAll()]);
} catch (Throwable $error) {
    if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
    bookili_database_error($error);
}
