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
        "SELECT s.id, s.name, s.wilaya_code, s.city, s.address, s.phone_number, s.is_public,
                s.booking_message, s.public_description
         FROM salons s
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

function bookili_selected_services(PDO $pdo, int $salonId, array $serviceIds): array
{
    if (!array_is_list($serviceIds) || count($serviceIds) < 1 || count($serviceIds) > 6) {
        bookili_json_response(422, ['error' => 'Choisissez entre 1 et 6 prestations.']);
    }
    $services = [];
    $seen = [];
    $duration = 0;
    $price = 0;
    foreach ($serviceIds as $value) {
        $id = bookili_id($value);
        if (isset($seen[$id])) bookili_json_response(422, ['error' => 'Une prestation ne peut être ajoutée qu’une fois.']);
        $seen[$id] = true;
        $service = bookili_service($pdo, $salonId, $id);
        $services[] = $service;
        $duration += (int) $service['duration_minutes'];
        $price += (int) $service['price_dzd'];
    }
    $name = implode(' + ', array_column($services, 'name'));
    if ($duration > 1440 || $price > 10000000 || strlen($name) > 180) {
        bookili_json_response(422, ['error' => 'Le cumul des prestations dépasse les limites autorisées.']);
    }
    return [
        'id' => (int) $services[0]['id'], 'name' => $name, 'duration_minutes' => $duration,
        'price_dzd' => $price, 'services' => $services,
    ];
}

function bookili_save_appointment_services(PDO $pdo, int $appointmentId, array $selection): void
{
    $pdo->prepare('DELETE FROM appointment_services WHERE appointment_id = :id')->execute(['id' => $appointmentId]);
    $insert = $pdo->prepare(
        'INSERT INTO appointment_services (appointment_id, position, service_id, service_name, duration_minutes, price_dzd)
         VALUES (:appointment, :position, :service, :name, :duration, :price)'
    );
    foreach ($selection['services'] as $position => $service) {
        $insert->execute([
            'appointment' => $appointmentId, 'position' => $position, 'service' => $service['id'],
            'name' => $service['name'], 'duration' => $service['duration_minutes'], 'price' => $service['price_dzd'],
        ]);
    }
}

function bookili_salon_staff(PDO $pdo, int $salonId): array
{
    $statement = $pdo->prepare(
        'SELECT id, name FROM staff_members WHERE salon_id = :salon_id AND is_active = 1 ORDER BY name, id'
    );
    $statement->execute(['salon_id' => $salonId]);
    return $statement->fetchAll();
}

function bookili_slots(PDO $pdo, int $salonId, array $service, DateTimeImmutable $day, int $excludeId = 0, int $staffId = 0): array
{
    if ($staffId > 0) {
        $statement = $pdo->prepare('SELECT 1 FROM staff_members WHERE id = :id AND salon_id = :salon_id AND is_active = 1');
        $statement->execute(['id' => $staffId, 'salon_id' => $salonId]);
        if (!$statement->fetchColumn()) bookili_json_response(422, ['error' => 'Ce collaborateur n’est plus disponible.']);
    }
    $statement = $pdo->prepare('SELECT 1 FROM salon_closures WHERE salon_id = :id AND closure_date = :day');
    $statement->execute(['id' => $salonId, 'day' => $day->format('Y-m-d')]);
    if ($statement->fetchColumn()) return [];

    $statement = $pdo->prepare('SELECT opens_at, closes_at FROM salon_hours WHERE salon_id = :id AND weekday = :weekday');
    $statement->execute(['id' => $salonId, 'weekday' => (int) $day->format('N')]);
    $hours = $statement->fetch();
    if (!$hours) return [];
    if ($staffId > 0) {
        $statement = $pdo->prepare('SELECT opens_at, closes_at FROM staff_hours WHERE staff_id = :staff_id AND weekday = :weekday');
        $statement->execute(['staff_id' => $staffId, 'weekday' => (int) $day->format('N')]);
        $staffHours = $statement->fetch();
        if (!$staffHours) return [];
        $hours['opens_at'] = max($hours['opens_at'], $staffHours['opens_at']);
        $hours['closes_at'] = min($hours['closes_at'], $staffHours['closes_at']);
        if ($hours['opens_at'] >= $hours['closes_at']) return [];
    }

    $statement = $pdo->prepare(
        "SELECT starts_at, ends_at FROM appointments
         WHERE salon_id = :id AND status = 'confirmed' AND id <> :excluded"
         . ($staffId > 0 ? ' AND (staff_id = :staff_id OR staff_id IS NULL)' : '') . "
         AND starts_at < :day_end AND ends_at > :day_start"
    );
    $params = [
        'id' => $salonId, 'excluded' => $excludeId,
        'day_start' => $day->format('Y-m-d 00:00:00'),
        'day_end' => $day->modify('+1 day')->format('Y-m-d 00:00:00'),
    ];
    if ($staffId > 0) $params['staff_id'] = $staffId;
    $statement->execute($params);
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

function bookili_queue_email(PDO $pdo, array $appointment, string $kind, DateTimeImmutable $sendAt): void
{
    $formattedDate = (new DateTimeImmutable($appointment['starts_at'], new DateTimeZone('Africa/Algiers')))
        ->format('d/m/Y à H:i');
    $salonPhone = $appointment['salon_phone'] ?: 'Non renseigné';
    $price = number_format((int) $appointment['price_dzd'], 0, ',', ' ') . ' DA';
    $details = "Établissement : {$appointment['salon_name']}\nPrestation : {$appointment['service_name']}\nDate et heure : {$formattedDate}\nAdresse : {$appointment['address']}, {$appointment['city']}\nTéléphone : {$salonPhone}\nPrix à régler sur place : {$price} (aucun paiement en ligne).\n";
    if (in_array($kind, ['confirmation', 'rescheduled'], true) && trim($appointment['booking_message']) !== '') {
        $details .= "\nMessage de {$appointment['salon_name']} :\n{$appointment['booking_message']}\n";
    }
    $content = match ($kind) {
        'confirmation' => ["Votre rendez-vous BOOKILI est confirmé", "Bonjour {$appointment['first_name']},\n\nVotre rendez-vous est confirmé.\n\n{$details}\nConnectez-vous à BOOKILI pour retrouver vos rendez-vous dans votre espace client. Si votre professionnel a créé votre compte, choisissez « Mot de passe oublié » sur la page Mon compte pour définir votre mot de passe."],
        'rescheduled' => ["Votre rendez-vous BOOKILI a été modifié", "Bonjour {$appointment['first_name']},\n\nLa modification de votre rendez-vous est confirmée.\n\n{$details}\nConnectez-vous à BOOKILI pour retrouver vos rendez-vous dans votre espace client."],
        'cancelled' => ["Votre rendez-vous BOOKILI a été annulé", "Bonjour {$appointment['first_name']},\n\nVotre rendez-vous du {$formattedDate} chez {$appointment['salon_name']} a été annulé. Aucun paiement n’a été effectué.\n\nConnectez-vous à BOOKILI pour retrouver vos rendez-vous dans votre espace client."],
        'reminder_7d' => ["Rappel BOOKILI : rendez-vous dans une semaine", "Bonjour {$appointment['first_name']},\n\nPetit rappel : votre rendez-vous BOOKILI aura lieu dans une semaine.\n\n{$details}\nNous vous attendons bientôt !"],
        'reminder_1d' => ["Rappel BOOKILI : rendez-vous demain", "Bonjour {$appointment['first_name']},\n\nPetit rappel : votre rendez-vous BOOKILI aura lieu demain.\n\n{$details}\nNous vous attendons bientôt !"],
    };
    $statement = $pdo->prepare(
        'INSERT INTO notification_outbox
          (appointment_id, appointment_version, kind, recipient, subject, message_body, send_after)
         VALUES (:appointment_id, :version, :kind, :recipient, :subject, :message_body, :send_after)'
    );
    $statement->execute([
        'appointment_id' => $appointment['id'],
        'version' => $appointment['notification_version'],
        'kind' => $kind,
        'recipient' => $appointment['email'],
        'subject' => $content[0],
        'message_body' => $content[1],
        'send_after' => $sendAt->format('Y-m-d H:i:s'),
    ]);
}

function bookili_queue_appointment_emails(PDO $pdo, int $appointmentId, string $event): void
{
    $statement = $pdo->prepare(
        'SELECT b.id, b.notification_version, b.status, b.starts_at, b.service_name, b.price_dzd,
                a.email, c.first_name, s.name AS salon_name, s.city, s.address, s.phone_number AS salon_phone,
                s.booking_message
         FROM appointments b
         INNER JOIN accounts a ON a.id = b.client_id
         INNER JOIN client_profiles c ON c.account_id = b.client_id
         INNER JOIN salons s ON s.id = b.salon_id
         WHERE b.id = :id'
    );
    $statement->execute(['id' => $appointmentId]);
    $appointment = $statement->fetch();
    if (!$appointment || !filter_var($appointment['email'], FILTER_VALIDATE_EMAIL)) {
        throw new RuntimeException('Appointment notification recipient is invalid.');
    }

    $now = bookili_now();
    $eventTime = new DateTimeImmutable($appointment['starts_at'], new DateTimeZone('Africa/Algiers'));
    bookili_queue_email($pdo, $appointment, $event, $now);
    if ($event === 'cancelled') return;

    foreach (['reminder_7d' => '-7 days', 'reminder_1d' => '-1 day'] as $kind => $interval) {
        $sendAt = $eventTime->modify($interval);
        if ($sendAt > $now) {
            bookili_queue_email($pdo, $appointment, $kind, $sendAt);
        }
    }
}
