<?php
declare(strict_types=1);
require_once __DIR__ . '/booking.php';

$method = bookili_booking_method();
$data = $method === 'POST' ? bookili_read_json() : [];

function bookili_professional_staff_hours(mixed $value): ?array
{
    if ($value === null) return null;
    if (!is_array($value) || !array_is_list($value) || count($value) > 7) {
        bookili_json_response(422, ['error' => 'Vérifiez les horaires du collaborateur.']);
    }
    $result = [];
    foreach ($value as $row) {
        if (!is_array($row) || !isset($row['weekday'], $row['opens_at'], $row['closes_at'])
            || !is_int($row['weekday']) || $row['weekday'] < 1 || $row['weekday'] > 7
            || !is_string($row['opens_at']) || !preg_match('/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/D', $row['opens_at'])
            || !is_string($row['closes_at']) || !preg_match('/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/D', $row['closes_at'])
            || $row['opens_at'] >= $row['closes_at'] || isset($result[$row['weekday']])) {
            bookili_json_response(422, ['error' => 'Chaque jour ouvert doit avoir un horaire valide et unique.']);
        }
        $result[$row['weekday']] = [
            'weekday' => $row['weekday'], 'opens_at' => $row['opens_at'], 'closes_at' => $row['closes_at'],
        ];
    }
    return array_values($result);
}

function bookili_professional_staff_rows(PDO $pdo, int $salonId): array
{
    $statement = $pdo->prepare(
        'SELECT m.id, m.name, m.is_active, h.weekday, h.opens_at, h.closes_at
         FROM staff_members m
         LEFT JOIN staff_hours h ON h.staff_id = m.id
         WHERE m.salon_id = :salon_id
         ORDER BY m.is_active DESC, m.name, m.id, h.weekday'
    );
    $statement->execute(['salon_id' => $salonId]);
    $staff = [];
    foreach ($statement->fetchAll() as $row) {
        $id = (int) $row['id'];
        if (!isset($staff[$id])) {
            $staff[$id] = [
                'id' => $id, 'name' => $row['name'], 'is_active' => $row['is_active'], 'hours' => [],
            ];
        }
        if ($row['weekday'] !== null) {
            $staff[$id]['hours'][] = [
                'weekday' => (int) $row['weekday'], 'opens_at' => $row['opens_at'], 'closes_at' => $row['closes_at'],
            ];
        }
    }
    return array_values($staff);
}

try {
    $pdo = bookili_database();
    $account = bookili_require_role($pdo, ['professional']);
    if ($method === 'POST') {
        $action = $data['action'] ?? null;
        $name = bookili_required_text($data, 'name', 120);
        $active = $data['isActive'] ?? null;
        $hours = bookili_professional_staff_hours($data['hours'] ?? null);
        if (!is_bool($active) || !in_array($action, ['save'], true)) {
            bookili_json_response(422, ['error' => 'Vérifiez les informations du collaborateur.']);
        }
        $pdo->beginTransaction();
        $salon = bookili_own_salon($pdo, (int) $account['id'], true);
        $now = bookili_now()->format('Y-m-d H:i:s');
        if (isset($data['staffId'])) {
            $staffId = bookili_id($data['staffId']);
            $statement = $pdo->prepare('SELECT id FROM staff_members WHERE id = :id AND salon_id = :salon_id FOR UPDATE');
            $statement->execute(['id' => $staffId, 'salon_id' => $salon['id']]);
            if (!$statement->fetchColumn()) {
                $pdo->rollBack();
                bookili_json_response(404, ['error' => 'Collaborateur introuvable.']);
            }
            $statement = $pdo->prepare(
                'SELECT id FROM staff_members WHERE salon_id = :salon_id AND name = :name AND id <> :staff_id'
            );
            $statement->execute(['salon_id' => $salon['id'], 'name' => $name, 'staff_id' => $staffId]);
            if ($statement->fetchColumn()) {
                $pdo->rollBack();
                bookili_json_response(409, ['error' => 'Un collaborateur porte déjà ce nom.']);
            }
            $statement = $pdo->prepare(
                'UPDATE staff_members SET name = :name, is_active = :active, updated_at = :updated
                 WHERE id = :id AND salon_id = :salon_id'
            );
            $statement->execute([
                'name' => $name, 'active' => (int) $active, 'updated' => $now,
                'id' => $staffId, 'salon_id' => $salon['id'],
            ]);
        } else {
            $statement = $pdo->prepare('SELECT id FROM staff_members WHERE salon_id = :salon_id AND name = :name');
            $statement->execute(['salon_id' => $salon['id'], 'name' => $name]);
            if ($statement->fetchColumn()) {
                $pdo->rollBack();
                bookili_json_response(409, ['error' => 'Un collaborateur porte déjà ce nom.']);
            }
            $statement = $pdo->prepare(
                'INSERT INTO staff_members (salon_id, name, is_active, created_at, updated_at)
                 VALUES (:salon_id, :name, :active, :created, :updated)'
            );
            $statement->execute([
                'salon_id' => $salon['id'], 'name' => $name, 'active' => (int) $active,
                'created' => $now, 'updated' => $now,
            ]);
            $staffId = (int) $pdo->lastInsertId();
            $pdo->prepare(
                'INSERT INTO staff_hours (staff_id, weekday, opens_at, closes_at)
                 SELECT :staff_id, weekday, opens_at, closes_at FROM salon_hours WHERE salon_id = :salon_id'
            )->execute(['staff_id' => $staffId, 'salon_id' => $salon['id']]);
        }
        if ($hours !== null) {
            $pdo->prepare('DELETE FROM staff_hours WHERE staff_id = :staff_id')->execute(['staff_id' => $staffId]);
            $insert = $pdo->prepare(
                'INSERT INTO staff_hours (staff_id, weekday, opens_at, closes_at)
                 VALUES (:staff_id, :weekday, :opens_at, :closes_at)'
            );
            foreach ($hours as $hour) {
                $insert->execute([
                    'staff_id' => $staffId, 'weekday' => $hour['weekday'],
                    'opens_at' => $hour['opens_at'], 'closes_at' => $hour['closes_at'],
                ]);
            }
        }
        $pdo->commit();
        bookili_json_response(200, [
            'staff' => bookili_professional_staff_rows($pdo, (int) $salon['id']),
            'message' => 'Collaborateur et horaires enregistrés.',
        ]);
    }

    $salon = bookili_own_salon($pdo, (int) $account['id']);
    bookili_json_response(200, ['staff' => bookili_professional_staff_rows($pdo, (int) $salon['id'])]);
} catch (Throwable $error) {
    if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
    bookili_database_error($error);
}
