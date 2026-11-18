<?php
declare(strict_types=1);
require_once __DIR__ . '/inventory.php';

$method = bookili_booking_method();
$data = $method === 'POST' ? bookili_read_json() : [];

try {
    $pdo = bookili_database();
    $account = bookili_require_role($pdo, ['professional']);
    if ($method === 'POST') {
        $name = bookili_required_text($data, 'name', 180);
        $reference = $data['reference'] ?? '';
        if (!is_string($reference) || strlen(trim($reference)) > 80 || str_contains($reference, "\0")
            || !is_bool($data['isActive'] ?? null)) {
            bookili_json_response(422, ['error' => 'Vérifiez la référence (80 caractères maximum) et le statut du produit.']);
        }
        $price = bookili_inventory_integer($data, 'price', 10000000);
        $threshold = bookili_inventory_integer($data, 'threshold', 1000000);
        $id = isset($data['id']) ? bookili_id($data['id']) : null;
        $pdo->beginTransaction();
        $salon = bookili_own_salon($pdo, (int) $account['id'], true);
        if ($id !== null) {
            bookili_own_product($pdo, (int) $salon['id'], $id, true);
            $sql = 'UPDATE products SET name = :name, reference = :reference, price_dzd = :price,
                    low_stock_threshold = :threshold, is_active = :active WHERE id = :id AND salon_id = :salon_id';
        } else {
            $sql = 'INSERT INTO products (salon_id, name, reference, price_dzd, low_stock_threshold, is_active)
                    VALUES (:salon_id, :name, :reference, :price, :threshold, :active)';
        }
        $params = [
            'salon_id' => $salon['id'], 'name' => $name, 'reference' => trim($reference),
            'price' => $price, 'threshold' => $threshold, 'active' => (int) $data['isActive'],
        ];
        if ($id !== null) $params['id'] = $id;
        $pdo->prepare($sql)->execute($params);
        if ($id === null) $id = (int) $pdo->lastInsertId();
        $pdo->commit();
        bookili_json_response(200, ['productId' => $id, 'message' => 'Produit enregistré.']);
    }

    $salon = bookili_own_salon($pdo, (int) $account['id']);
    $page = isset($_GET['page']) ? bookili_id($_GET['page']) : 1;
    $query = $_GET['q'] ?? '';
    $stock = $_GET['stock'] ?? 'all';
    $archived = $_GET['includeArchived'] ?? '0';
    $format = $_GET['format'] ?? 'json';
    if ($page > 10000 || !is_string($query) || strlen($query) > 180
        || !in_array($stock, ['all', 'low'], true) || !in_array($archived, ['0', '1'], true)
        || !in_array($format, ['json', 'csv'], true)) {
        bookili_json_response(422, ['error' => 'Filtres de produits invalides.']);
    }
    $where = 'salon_id = :salon_id';
    $params = ['salon_id' => $salon['id']];
    if ($archived === '0') $where .= ' AND is_active = 1';
    if ($stock === 'low') $where .= ' AND is_active = 1 AND quantity <= low_stock_threshold';
    if (trim($query) !== '') {
        $where .= ' AND (LOCATE(:name_query, name) > 0 OR LOCATE(:reference_query, reference) > 0)';
        $params['name_query'] = $params['reference_query'] = trim($query);
    }
    $statement = $pdo->prepare(
        'SELECT id, name, reference, price_dzd, quantity, low_stock_threshold, is_active
         FROM products WHERE ' . $where . ' ORDER BY id DESC'
        . ($format === 'csv' ? '' : ' LIMIT 51 OFFSET ' . (($page - 1) * 50))
    );
    $statement->execute($params);
    $products = $statement->fetchAll();
    if ($format === 'csv') {
        $output = fopen('php://output', 'wb');
        if ($output === false) throw new RuntimeException('Cannot open stock CSV output.');
        header('Content-Type: text/csv; charset=utf-8');
        header('Content-Disposition: attachment; filename="bookili-stocks.csv"');
        header('Cache-Control: no-store');
        header('X-Content-Type-Options: nosniff');
        fwrite($output, "\xEF\xBB\xBF");
        fputcsv($output, ['Produit', 'Référence', 'Prix unitaire (DA)', 'Stock', 'Seuil d’alerte', 'Statut'], ';', '"', '');
        foreach ($products as $product) {
            fputcsv($output, [
                bookili_csv_text($product['name']), bookili_csv_text($product['reference']),
                $product['price_dzd'], $product['quantity'], $product['low_stock_threshold'],
                (int) $product['is_active'] === 1 ? 'Actif' : 'Archivé',
            ], ';', '"', '');
        }
        fclose($output);
        exit;
    }
    $statement = $pdo->prepare(
        'SELECT COUNT(*) FROM products WHERE salon_id = :id AND is_active = 1 AND quantity <= low_stock_threshold'
    );
    $statement->execute(['id' => $salon['id']]);
    bookili_json_response(200, [
        'products' => array_slice($products, 0, 50), 'hasMore' => count($products) > 50,
        'lowStockCount' => (int) $statement->fetchColumn(),
    ]);
} catch (Throwable $error) {
    if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
    bookili_database_error($error);
}
