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
        $category = $data['category'] ?? null;
        $duration = $data['duration'] ?? null;
        $price = $data['price'] ?? null;
        $active = $data['isActive'] ?? null;
        $id = isset($data['id']) ? bookili_id($data['id']) : null;
        if (!is_string($category) || !in_array($category, BOOKILI_SERVICE_CATEGORIES, true)
            || !is_int($duration) || $duration < 15 || $duration > 480 || $duration % 15 !== 0
            || !is_int($price) || $price < 0 || $price > 10000000 || !is_bool($active)) {
            bookili_json_response(422, ['error' => 'Vérifiez la catégorie, le prix en DA et la durée (15 à 480 minutes, par pas de 15).']);
        }
        $pdo->beginTransaction();
        $salon = bookili_own_salon($pdo, (int) $account['id'], true);
        if ($id !== null) {
            $statement = $pdo->prepare('SELECT id FROM services WHERE id = :id AND salon_id = :salon_id');
            $statement->execute(['id' => $id, 'salon_id' => $salon['id']]);
            if (!$statement->fetch()) {
                $pdo->rollBack();
                bookili_json_response(404, ['error' => 'Cette prestation n’existe pas dans votre salon.']);
            }
            $query = 'UPDATE services SET name = :name, category = :category, duration_minutes = :duration,
                      price_dzd = :price, is_active = :active WHERE id = :id AND salon_id = :salon_id';
        } else {
            $query = 'INSERT INTO services (salon_id, name, category, duration_minutes, price_dzd, is_active)
                      VALUES (:salon_id, :name, :category, :duration, :price, :active)';
        }
        $params = ['salon_id' => $salon['id'], 'name' => $name, 'category' => $category, 'duration' => $duration, 'price' => $price, 'active' => (int) $active];
        if ($id !== null) $params['id'] = $id;
        $pdo->prepare($query)->execute($params);
        $pdo->commit();
    }
    $salon = bookili_own_salon($pdo, (int) $account['id']);
    $statement = $pdo->prepare('SELECT id, name, category, duration_minutes, price_dzd, is_active FROM services WHERE salon_id = :id ORDER BY id');
    $statement->execute(['id' => $salon['id']]);
    bookili_json_response(200, ['services' => $statement->fetchAll()]);
} catch (Throwable $error) {
    if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
    bookili_database_error($error);
}
