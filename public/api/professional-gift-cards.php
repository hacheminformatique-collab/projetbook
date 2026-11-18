<?php
declare(strict_types=1);
require_once __DIR__ . '/professional-cash.php';

$method = bookili_booking_method();
$data = $method === 'POST' ? bookili_read_json() : [];

try {
    $pdo = bookili_database();
    $account = bookili_require_role($pdo, ['professional']);
    $actorId = (int) $account['id'];
    if ($method === 'POST') {
        if (($data['action'] ?? '') !== 'issue') bookili_json_response(422, ['error' => 'Action invalide.']);
        $value = bookili_inventory_integer($data, 'valueDzd', 10000000, 500);
        $payment = $data['paymentMethod'] ?? null;
        $key = $data['requestKey'] ?? null;
        if (!is_string($payment) || !in_array($payment, ['cash', 'card', 'transfer', 'other'], true)
            || !is_string($key) || !preg_match('/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/D', $key)) {
            bookili_json_response(422, ['error' => 'Vérifiez le mode de règlement et rechargez le formulaire.']);
        }
        $fingerprint = hash('sha256', json_encode([$value, $payment], JSON_THROW_ON_ERROR));
        $pdo->beginTransaction();
        $salonId = (int) bookili_own_salon($pdo, $actorId, true)['id'];
        $statement = $pdo->prepare('SELECT id, request_hash FROM cash_sales WHERE salon_id = :salon AND request_key = :key');
        $statement->execute(['salon' => $salonId, 'key' => $key]);
        if ($previous = $statement->fetch()) {
            if ($previous['request_hash'] !== $fingerprint) bookili_cash_conflict($pdo, 'Cette demande a déjà été utilisée pour un autre règlement.');
            $pdo->commit();
            bookili_json_response(200, ['saleId' => (int) $previous['id'], 'duplicate' => true, 'code' => null]);
        }
        $now = bookili_now();
        $nowText = $now->format('Y-m-d H:i:s');
        $pdo->prepare(
            "INSERT INTO cash_sales
             (salon_id, actor_id, request_key, request_hash, payment_method, total_dzd, collected_dzd, recorded_at)
             VALUES (:salon, :actor, :key, :hash, :payment, :total, :collected, :now)"
        )->execute([
            'salon' => $salonId, 'actor' => $actorId, 'key' => $key, 'hash' => $fingerprint,
            'payment' => $payment, 'total' => $value, 'collected' => $value, 'now' => $nowText,
        ]);
        $saleId = (int) $pdo->lastInsertId();
        $code = strtoupper(bin2hex(random_bytes(16)));
        $expires = $now->modify('+12 months')->format('Y-m-d');
        $pdo->prepare(
            'INSERT INTO gift_cards (salon_id, issued_sale_id, code_hash, initial_value_dzd, balance_dzd, expires_on, issued_at)
             VALUES (:salon, :sale, :code, :initial_value, :balance, :expires, :now)'
        )->execute([
            'salon' => $salonId, 'sale' => $saleId, 'code' => hash('sha256', $code),
            'initial_value' => $value, 'balance' => $value, 'expires' => $expires, 'now' => $nowText,
        ]);
        $cardId = (int) $pdo->lastInsertId();
        $pdo->prepare(
            "INSERT INTO cash_sale_lines (sale_id, item_kind, item_id, item_name, quantity, unit_price_dzd)
             VALUES (:sale, 'gift_card', :card, 'Carte cadeau', 1, :value)"
        )->execute(['sale' => $saleId, 'card' => $cardId, 'value' => $value]);
        $pdo->prepare(
            "INSERT INTO gift_card_events (gift_card_id, sale_id, event_kind, amount_dzd, balance_after_dzd, created_at)
             VALUES (:card, :sale, 'issued', :amount, :balance, :now)"
        )->execute(['card' => $cardId, 'sale' => $saleId, 'amount' => $value, 'balance' => $value, 'now' => $nowText]);
        $pdo->commit();
        bookili_json_response(201, [
            'saleId' => $saleId, 'cardId' => $cardId, 'code' => $code, 'valueDzd' => $value,
            'expiresOn' => $expires, 'duplicate' => false,
        ]);
    }

    bookili_json_response(422, ['error' => 'Méthode invalide.']);
} catch (Throwable $error) {
    if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
    bookili_database_error($error);
}
