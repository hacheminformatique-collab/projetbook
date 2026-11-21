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
        $previous = $id === null ? null : bookili_own_product($pdo, (int) $salon['id'], $id, true);
        $previousSupplier = isset($previous['supplier_id']) ? (int) $previous['supplier_id'] : null;
        $supplier = array_key_exists('supplierId', $data)
            ? ($data['supplierId'] === null ? null : bookili_id($data['supplierId'])) : $previousSupplier;
        if ($supplier !== null && $supplier !== $previousSupplier) {
            $check = $pdo->prepare('SELECT id FROM stock_suppliers WHERE salon_id = :salon AND id = :id AND is_active = 1');
            $check->execute(['salon' => $salon['id'], 'id' => $supplier]);
            if ($check->fetchColumn() === false) {
                $pdo->rollBack();
                bookili_json_response(422, ['error' => 'Choisissez un fournisseur actif de votre salon.']);
            }
        }
        $category = array_key_exists('category', $data) ? $data['category'] : ($previous['category'] ?? '');
        $maximum = array_key_exists('maximum', $data) ? $data['maximum']
            : (isset($previous['max_stock_quantity']) ? (int) $previous['max_stock_quantity'] : null);
        if (!is_string($category) || strlen(trim($category)) > 80 || str_contains($category, "\0")
            || ($maximum !== null && (!is_int($maximum) || $maximum < $threshold || $maximum > 1000000))) {
            $pdo->rollBack();
            bookili_json_response(422, ['error' => 'Vérifiez la catégorie (80 octets maximum) et indiquez un maximum au moins égal au seuil d’alerte, jusqu’à 1 000 000 unités.']);
        }
        if ($id !== null) {
            $sql = 'UPDATE products SET name = :name, reference = :reference, price_dzd = :price,
                    low_stock_threshold = :threshold, category = :category, max_stock_quantity = :maximum,
                    supplier_id = :supplier, is_active = :active WHERE id = :id AND salon_id = :salon_id';
        } else {
            $sql = 'INSERT INTO products (salon_id, name, reference, price_dzd, low_stock_threshold, category, max_stock_quantity, supplier_id, is_active)
                    VALUES (:salon_id, :name, :reference, :price, :threshold, :category, :maximum, :supplier, :active)';
        }
        $params = [
            'salon_id' => $salon['id'], 'name' => $name, 'reference' => trim($reference),
            'price' => $price, 'threshold' => $threshold, 'active' => (int) $data['isActive'],
            'category' => trim($category), 'maximum' => $maximum,
            'supplier' => $supplier,
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
    $category = $_GET['category'] ?? '';
    $supplier = isset($_GET['supplier']) && $_GET['supplier'] !== '' ? bookili_id($_GET['supplier']) : null;
    $archived = $_GET['includeArchived'] ?? '0';
    $format = $_GET['format'] ?? 'json';
    if ($page > 10000 || !is_string($query) || strlen($query) > 180
        || !is_string($category) || strlen($category) > 80
        || !in_array($stock, ['all', 'low', 'over'], true) || !in_array($archived, ['0', '1'], true)
        || !in_array($format, ['json', 'csv'], true)) {
        bookili_json_response(422, ['error' => 'Filtres de produits invalides.']);
    }
    $where = 'salon_id = :salon_id';
    $params = ['salon_id' => $salon['id']];
    if ($archived === '0') $where .= ' AND is_active = 1';
    if ($stock === 'low') $where .= ' AND is_active = 1 AND quantity <= low_stock_threshold';
    if ($stock === 'over') $where .= ' AND is_active = 1 AND quantity > max_stock_quantity';
    if ($supplier !== null) {
        $where .= ' AND supplier_id = :supplier';
        $params['supplier'] = $supplier;
    }
    if (trim($category) !== '') {
        $where .= ' AND category = :category';
        $params['category'] = trim($category);
    }
    if (trim($query) !== '') {
        $where .= ' AND (LOCATE(:name_query, name) > 0 OR LOCATE(:reference_query, reference) > 0)';
        $params['name_query'] = $params['reference_query'] = trim($query);
    }
    $statement = $pdo->prepare(
        'SELECT id, name, reference, price_dzd, quantity, low_stock_threshold, category, max_stock_quantity, supplier_id, is_active,
                (SELECT s.name FROM stock_suppliers s WHERE s.id = products.supplier_id AND s.salon_id = products.salon_id) AS supplier_name'
         . ($format === 'json' ? ', CAST(COALESCE((SELECT m.id FROM stock_movements m WHERE m.product_id = products.id ORDER BY m.id DESC LIMIT 1), 0) AS CHAR) AS stock_version' : '') . '
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
        fputcsv($output, ['Produit', 'Référence', 'Prix unitaire (DA)', 'Stock', 'Seuil d’alerte', 'Fournisseur', 'Catégorie', 'Stock maximum', 'Statut'], ';', '"', '');
        foreach ($products as $product) {
            fputcsv($output, [
                bookili_csv_text($product['name']), bookili_csv_text($product['reference']),
                $product['price_dzd'], $product['quantity'], $product['low_stock_threshold'],
                bookili_csv_text($product['supplier_name'] ?? ''), bookili_csv_text($product['category']), $product['max_stock_quantity'],
                (int) $product['is_active'] === 1 ? 'Actif' : 'Archivé',
            ], ';', '"', '');
        }
        fclose($output);
        exit;
    }
    $statement = $pdo->prepare(
        'SELECT COUNT(CASE WHEN quantity <= low_stock_threshold THEN 1 END) AS low_count,
                COUNT(CASE WHEN quantity > max_stock_quantity THEN 1 END) AS over_count
         FROM products WHERE salon_id = :id AND is_active = 1'
    );
    $statement->execute(['id' => $salon['id']]);
    $counts = $statement->fetch();
    bookili_json_response(200, [
        'products' => array_slice($products, 0, 50), 'hasMore' => count($products) > 50,
        'lowStockCount' => (int) $counts['low_count'], 'overStockCount' => (int) $counts['over_count'],
    ]);
} catch (Throwable $error) {
    if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
    bookili_database_error($error);
}
