<?php
declare(strict_types=1);
require_once __DIR__ . '/booking.php';

$method = bookili_booking_method();
$data = $method === 'POST' ? bookili_read_json() : [];

try {
    $pdo = bookili_database();
    $account = bookili_require_role($pdo, ['professional']);
    $salon = bookili_own_salon($pdo, (int) $account['id']);
    if (isset($_GET['clients'])) {
        $query = trim(is_string($_GET['clients']) ? $_GET['clients'] : '');
        if (strlen($query) < 2 || strlen($query) > 100) {
            bookili_json_response(422, ['error' => 'Saisissez au moins 2 caractères pour rechercher un client.']);
        }
        bookili_rate_limit($pdo, 'professional-client-search', 120);
        $statement = $pdo->prepare(
            "SELECT c.account_id AS id, c.first_name, c.last_name, c.phone_number, c.date_of_birth, a.email,
                    MAX(b.starts_at) AS latest_appointment
             FROM appointments b
             INNER JOIN client_profiles c ON c.account_id = b.client_id
             INNER JOIN accounts a ON a.id = c.account_id AND a.status = 'active' AND a.role = 'client'
             WHERE b.salon_id = :salon AND b.client_id <> :professional AND b.status IN ('confirmed', 'cancelled')
               AND (LOCATE(:name, CONCAT(c.first_name, ' ', c.last_name)) > 0
                    OR LOCATE(:first, c.first_name) > 0 OR LOCATE(:last, c.last_name) > 0
                    OR LOCATE(:phone, REPLACE(c.phone_number, ' ', '')) > 0)
             GROUP BY c.account_id, c.first_name, c.last_name, c.phone_number, c.date_of_birth, a.email
             ORDER BY latest_appointment DESC, c.last_name, c.first_name LIMIT 20"
        );
        $phoneSearch = preg_match('/^[+0-9\s().-]+$/D', $query)
            ? preg_replace('/[^0-9+]/', '', $query)
            : $query;
        $statement->execute([
            'salon' => $salon['id'], 'professional' => $account['id'],
            'name' => $query, 'first' => $query, 'last' => $query, 'phone' => $phoneSearch,
        ]);
        bookili_json_response(200, ['clients' => $statement->fetchAll()]);
    }
    if ($method === 'POST') {
        $appointmentId = bookili_id($data['appointmentId'] ?? null);
        $note = $data['note'] ?? null;
        if (!is_string($note) || strlen($note) > 4000 || str_contains($note, "\0")) {
            bookili_json_response(422, ['error' => 'La note doit contenir au maximum 4 000 octets.']);
        }
        bookili_rate_limit($pdo, 'appointment-notes', 120);
        $pdo->beginTransaction();
        bookili_own_salon($pdo, (int) $account['id'], true);
        $statement = $pdo->prepare('SELECT id FROM appointments WHERE id = :id AND salon_id = :salon FOR UPDATE');
        $statement->execute(['id' => $appointmentId, 'salon' => $salon['id']]);
        if (!$statement->fetchColumn()) {
            $pdo->rollBack();
            bookili_json_response(404, ['error' => 'Rendez-vous introuvable.']);
        }
        $pdo->prepare(
            'INSERT INTO appointment_private_notes (appointment_id, note, updated_at) VALUES (:id, :note, :updated)
             ON DUPLICATE KEY UPDATE note = VALUES(note), updated_at = VALUES(updated_at)'
        )->execute(['id' => $appointmentId, 'note' => trim($note), 'updated' => bookili_now()->format('Y-m-d H:i:s')]);
        $pdo->commit();
        bookili_json_response(200, ['message' => 'Note privée enregistrée.']);
    }

    if (isset($_GET['historyFor'])) {
        $appointmentId = bookili_id($_GET['historyFor']);
        $statement = $pdo->prepare('SELECT client_id FROM appointments WHERE id = :id AND salon_id = :salon');
        $statement->execute(['id' => $appointmentId, 'salon' => $salon['id']]);
        $clientId = $statement->fetchColumn();
        if ($clientId === false) bookili_json_response(404, ['error' => 'Rendez-vous introuvable.']);
        $statement = $pdo->prepare(
            "SELECT b.id, b.starts_at, b.service_name, n.note
             FROM appointments b INNER JOIN appointment_private_notes n ON n.appointment_id = b.id
             WHERE b.salon_id = :salon AND b.client_id = :client AND b.id <> :id
               AND b.status = 'confirmed' AND b.ends_at <= :now AND n.note <> ''
             ORDER BY b.starts_at DESC, b.id DESC LIMIT 10"
        );
        $statement->execute([
            'salon' => $salon['id'], 'client' => $clientId, 'id' => $appointmentId,
            'now' => bookili_now()->format('Y-m-d H:i:s'),
        ]);
        bookili_json_response(200, ['history' => $statement->fetchAll()]);
    }

    $day = bookili_calendar_date($_GET['date'] ?? bookili_now()->format('Y-m-d'));
    $statement = $pdo->prepare(
        'SELECT b.id, b.client_id, b.service_id, b.staff_id, b.service_name, b.price_dzd, cs.id AS cash_sale_id, cs.voided_at,
                b.starts_at, b.ends_at, c.first_name, c.last_name, c.phone_number, c.date_of_birth,
                a.email, COALESCE(n.note, \'\') AS private_note
         FROM appointments b
         INNER JOIN client_profiles c ON c.account_id = b.client_id
         INNER JOIN accounts a ON a.id = b.client_id
         LEFT JOIN appointment_private_notes n ON n.appointment_id = b.id
         LEFT JOIN cash_sales cs ON cs.appointment_id = b.id
         WHERE b.salon_id = :salon AND b.status = \'confirmed\'
           AND b.starts_at < :day_end AND b.ends_at > :day_start
         ORDER BY b.starts_at, b.id LIMIT 1001'
    );
    $statement->execute([
        'salon' => $salon['id'], 'day_start' => $day->format('Y-m-d 00:00:00'),
        'day_end' => $day->modify('+1 day')->format('Y-m-d 00:00:00'),
    ]);
    $appointments = $statement->fetchAll();
    if (count($appointments) > 1000) bookili_json_response(422, ['error' => 'Trop de rendez-vous à afficher pour cette journée.']);
    if ($appointments) {
        $ids = array_column($appointments, 'id');
        $placeholders = implode(',', array_fill(0, count($ids), '?'));
        $serviceStatement = $pdo->prepare(
            "SELECT appointment_id, service_id, service_name, duration_minutes, price_dzd
             FROM appointment_services WHERE appointment_id IN ($placeholders) ORDER BY appointment_id, position"
        );
        $serviceStatement->execute($ids);
        $serviceRows = [];
        foreach ($serviceStatement->fetchAll() as $row) {
            $serviceRows[$row['appointment_id']][] = [
                'id' => (int) $row['service_id'], 'name' => $row['service_name'],
                'duration_minutes' => (int) $row['duration_minutes'], 'price_dzd' => (int) $row['price_dzd'],
            ];
        }
        foreach ($appointments as &$appointment) {
            $appointment['services'] = $serviceRows[$appointment['id']] ?? [[
                'id' => (int) $appointment['service_id'], 'name' => $appointment['service_name'],
                'duration_minutes' => (int) ((strtotime($appointment['ends_at']) - strtotime($appointment['starts_at'])) / 60),
                'price_dzd' => (int) $appointment['price_dzd'],
            ]];
            $appointment['id'] = (int) $appointment['id'];
            $appointment['service_id'] = (int) $appointment['service_id'];
        }
        unset($appointment);
    }
    $statement = $pdo->prepare(
        'SELECT m.id, m.name, m.is_active, h.opens_at, h.closes_at
         FROM staff_members m LEFT JOIN staff_hours h ON h.staff_id = m.id AND h.weekday = :weekday
         WHERE m.salon_id = :salon ORDER BY m.is_active DESC, m.name, m.id'
    );
    $statement->execute(['salon' => $salon['id'], 'weekday' => (int) $day->format('N')]);
    $staff = $statement->fetchAll();
    $statement = $pdo->prepare('SELECT opens_at, closes_at FROM salon_hours WHERE salon_id = :salon AND weekday = :weekday');
    $statement->execute(['salon' => $salon['id'], 'weekday' => (int) $day->format('N')]);
    $hours = $statement->fetch();
    $statement = $pdo->prepare('SELECT 1 FROM salon_closures WHERE salon_id = :salon AND closure_date = :day');
    $statement->execute(['salon' => $salon['id'], 'day' => $day->format('Y-m-d')]);
    $closed = (bool) $statement->fetchColumn();
    $statement = $pdo->prepare('SELECT id, name, duration_minutes, price_dzd FROM services WHERE salon_id = :salon AND is_active = 1 ORDER BY name, id');
    $statement->execute(['salon' => $salon['id']]);
    $services = $statement->fetchAll();
    $statement = $pdo->prepare(
        'SELECT agenda_show_time, agenda_show_client, agenda_show_services,
                agenda_show_note, agenda_show_add_button FROM salons WHERE id = :id'
    );
    $statement->execute(['id' => $salon['id']]);
    $displaySettings = $statement->fetch();
    bookili_json_response(200, [
        'salonId' => (int) $salon['id'], 'date' => $day->format('Y-m-d'),
        'hours' => $hours ?: null, 'closed' => $closed, 'staff' => $staff,
        'appointments' => $appointments, 'services' => $services,
        'displaySettings' => [
            'showTime' => (bool) $displaySettings['agenda_show_time'],
            'showClient' => (bool) $displaySettings['agenda_show_client'],
            'showServices' => (bool) $displaySettings['agenda_show_services'],
            'showNote' => (bool) $displaySettings['agenda_show_note'],
            'showAddButton' => (bool) $displaySettings['agenda_show_add_button'],
        ],
    ]);
} catch (Throwable $error) {
    if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
    bookili_database_error($error);
}
