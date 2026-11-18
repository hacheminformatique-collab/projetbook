<?php
declare(strict_types=1);
require_once __DIR__ . '/booking.php';

function bookili_inventory_integer(array $data, string $key, int $maximum, int $minimum = 0): int
{
    $value = $data[$key] ?? null;
    if (!is_int($value) || $value < $minimum || $value > $maximum) {
        bookili_json_response(422, ['error' => 'Vérifiez les quantités, le seuil et le prix : utilisez des nombres entiers dans les limites indiquées.']);
    }
    return $value;
}

function bookili_own_product(PDO $pdo, int $salonId, int $productId, bool $lock = false): array
{
    $statement = $pdo->prepare(
        'SELECT id, name, reference, price_dzd, quantity, low_stock_threshold, is_active
         FROM products WHERE id = :id AND salon_id = :salon_id' . ($lock ? ' FOR UPDATE' : '')
    );
    $statement->execute(['id' => $productId, 'salon_id' => $salonId]);
    $product = $statement->fetch();
    if (!$product) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        bookili_json_response(404, ['error' => 'Ce produit n’existe pas dans votre salon.']);
    }
    return $product;
}

function bookili_csv_text(string $value): string
{
    return preg_match('/^[\s\x00-\x20]*[=+@-]|^[\t\r\n]/u', $value) ? "'" . $value : $value;
}
