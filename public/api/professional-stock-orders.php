<?php
declare(strict_types=1);
require_once __DIR__ . '/inventory.php';

function bookili_order_error(PDO $pdo, int $status, string $message): never
{
    if ($pdo->inTransaction()) $pdo->rollBack();
    bookili_json_response($status, ['error' => $message]);
}

function bookili_order_lines(array $data): array
{
    $items = $data['items'] ?? null;
    if (!is_array($items) || !array_is_list($items) || count($items) < 1 || count($items) > 50) {
        bookili_json_response(422, ['error' => 'Indiquez entre 1 et 50 produits par opération.']);
    }
    $lines = [];
    foreach ($items as $item) {
        if (!is_array($item)) bookili_json_response(422, ['error' => 'Ligne de commande invalide.']);
        $id = bookili_id($item['productId'] ?? null);
        if (isset($lines[$id])) bookili_json_response(422, ['error' => 'Un produit ne peut apparaître qu’une fois.']);
        $lines[$id] = bookili_inventory_integer($item, 'quantity', 1000000, 1);
    }
    ksort($lines, SORT_NUMERIC);
    return $lines;
}

$method = bookili_booking_method();
$data = $method === 'POST' ? bookili_read_json() : [];

try {
    $pdo = bookili_database();
    $account = bookili_require_role($pdo, ['professional']);
    if ($method === 'GET') {
        $salon = bookili_own_salon($pdo, (int) $account['id']);
        if (isset($_GET['orderId'])) {
            $id = bookili_id($_GET['orderId']);
            $statement = $pdo->prepare(
                'SELECT o.id, o.status, o.reference, o.supplier_name, o.created_at,
                        i.product_id, i.product_name, i.ordered_quantity, i.received_quantity
                 FROM stock_orders o JOIN stock_order_items i ON i.order_id = o.id
                 WHERE o.salon_id = :salon AND o.id = :id ORDER BY i.product_id'
            );
            $statement->execute(['salon' => $salon['id'], 'id' => $id]);
            $items = $statement->fetchAll();
            if (!$items) bookili_order_error($pdo, 404, 'Commande introuvable.');
            $order = array_intersect_key($items[0], array_flip(['id', 'status', 'reference', 'supplier_name', 'created_at']));
            $order['items'] = array_map(static fn($item) => array_diff_key($item, $order), $items);
            bookili_json_response(200, ['order' => $order]);
        }
        $page = isset($_GET['page']) ? bookili_id($_GET['page']) : 1;
        if ($page > 10000) bookili_order_error($pdo, 422, 'Page invalide.');
        $statement = $pdo->prepare(
            'SELECT id, status, reference, supplier_name, created_at FROM stock_orders WHERE salon_id = :salon
             ORDER BY id DESC LIMIT 21 OFFSET ' . (20 * ($page - 1))
        );
        $statement->execute(['salon' => $salon['id']]);
        $orders = $statement->fetchAll();
        bookili_json_response(200, ['orders' => array_slice($orders, 0, 20), 'hasMore' => count($orders) > 20]);
    }

    $action = $data['action'] ?? null;
    if (!in_array($action, ['create', 'receive', 'cancel'], true)) bookili_order_error($pdo, 422, 'Action de commande invalide.');
    $key = $data['requestKey'] ?? null;
    if ($action !== 'cancel' && (!is_string($key) || !preg_match('/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/D', $key))) {
        bookili_order_error($pdo, 422, 'Demande invalide. Rechargez le formulaire.');
    }
    $items = $action === 'cancel' ? [] : bookili_order_lines($data);
    $actor = (int) $account['id'];
    $pdo->beginTransaction();
    $salonId = (int) bookili_own_salon($pdo, $actor, true)['id'];
    $now = bookili_now()->format('Y-m-d H:i:s');

    if ($action === 'create') {
        $supplierId = bookili_id($data['supplierId'] ?? null);
        $reference = $data['reference'] ?? '';
        if (!is_string($reference) || strlen(trim($reference)) > 80 || str_contains($reference, "\0")) {
            bookili_order_error($pdo, 422, 'Vérifiez la référence de la commande (80 octets maximum).');
        }
        $reference = trim($reference);
        $hash = hash('sha256', json_encode([$supplierId, $reference, $items], JSON_THROW_ON_ERROR));
        $statement = $pdo->prepare('SELECT id, request_hash FROM stock_orders WHERE salon_id = :salon AND request_key = :key');
        $statement->execute(['salon' => $salonId, 'key' => $key]);
        if ($existing = $statement->fetch()) {
            if ($existing['request_hash'] !== $hash) bookili_order_error($pdo, 409, 'Cette demande a déjà été utilisée pour une autre commande.');
            $pdo->commit();
            bookili_json_response(200, ['orderId' => (int) $existing['id'], 'duplicate' => true]);
        }
        $statement = $pdo->prepare('SELECT name FROM stock_suppliers WHERE salon_id = :salon AND id = :id AND is_active = 1');
        $statement->execute(['salon' => $salonId, 'id' => $supplierId]);
        $supplierName = $statement->fetchColumn();
        if ($supplierName === false) bookili_order_error($pdo, 422, 'Choisissez un fournisseur actif de votre salon.');
        $pdo->prepare(
            'INSERT INTO stock_orders (salon_id, supplier_id, supplier_name, reference, request_key, request_hash, created_at)
             VALUES (:salon, :supplier, :name, :reference, :key, :hash, :created_at)'
        )->execute(['salon' => $salonId, 'supplier' => $supplierId, 'name' => $supplierName, 'reference' => $reference,
            'key' => $key, 'hash' => $hash, 'created_at' => $now]);
        $id = (int) $pdo->lastInsertId();
        $insert = $pdo->prepare(
            'INSERT INTO stock_order_items (order_id, product_id, product_name, ordered_quantity) VALUES (:id, :product, :name, :quantity)'
        );
        foreach ($items as $productId => $quantity) {
            $product = bookili_own_product($pdo, $salonId, $productId, true);
            if (!(int) $product['is_active']) bookili_order_error($pdo, 409, 'Un produit de la commande est archivé.');
            $insert->execute(['id' => $id, 'product' => $productId, 'name' => $product['name'], 'quantity' => $quantity]);
        }
        $pdo->commit();
        bookili_json_response(200, ['orderId' => $id, 'duplicate' => false]);
    }

    $id = bookili_id($data['orderId'] ?? null);
    $statement = $pdo->prepare('SELECT status FROM stock_orders WHERE salon_id = :salon AND id = :id FOR UPDATE');
    $statement->execute(['salon' => $salonId, 'id' => $id]);
    $status = $statement->fetchColumn();
    if ($status === false) bookili_order_error($pdo, 404, 'Commande introuvable.');
    if ($action === 'receive') {
        $hash = hash('sha256', json_encode($items, JSON_THROW_ON_ERROR));
        $statement = $pdo->prepare('SELECT request_hash FROM stock_order_receipts WHERE order_id = :id AND request_key = :key');
        $statement->execute(['id' => $id, 'key' => $key]);
        $existing = $statement->fetchColumn();
        if ($existing !== false) {
            if ($existing !== $hash) bookili_order_error($pdo, 409, 'Cette demande a déjà été utilisée pour une autre réception.');
            $pdo->commit();
            bookili_json_response(200, ['orderId' => $id, 'duplicate' => true]);
        }
    }
    if ($action === 'cancel' && $status === 'cancelled') {
        $pdo->commit();
        bookili_json_response(200, ['orderId' => $id, 'duplicate' => true]);
    }
    if (!in_array($status, ['open', 'partial'], true)) bookili_order_error($pdo, 409, 'Cette commande est clôturée.');
    $status = 'cancelled';
    if ($action === 'receive') {
        $statement = $pdo->prepare(
            'SELECT product_id, ordered_quantity - received_quantity AS remaining FROM stock_order_items WHERE order_id = :id'
        );
        $statement->execute(['id' => $id]);
        $remaining = $statement->fetchAll(PDO::FETCH_KEY_PAIR);
        $update = $pdo->prepare(
            'UPDATE stock_order_items SET received_quantity = received_quantity + :quantity WHERE order_id = :id AND product_id = :product'
        );
        foreach ($items as $productId => $quantity) {
            if ($quantity > ($remaining[$productId] ?? 0)) bookili_order_error($pdo, 409, 'Une quantité dépasse le reste à recevoir.');
            $product = bookili_own_product($pdo, $salonId, $productId, true);
            $after = (int) $product['quantity'] + $quantity;
            if (!(int) $product['is_active'] || $after > 1000000) {
                bookili_order_error($pdo, 409, 'Réception refusée : produit archivé ou limite de 1 000 000 unités dépassée.');
            }
            bookili_write_stock_movement($pdo, $productId, $actor, bin2hex(random_bytes(16)), $quantity, $after, "Réception commande fournisseur n° $id", $now);
            $update->execute(['id' => $id, 'product' => $productId, 'quantity' => $quantity]);
            $remaining[$productId] -= $quantity;
        }
        $pdo->prepare('INSERT INTO stock_order_receipts (order_id, request_key, request_hash) VALUES (:id, :key, :hash)')
            ->execute(['id' => $id, 'key' => $key, 'hash' => $hash]);
        $status = array_sum($remaining) === 0 ? 'received' : 'partial';
    }
    $pdo->prepare('UPDATE stock_orders SET status = :status WHERE id = :id AND salon_id = :salon')
        ->execute(['status' => $status, 'id' => $id, 'salon' => $salonId]);
    $pdo->commit();
    bookili_json_response(200, ['orderId' => $id, 'duplicate' => false]);
} catch (Throwable $error) {
    if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
    bookili_database_error($error);
}
