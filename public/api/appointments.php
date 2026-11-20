<?php
declare(strict_types=1);
require_once __DIR__ . '/booking.php';

$method = bookili_booking_method();
$data = $method === 'POST' ? bookili_read_json() : [];

try {
    $pdo = bookili_database();
    $account = bookili_require_role($pdo, ['client', 'professional']);
    $professional = $account['role'] === 'professional';
    $now = bookili_now()->format('Y-m-d H:i:s');

    if ($method === 'GET') {
        $params = [];
        $sql = "SELECT b.id, b.salon_id, b.service_id, b.staff_id, m.name AS staff_name,
                       b.service_name, b.price_dzd, b.starts_at, b.ends_at, b.status,
                       s.name AS salon_name, s.city, s.address, s.phone_number AS salon_phone";
        if ($professional) $sql .= ', c.first_name, c.last_name, c.phone_number AS client_phone';
        else $sql .= ', (SELECT COUNT(*) FROM appointment_services aps WHERE aps.appointment_id = b.id) AS service_count';
        $sql .= ' FROM appointments b INNER JOIN salons s ON s.id = b.salon_id
                  LEFT JOIN staff_members m ON m.id = b.staff_id';
        if ($professional) {
            $salon = bookili_own_salon($pdo, (int) $account['id']);
            $sql .= ' INNER JOIN client_profiles c ON c.account_id = b.client_id WHERE b.salon_id = :salon_id';
            $params['salon_id'] = $salon['id'];
            if (isset($_GET['staffId'])) {
                $staffId = bookili_id($_GET['staffId']);
                $sql .= ' AND b.staff_id = :staff_id';
                $params['staff_id'] = $staffId;
            }
            $date = $_GET['date'] ?? bookili_now()->format('Y-m-d');
            $day = bookili_calendar_date($date);
            $sql .= ' AND b.starts_at >= :day_start AND b.starts_at < :day_end';
            $params += ['day_start' => $day->format('Y-m-d 00:00:00'), 'day_end' => $day->modify('+1 day')->format('Y-m-d 00:00:00')];
        } else {
            $filter = $_GET['filter'] ?? 'upcoming';
            if (!in_array($filter, ['upcoming', 'past'], true)) bookili_json_response(422, ['error' => 'Filtre invalide.']);
            $sql .= ' WHERE b.client_id = :client_id AND b.starts_at ' . ($filter === 'past' ? '<' : '>=') . ' :now';
            $params += ['client_id' => $account['id'], 'now' => $now];
        }
        $sql .= ' ORDER BY b.starts_at ' . (!$professional && $filter === 'past' ? 'DESC' : 'ASC') . ', b.id';
        $page = isset($_GET['page']) ? bookili_id($_GET['page']) : 1;
        if ($page > 10000) bookili_json_response(422, ['error' => 'Page invalide.']);
        $sql .= ' LIMIT 51 OFFSET ' . (($page - 1) * 50);
        $statement = $pdo->prepare($sql);
        $statement->execute($params);
        $rows = $statement->fetchAll();
        $appointments = array_slice($rows, 0, 50);
        if (!$professional && $appointments) {
            $ids = array_column($appointments, 'id');
            $placeholders = implode(',', array_fill(0, count($ids), '?'));
            $serviceStatement = $pdo->prepare(
                "SELECT appointment_id, service_id, service_name, duration_minutes, price_dzd FROM appointment_services
                 WHERE appointment_id IN ($placeholders) ORDER BY appointment_id, position"
            );
            $serviceStatement->execute($ids);
            $services = [];
            foreach ($serviceStatement->fetchAll() as $row) {
                $services[$row['appointment_id']][] = [
                    'id' => (int) $row['service_id'], 'name' => $row['service_name'],
                    'duration_minutes' => (int) $row['duration_minutes'], 'price_dzd' => (int) $row['price_dzd'],
                ];
            }
            foreach ($appointments as &$appointment) {
                $appointment['services'] = $services[$appointment['id']] ?? [];
            }
            unset($appointment);
        }
        bookili_json_response(200, ['appointments' => $appointments, 'hasMore' => count($rows) > 50]);
    }

    $action = $data['action'] ?? '';
    if (!in_array($action, ['book', 'reschedule', 'cancel'], true)) {
        bookili_json_response(422, ['error' => 'Action non autorisée.']);
    }
    $newClient = null;
    $existingClientId = null;
    $appointmentId = $action !== 'book' ? bookili_id($data['appointmentId'] ?? null) : null;
    if ($action === 'book') {
        if ($professional) {
            if (isset($data['newClient'], $data['clientId'])) {
                bookili_json_response(422, ['error' => 'Sélectionnez un client existant ou saisissez un nouveau client, pas les deux.']);
            }
            $salonId = (int) bookili_own_salon($pdo, (int) $account['id'])['id'];
            if (isset($data['newClient'])) {
                if (!is_array($data['newClient'])) bookili_json_response(422, ['error' => 'Informations du client invalides.']);
                $newClient = $data['newClient'];
                $newClient['firstName'] = bookili_required_text($newClient, 'firstName', 100);
                $newClient['lastName'] = bookili_required_text($newClient, 'lastName', 100);
                $newClient['email'] = bookili_normalize_email($newClient);
                $newClient['phone'] = bookili_required_text($newClient, 'phone', 32);
                $newClient['dateOfBirth'] = bookili_required_text($newClient, 'dateOfBirth', 10);
                $birthDate = DateTimeImmutable::createFromFormat('!Y-m-d', $newClient['dateOfBirth']);
                if (!bookili_valid_phone($newClient['phone'])
                    || !$birthDate || $birthDate->format('Y-m-d') !== $newClient['dateOfBirth']
                    || $birthDate > new DateTimeImmutable('today')) {
                    bookili_json_response(422, ['error' => 'Vérifiez le téléphone et la date de naissance du client.']);
                }
            } else {
                $existingClientId = bookili_id($data['clientId'] ?? null);
            }
        } else {
            $salonId = bookili_id($data['salonId'] ?? null);
        }
    } else {
        $statement = $pdo->prepare('SELECT salon_id FROM appointments WHERE id = :id');
        $statement->execute(['id' => $appointmentId]);
        $salonId = $statement->fetchColumn();
        if ($salonId === false) bookili_json_response(404, ['error' => 'Rendez-vous introuvable.']);
        $salonId = (int) $salonId;
    }
    if ($action !== 'cancel') {
        $serviceIds = $data['serviceIds'] ?? [$data['serviceId'] ?? null];
        if (!is_array($serviceIds) || !array_is_list($serviceIds)) {
            bookili_json_response(422, ['error' => 'Sélection de prestations invalide.']);
        }
        $staffId = isset($data['staffId']) ? bookili_id($data['staffId']) : 0;
        $day = bookili_booking_date($data['date'] ?? null);
        $time = $data['time'] ?? null;
        if (!is_string($time) || !preg_match('/^([01][0-9]|2[0-3]):[0-5][0-9]$/D', $time)
            || !is_int($data['expectedPrice'] ?? null) || !is_int($data['expectedDuration'] ?? null)) {
            bookili_json_response(422, ['error' => 'Vérifiez l’horaire et la prestation sélectionnée.']);
        }
    }
    bookili_rate_limit($pdo, 'appointments', 120);
    $pdo->beginTransaction();
    // All booking, cancellation and schedule edits lock this salon first.
    $statement = $pdo->prepare('SELECT id FROM salons WHERE id = :id FOR UPDATE');
    $statement->execute(['id' => $salonId]);
    if (!$statement->fetch()) throw new RuntimeException('Appointment salon is missing.');
    if ($professional) {
        $ownSalon = bookili_own_salon($pdo, (int) $account['id'], true);
        if ((int) $ownSalon['id'] !== $salonId) {
            $pdo->rollBack();
            bookili_json_response(404, ['error' => 'Établissement introuvable.']);
        }
    }

    $clientId = (int) $account['id'];
    if ($action === 'book' && $professional) {
        if ($newClient !== null) {
            $pdo->prepare(
                "INSERT INTO accounts (email, password_hash, role, status)
                 VALUES (:email, :password, 'client', 'active')"
            )->execute([
                'email' => $newClient['email'],
                'password' => password_hash(bin2hex(random_bytes(32)), PASSWORD_DEFAULT),
            ]);
            $clientId = (int) $pdo->lastInsertId();
            $pdo->prepare(
                'INSERT INTO client_profiles (account_id, first_name, last_name, date_of_birth, phone_number)
                 VALUES (:account, :first, :last, :birth, :phone)'
            )->execute([
                'account' => $clientId, 'first' => $newClient['firstName'], 'last' => $newClient['lastName'],
                'birth' => $newClient['dateOfBirth'], 'phone' => $newClient['phone'],
            ]);
            $pdo->prepare(
                'INSERT INTO client_marketing_preferences (account_id, consent, updated_at) VALUES (:id, 0, :updated)'
            )->execute(['id' => $clientId, 'updated' => bookili_now()->format('Y-m-d H:i:s')]);
        } else {
            $statement = $pdo->prepare(
                "SELECT id FROM accounts WHERE id = :id AND role = 'client' AND status = 'active' FOR UPDATE"
            );
            $statement->execute(['id' => $existingClientId]);
            $clientId = (int) $statement->fetchColumn();
            if ($clientId < 1) {
                $pdo->rollBack();
                bookili_json_response(404, ['error' => 'Client introuvable ou compte indisponible.']);
            }
        }
    }

    if ($action !== 'book') {
        $statement = $pdo->prepare('SELECT * FROM appointments WHERE id = :id FOR UPDATE');
        $statement->execute(['id' => $appointmentId]);
        $appointment = $statement->fetch();
        if (!$appointment) {
            $pdo->rollBack();
            bookili_json_response(404, ['error' => 'Rendez-vous introuvable.']);
        }
        $owns = $professional
            ? (int) bookili_own_salon($pdo, (int) $account['id'])['id'] === $salonId
            : (int) $appointment['client_id'] === (int) $account['id'];
        if (!$owns) {
            $pdo->rollBack();
            bookili_json_response(404, ['error' => 'Rendez-vous introuvable.']);
        }
        if ($appointment['status'] !== 'confirmed' || $appointment['starts_at'] <= bookili_now()->format('Y-m-d H:i:s')) {
            $pdo->rollBack();
            bookili_json_response(409, ['error' => 'Ce rendez-vous ne peut plus être modifié.']);
        }
        $statement = $pdo->prepare('SELECT id, voided_at FROM cash_sales WHERE appointment_id = :id');
        $statement->execute(['id' => $appointmentId]);
        $linkedSale = $statement->fetch();
        if ($linkedSale && ($action === 'reschedule' || $linkedSale['voided_at'] === null)) {
            $pdo->rollBack();
            bookili_json_response(409, ['error' => 'Un rendez-vous déjà enregistré en caisse ne peut plus être déplacé. Pour l’annuler, annulez d’abord la vente dans le journal de caisse.']);
        }
    }
    if ($action === 'cancel') {
        $pdo->prepare("UPDATE appointments SET status = 'cancelled', notification_version = notification_version + 1 WHERE id = :id")
            ->execute(['id' => $appointmentId]);
        $pdo->prepare(
            "UPDATE notification_outbox SET status = 'cancelled'
             WHERE appointment_id = :id AND kind IN ('reminder_7d', 'reminder_1d')
             AND status IN ('queued', 'retry')"
        )->execute(['id' => $appointmentId]);
        bookili_queue_appointment_emails($pdo, $appointmentId, 'cancelled');
    } else {
        if (!$professional) bookili_public_salon($pdo, $salonId);
        $service = bookili_selected_services($pdo, $salonId, $serviceIds);
        $staff = bookili_salon_staff($pdo, $salonId);
        if (count($staff) > 0 && $staffId === 0) {
            $pdo->rollBack();
            bookili_json_response(422, ['error' => 'Choisissez un collaborateur pour ce rendez-vous.']);
        }
        if ((int) $service['price_dzd'] !== $data['expectedPrice']
            || (int) $service['duration_minutes'] !== $data['expectedDuration']) {
            $pdo->rollBack();
            bookili_json_response(409, ['error' => 'Le tarif ou la durée a changé. Rechargez la page pour consulter la prestation avant de confirmer.']);
        }
        $slots = bookili_slots($pdo, $salonId, $service, $day, $appointmentId ?? 0, $staffId);
        if (!in_array($time, $slots, true)) {
            $pdo->rollBack();
            bookili_json_response(409, ['error' => 'Ce créneau n’est plus disponible. Choisissez un autre horaire.']);
        }
        $starts = new DateTimeImmutable($day->format('Y-m-d') . ' ' . $time, new DateTimeZone('Africa/Algiers'));
        $ends = $starts->modify('+' . (int) $service['duration_minutes'] . ' minutes');
        $params = [
            'service_id' => $service['id'], 'service_name' => $service['name'], 'price' => $service['price_dzd'],
            'starts' => $starts->format('Y-m-d H:i:s'), 'ends' => $ends->format('Y-m-d H:i:s'),
            'staff_id' => $staffId > 0 ? $staffId : null,
        ];
        if ($action === 'book') {
            $sql = 'INSERT INTO appointments (salon_id, client_id, service_id, staff_id, service_name, price_dzd, starts_at, ends_at)
                    VALUES (:salon_id, :client_id, :service_id, :staff_id, :service_name, :price, :starts, :ends)';
            $params += ['salon_id' => $salonId, 'client_id' => $clientId];
        } else {
            $sql = 'UPDATE appointments SET service_id = :service_id, staff_id = :staff_id, service_name = :service_name, price_dzd = :price,
                    starts_at = :starts, ends_at = :ends, notification_version = notification_version + 1 WHERE id = :id';
            $params['id'] = $appointmentId;
        }
        $pdo->prepare($sql)->execute($params);
        if ($action === 'book') $appointmentId = (int) $pdo->lastInsertId();
        else {
            $pdo->prepare(
                "UPDATE notification_outbox SET status = 'cancelled'
                 WHERE appointment_id = :id AND kind IN ('reminder_7d', 'reminder_1d')
                 AND status IN ('queued', 'retry')"
            )->execute(['id' => $appointmentId]);
        }
        bookili_save_appointment_services($pdo, $appointmentId, $service);
        bookili_queue_appointment_emails($pdo, $appointmentId, $action === 'book' ? 'confirmation' : 'rescheduled');
    }
    $pdo->commit();
    $response = ['appointmentId' => $appointmentId, 'message' => $action === 'cancel' ? 'Rendez-vous annulé.' : 'Votre rendez-vous est confirmé.'];
    if ($action !== 'cancel') {
        $response['services'] = array_map(static fn(array $item): array => [
            'id' => (int) $item['id'], 'name' => $item['name'],
            'duration_minutes' => (int) $item['duration_minutes'], 'price_dzd' => (int) $item['price_dzd'],
        ], $service['services']);
    }
    bookili_json_response($action === 'book' ? 201 : 200, $response);
} catch (Throwable $error) {
    if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
    if ($error instanceof PDOException && $error->getCode() === '23000') {
        bookili_json_response(409, ['error' => 'Un compte existe déjà avec cette adresse e-mail. Recherchez le client par son nom ou son téléphone.']);
    }
    bookili_database_error($error);
}
