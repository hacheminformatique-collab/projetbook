<?php
declare(strict_types=1);
require_once __DIR__ . '/inventory.php';

$method = bookili_booking_method();
$data = $method === 'POST' ? bookili_read_json() : [];

try {
    $pdo = bookili_database();
    $account = bookili_require_role($pdo, ['professional']);
    $productId = bookili_id($method === 'POST' ? ($data['productId'] ?? null) : ($_GET['productId'] ?? null));
    if ($method === 'POST') {
        $quantity = bookili_inventory_integer($data, 'quantity', 1000000, 1);
        $reason = bookili_required_text($data, 'reason', 255);
        $direction = $data['direction'] ?? null;
        $requestKey = $data['requestKey'] ?? null;
        if (!in_array($direction, ['in', 'out'], true) || !is_string($requestKey)
            || !preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/D', $requestKey)) {
            bookili_json_response(422, ['error' => 'Mouvement invalide. Rechargez le formulaire et vérifiez le sens du mouvement.']);
        }
        $delta = $direction === 'in' ? $quantity : -$quantity;
        $pdo->beginTransaction();
        $salon = bookili_own_salon($pdo, (int) $account['id'], true);
        $product = bookili_own_product($pdo, (int) $salon['id'], $productId, true);
        $statement = $pdo->prepare(
            'SELECT quantity_delta, reason FROM stock_movements WHERE product_id = :id AND request_key = :request_key'
        );
        $statement->execute(['id' => $productId, 'request_key' => $requestKey]);
        $previous = $statement->fetch();
        if ($previous) {
            $pdo->rollBack();
            if ((int) $previous['quantity_delta'] !== $delta || $previous['reason'] !== $reason) {
                bookili_json_response(409, ['error' => 'Cette demande a déjà été utilisée pour un autre mouvement. Actualisez le stock.']);
            }
            bookili_json_response(200, ['message' => 'Ce mouvement a déjà été enregistré.', 'duplicate' => true]);
        }
        $after = (int) $product['quantity'] + $delta;
        if (!(int) $product['is_active'] || $after < 0 || $after > 1000000) {
            $pdo->rollBack();
            bookili_json_response(409, ['error' => 'Mouvement refusé : produit archivé, stock insuffisant ou limite de 1 000 000 unités dépassée. Actualisez le stock.']);
        }
        bookili_write_stock_movement($pdo, $productId, (int) $account['id'], $requestKey, $delta, $after, $reason, bookili_now()->format('Y-m-d H:i:s'));
        $pdo->commit();
        bookili_json_response(200, ['message' => 'Mouvement de stock enregistré.', 'duplicate' => false]);
    }
    $salon = bookili_own_salon($pdo, (int) $account['id']);
    $product = bookili_own_product($pdo, (int) $salon['id'], $productId);
    $page = isset($_GET['page']) ? bookili_id($_GET['page']) : 1;
    if ($page > 10000) bookili_json_response(422, ['error' => 'Page invalide.']);
    $statement = $pdo->prepare(
        'SELECT id, quantity_delta, quantity_after, reason, created_at
         FROM stock_movements WHERE product_id = :id ORDER BY id DESC LIMIT 51 OFFSET ' . (($page - 1) * 50)
    );
    $statement->execute(['id' => $productId]);
    $movements = $statement->fetchAll();
    bookili_json_response(200, [
        'product' => $product, 'movements' => array_slice($movements, 0, 50), 'hasMore' => count($movements) > 50,
    ]);
} catch (Throwable $error) {
    if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
    bookili_database_error($error);
}
