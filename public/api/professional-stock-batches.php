<?php
declare(strict_types=1);
require_once __DIR__ . '/inventory.php';

bookili_require_method('POST');
bookili_require_csrf();
$data = bookili_read_json();

try {
    $pdo = bookili_database();
    $account = bookili_require_role($pdo, ['professional']);
    $kind = $data['kind'] ?? null;
    $items = $data['items'] ?? null;
    $key = $data['requestKey'] ?? null;
    if (!in_array($kind, ['in', 'out', 'count'], true)
        || !is_string($key) || !preg_match('/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/D', $key)
        || !is_array($items) || !array_is_list($items) || count($items) < 2 || count($items) > 50) {
        bookili_json_response(422, ['error' => 'Sélectionnez un type d’opération et entre 2 et 50 produits.']);
    }
    $reason = bookili_required_text($data, 'reason', 255);
    $count = $kind === 'count';
    $lines = [];
    foreach ($items as $item) {
        if (!is_array($item)) bookili_json_response(422, ['error' => 'Produit invalide dans le lot.']);
        $id = bookili_id($item['productId'] ?? null);
        $version = $item['stockVersion'] ?? null;
        if (isset($lines[$id]) || !is_string($version) || !preg_match('/^(0|[1-9][0-9]{0,19})$/D', $version)) {
            bookili_json_response(422, ['error' => 'Chaque produit doit apparaître une seule fois avec une version de stock valide.']);
        }
        $lines[$id] = [bookili_inventory_integer($item, 'quantity', 1000000, $count ? 0 : 1), $version];
    }
    ksort($lines, SORT_NUMERIC);
    $hash = hash('sha256', json_encode([$kind, $reason, $lines], JSON_THROW_ON_ERROR));
    $actor = (int) $account['id'];
    $pdo->beginTransaction();
    $salon = (int) bookili_own_salon($pdo, $actor, true)['id'];
    $statement = $pdo->prepare('SELECT id, request_hash FROM stock_batches WHERE salon_id = :salon AND request_key = :key');
    $statement->execute(['salon' => $salon, 'key' => $key]);
    if ($previous = $statement->fetch()) {
        $pdo->commit();
        if ($previous['request_hash'] !== $hash) {
            bookili_json_response(409, ['error' => 'Cette demande a déjà été utilisée pour une autre opération.']);
        }
        bookili_json_response(200, ['batchId' => (int) $previous['id'], 'duplicate' => true]);
    }

    $changes = [];
    foreach ($lines as $id => [$quantity, $version]) {
        $product = bookili_own_product($pdo, $salon, $id, true);
        $current = (int) $product['quantity'];
        $after = $count ? $quantity : $current + ($kind === 'out' ? -$quantity : $quantity);
        if (!(int) $product['is_active'] || $after < 0 || $after > 1000000
            || $version !== bookili_stock_version($pdo, $id, true)) {
            $pdo->rollBack();
            bookili_json_response(409, ['error' => "Aucune ligne enregistrée. Vérifiez « {$product['name']} » : stock modifié, quantité hors limites ou produit archivé."]);
        }
        $changes[$id] = [$after - $current, $after];
    }
    $pdo->prepare('INSERT INTO stock_batches (salon_id, request_key, request_hash) VALUES (:salon, :key, :hash)')
        ->execute(['salon' => $salon, 'key' => $key, 'hash' => $hash]);
    $batchId = (int) $pdo->lastInsertId();
    $now = bookili_now()->format('Y-m-d H:i:s');
    foreach ($changes as $id => [$delta, $after]) {
        bookili_write_stock_movement($pdo, $id, $actor, bin2hex(random_bytes(16)), $delta, $after, $reason, $now, $count);
    }
    $pdo->commit();
    bookili_json_response(200, ['batchId' => $batchId, 'duplicate' => false]);
} catch (Throwable $error) {
    if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
    bookili_database_error($error);
}
