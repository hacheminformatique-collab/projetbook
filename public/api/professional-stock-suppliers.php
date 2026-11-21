<?php
declare(strict_types=1);
require_once __DIR__ . '/inventory.php';

$method = bookili_booking_method();
$data = $method === 'POST' ? bookili_read_json() : [];

try {
    $pdo = bookili_database();
    $account = bookili_require_role($pdo, ['professional']);
    if ($method === 'POST') {
        $name = bookili_required_text($data, 'name', 120);
        $phone = $data['phone'] ?? '';
        $email = $data['email'] ?? '';
        $active = $data['isActive'] ?? null;
        if (!is_string($phone) || strlen(trim($phone)) > 40 || str_contains($phone, "\0")
            || !is_string($email) || strlen(trim($email)) > 254
            || (trim($email) !== '' && !filter_var(trim($email), FILTER_VALIDATE_EMAIL)) || !is_bool($active)) {
            bookili_json_response(422, ['error' => 'Vérifiez le téléphone, l’adresse e-mail et le statut du fournisseur.']);
        }
        $id = isset($data['id']) ? bookili_id($data['id']) : null;
        $pdo->beginTransaction();
        $salon = bookili_own_salon($pdo, (int) $account['id'], true);
        $params = ['salon' => $salon['id'], 'name' => $name, 'phone' => trim($phone), 'email' => trim($email), 'active' => (int) $active];
        if ($id !== null) {
            $statement = $pdo->prepare('SELECT id FROM stock_suppliers WHERE salon_id = :salon AND id = :id');
            $statement->execute(['salon' => $salon['id'], 'id' => $id]);
            if ($statement->fetchColumn() === false) {
                $pdo->rollBack();
                bookili_json_response(404, ['error' => 'Fournisseur introuvable.']);
            }
            $sql = 'UPDATE stock_suppliers SET name = :name, phone = :phone, email = :email, is_active = :active WHERE salon_id = :salon AND id = :id';
            $params['id'] = $id;
        } else {
            $sql = 'INSERT INTO stock_suppliers (salon_id, name, phone, email, is_active) VALUES (:salon, :name, :phone, :email, :active)';
        }
        $pdo->prepare($sql)->execute($params);
        $id ??= (int) $pdo->lastInsertId();
        $pdo->commit();
        bookili_json_response(200, ['supplierId' => $id, 'message' => 'Fournisseur enregistré.']);
    }
    $salon = bookili_own_salon($pdo, (int) $account['id']);
    $statement = $pdo->prepare('SELECT id, name, phone, email, is_active FROM stock_suppliers WHERE salon_id = :salon ORDER BY is_active DESC, name, id');
    $statement->execute(['salon' => $salon['id']]);
    bookili_json_response(200, ['suppliers' => $statement->fetchAll()]);
} catch (Throwable $error) {
    if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
    bookili_database_error($error);
}
