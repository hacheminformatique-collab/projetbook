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
        $direction = $data['direction'] ?? null;
        $isCount = $direction === 'count';
        $quantity = bookili_inventory_integer($data, 'quantity', 1000000, $isCount ? 0 : 1);
        $reason = bookili_required_text($data, 'reason', 255);
        $requestKey = $data['requestKey'] ?? null;
        $version = $data['stockVersion'] ?? null;
        if (!in_array($direction, ['in', 'out', 'count'], true) || !is_string($requestKey)
            || ($isCount && (!is_string($version) || !preg_match('/^(0|[1-9][0-9]{0,19})$/D', $version)))
            || !preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/D', $requestKey)) {
            bookili_json_response(422, ['error' => 'Mouvement invalide. Rechargez le formulaire et vérifiez le sens du mouvement.']);
        }
        $delta = $direction === 'in' ? $quantity : -$quantity;
        $pdo->beginTransaction();
        $salon = bookili_own_salon($pdo, (int) $account['id'], true);
        $product = bookili_own_product($pdo, (int) $salon['id'], $productId, true);
        $statement = $pdo->prepare(
            'SELECT quantity_delta, quantity_after, is_count, reason FROM stock_movements WHERE product_id = :id AND request_key = :request_key'
        );
        $statement->execute(['id' => $productId, 'request_key' => $requestKey]);
        $previous = $statement->fetch();
        if ($previous) {
            $pdo->rollBack();
            $previousQuantity = (int) $previous[$isCount ? 'quantity_after' : 'quantity_delta'];
            if ((bool) $previous['is_count'] !== $isCount || $previousQuantity !== ($isCount ? $quantity : $delta) || $previous['reason'] !== $reason) {
                bookili_json_response(409, ['error' => 'Cette demande a déjà été utilisée pour un autre mouvement. Actualisez le stock.']);
            }
            bookili_json_response(200, ['message' => 'Ce mouvement a déjà été enregistré.', 'duplicate' => true]);
        }
        if ($isCount && $version !== bookili_stock_version($pdo, $productId, true)) {
            $pdo->rollBack();
            bookili_json_response(409, ['error' => 'Le stock a changé depuis son affichage. Vérifiez le stock actualisé et recomptez avant de confirmer.']);
        }
        $current = (int) $product['quantity'];
        $after = $isCount ? $quantity : $current + $delta;
        if (!(int) $product['is_active'] || $after < 0 || $after > 1000000) {
            $pdo->rollBack();
            bookili_json_response(409, ['error' => 'Mouvement refusé : produit archivé, stock insuffisant ou limite de 1 000 000 unités dépassée. Actualisez le stock.']);
        }
        bookili_write_stock_movement($pdo, $productId, (int) $account['id'], $requestKey, $after - $current, $after, $reason, bookili_now()->format('Y-m-d H:i:s'), $isCount);
        $pdo->commit();
        bookili_json_response(200, ['message' => $isCount ? 'Comptage physique enregistré.' : 'Mouvement de stock enregistré.', 'duplicate' => false]);
    }
    $page = isset($_GET['page']) ? bookili_id($_GET['page']) : 1;
    $filter = $_GET['filter'] ?? 'all';
    $format = $_GET['format'] ?? 'json';
    if ($page > 10000 || !in_array($filter, ['all', 'counts'], true) || !in_array($format, ['json', 'csv'], true)) {
        bookili_json_response(422, ['error' => 'Filtres d’historique invalides.']);
    }
    $pdo->beginTransaction();
    $salon = bookili_own_salon($pdo, (int) $account['id']);
    $product = bookili_own_product($pdo, (int) $salon['id'], $productId);
    $version = $format === 'json' ? bookili_stock_version($pdo, $productId) : null;
    $statement = $pdo->prepare(
        'SELECT id, quantity_delta, quantity_after, is_count, reason, created_at
         FROM stock_movements WHERE product_id = :id' . ($filter === 'counts' ? ' AND is_count = 1' : '')
         . ' ORDER BY id DESC' . ($format === 'csv' ? '' : ' LIMIT 51 OFFSET ' . (($page - 1) * 50))
    );
    $statement->execute(['id' => $productId]);
    if ($format === 'csv') {
        $pdo->commit();
        $output = fopen('php://output', 'wb');
        if ($output === false) throw new RuntimeException('Cannot open stock CSV output.');
        header('Content-Type: text/csv; charset=utf-8');
        header('Content-Disposition: attachment; filename="bookili-mouvements-stock.csv"');
        header('Cache-Control: no-store');
        header('X-Content-Type-Options: nosniff');
        fwrite($output, "\xEF\xBB\xBF");
        fputcsv($output, ['Produit', 'Date (Algérie)', 'Type', 'Stock avant', 'Écart', 'Stock après', 'Motif'], ';', '"', '');
        while ($row = $statement->fetch()) {
            fputcsv($output, [bookili_csv_text($product['name']), $row['created_at'],
                (bool) $row['is_count'] ? 'Comptage physique' : ((int) $row['quantity_delta'] < 0 ? 'Sortie' : 'Entrée'),
                (int) $row['quantity_after'] - (int) $row['quantity_delta'], $row['quantity_delta'],
                $row['quantity_after'], bookili_csv_text($row['reason'])], ';', '"', '');
        }
        fclose($output);
        exit;
    }
    $movements = $statement->fetchAll();
    $pdo->commit();
    bookili_json_response(200, [
        'product' => $product, 'stockVersion' => $version, 'movements' => array_slice($movements, 0, 50), 'hasMore' => count($movements) > 50,
    ]);
} catch (Throwable $error) {
    if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
    bookili_database_error($error);
}
