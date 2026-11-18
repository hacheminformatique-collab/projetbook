<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

const BOOKILI_SERVICE_CATEGORIES = ['coiffeur', 'barbier', 'manucure', 'institut', 'bien-etre', 'maquillage', 'spa', 'massage'];

function bookili_now(): DateTimeImmutable
{
    return new DateTimeImmutable('now', new DateTimeZone('Africa/Algiers'));
}

function bookili_id(mixed $value): int
{
    if ((!is_string($value) && !is_int($value))
        || !preg_match('/^[1-9][0-9]*$/D', (string) $value)
        || filter_var($value, FILTER_VALIDATE_INT) === false) {
        bookili_json_response(422, ['error' => 'Identifiant invalide.']);
    }
    return (int) $value;
}

function bookili_booking_method(): string
{
    $method = $_SERVER['REQUEST_METHOD'] ?? '';
    if (!in_array($method, ['GET', 'POST'], true)) {
        header('Allow: GET, POST');
        bookili_json_response(405, ['error' => 'Méthode non autorisée.']);
    }
    if ($method === 'POST') {
        bookili_require_csrf();
    }
    return $method;
}

function bookili_own_salon(PDO $pdo, int $accountId, bool $lock = false): array
{
    $statement = $pdo->prepare(
        'SELECT s.* FROM salons s
         INNER JOIN professional_profiles p ON p.id = s.professional_profile_id
         WHERE p.account_id = :account_id ORDER BY s.id LIMIT 1' . ($lock ? ' FOR UPDATE' : '')
    );
    $statement->execute(['account_id' => $accountId]);
    $salon = $statement->fetch();
    if (!$salon) {
        throw new RuntimeException('Approved professional salon is missing.');
    }
    return $salon;
}

function bookili_public_salon(PDO $pdo, int $salonId, bool $lock = false): array
{
    $statement = $pdo->prepare(
        "SELECT s.* FROM salons s
         INNER JOIN professional_profiles p ON p.id = s.professional_profile_id
         INNER JOIN accounts a ON a.id = p.account_id
         WHERE s.id = :id AND s.is_public = 1 AND a.status = 'active' AND a.role = 'professional'"
        . ($lock ? ' FOR UPDATE' : '')
    );
    $statement->execute(['id' => $salonId]);
    $salon = $statement->fetch();
    if (!$salon) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        bookili_json_response(404, ['error' => 'Cet établissement n’est pas disponible à la réservation.']);
    }
    return $salon;
}

function bookili_calendar_date(mixed $value): DateTimeImmutable
{
    $date = is_string($value) && preg_match('/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/D', $value)
        ? DateTimeImmutable::createFromFormat('!Y-m-d', $value, new DateTimeZone('Africa/Algiers'))
        : false;
    if (!$date || $date->format('Y-m-d') !== $value) {
        bookili_json_response(422, ['error' => 'Date invalide.']);
    }
    return $date;
}

function bookili_booking_date(mixed $value): DateTimeImmutable
{
    $date = bookili_calendar_date($value);
    $today = bookili_now()->setTime(0, 0);
    if ($date < $today || $date > $today->modify('+60 days')) {
        bookili_json_response(422, ['error' => 'Choisissez une date entre aujourd’hui et les 60 prochains jours.']);
    }
    return $date;
}

function bookili_service(PDO $pdo, int $salonId, int $serviceId): array
{
    $statement = $pdo->prepare('SELECT * FROM services WHERE id = :id AND salon_id = :salon_id AND is_active = 1');
    $statement->execute(['id' => $serviceId, 'salon_id' => $salonId]);
    $service = $statement->fetch();
    if (!$service) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        bookili_json_response(422, ['error' => 'Cette prestation n’est plus disponible.']);
    }
    return $service;
}

function bookili_slots(PDO $pdo, int $salonId, array $service, DateTimeImmutable $day, int $excludeId = 0): array
{
    $statement = $pdo->prepare('SELECT opens_at, closes_at FROM salon_hours WHERE salon_id = :id AND weekday = :weekday');
    $statement->execute(['id' => $salonId, 'weekday' => (int) $day->format('N')]);
    $hours = $statement->fetch();
    if (!$hours) return [];

    $statement = $pdo->prepare(
        "SELECT starts_at, ends_at FROM appointments
         WHERE salon_id = :id AND status = 'confirmed' AND id <> :excluded
         AND starts_at < :day_end AND ends_at > :day_start"
    );
    $statement->execute([
        'id' => $salonId, 'excluded' => $excludeId,
        'day_start' => $day->format('Y-m-d 00:00:00'),
        'day_end' => $day->modify('+1 day')->format('Y-m-d 00:00:00'),
    ]);
    $busy = $statement->fetchAll();
    $start = new DateTimeImmutable($day->format('Y-m-d') . ' ' . $hours['opens_at'], new DateTimeZone('Africa/Algiers'));
    $close = new DateTimeImmutable($day->format('Y-m-d') . ' ' . $hours['closes_at'], new DateTimeZone('Africa/Algiers'));
    $now = bookili_now();
    $slots = [];
    for (; $start < $close; $start = $start->modify('+15 minutes')) {
        $end = $start->modify('+' . (int) $service['duration_minutes'] . ' minutes');
        if ($start <= $now || $end > $close) continue;
        foreach ($busy as $appointment) {
            if ($start->format('Y-m-d H:i:s') < $appointment['ends_at']
                && $end->format('Y-m-d H:i:s') > $appointment['starts_at']) {
                continue 2;
            }
        }
        $slots[] = $start->format('H:i');
    }
    return $slots;
}
