<?php
declare(strict_types=1);
require_once __DIR__ . '/booking.php';

$method = bookili_booking_method();
$data = $method === 'POST' ? bookili_read_json() : [];

try {
    $pdo = bookili_database();
    $account = bookili_require_role($pdo, ['professional']);
    $salon = bookili_own_salon($pdo, (int) $account['id']);
    if ($method === 'POST') {
        $action = $data['action'] ?? null;
        $name = bookili_required_text($data, 'name', 120);
        $active = $data['isActive'] ?? null;
        if (!is_bool($active) || !in_array($action, ['save'], true)) {
            bookili_json_response(422, ['error' => 'Vérifiez les informations du collaborateur.']);
        }
        $now = bookili_now()->format('Y-m-d H:i:s');
        if (isset($data['staffId'])) {
            $staffId = bookili_id($data['staffId']);
            $statement = $pdo->prepare('SELECT id FROM staff_members WHERE id = :id AND salon_id = :salon_id');
            $statement->execute(['id' => $staffId, 'salon_id' => $salon['id']]);
            if (!$statement->fetchColumn()) bookili_json_response(404, ['error' => 'Collaborateur introuvable.']);
            $statement = $pdo->prepare(
                'UPDATE staff_members SET name = :name, is_active = :active, updated_at = :updated
                 WHERE id = :id AND salon_id = :salon_id'
            );
            $statement->execute([
                'name' => $name, 'active' => (int) $active, 'updated' => $now,
                'id' => $staffId, 'salon_id' => $salon['id'],
            ]);
        } else {
            $statement = $pdo->prepare(
                'INSERT INTO staff_members (salon_id, name, is_active, created_at, updated_at)
                 VALUES (:salon_id, :name, :active, :created, :updated)'
            );
            $statement->execute([
                'salon_id' => $salon['id'], 'name' => $name, 'active' => (int) $active,
                'created' => $now, 'updated' => $now,
            ]);
        }
        $statement = $pdo->prepare(
            'SELECT id, name, is_active FROM staff_members WHERE salon_id = :salon_id ORDER BY is_active DESC, name, id'
        );
        $statement->execute(['salon_id' => $salon['id']]);
        bookili_json_response(200, ['staff' => $statement->fetchAll(), 'message' => 'Collaborateur enregistré.']);
    }

    $statement = $pdo->prepare(
        'SELECT id, name, is_active FROM staff_members WHERE salon_id = :salon_id ORDER BY is_active DESC, name, id'
    );
    $statement->execute(['salon_id' => $salon['id']]);
    bookili_json_response(200, ['staff' => $statement->fetchAll()]);
} catch (Throwable $error) {
    bookili_database_error($error);
}
