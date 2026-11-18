<?php
declare(strict_types=1);
require_once __DIR__ . '/inventory.php';

const BOOKILI_CASH_METHODS = ['cash' => 'Espèces', 'card' => 'Carte', 'transfer' => 'Virement', 'other' => 'Autre', 'gift_card' => 'Carte cadeau'];

function bookili_cash_conflict(PDO $pdo, string $message): never
{
    $pdo->rollBack();
    bookili_json_response(409, ['error' => $message]);
}

function bookili_cash_sale(PDO $pdo, int $salonId, int $saleId): array
{
    $statement = $pdo->prepare(
        'SELECT id, payment_method, total_dzd, collected_dzd, gift_card_applied_dzd, gift_card_id, recorded_at, voided_at, void_reason
         FROM cash_sales WHERE salon_id = :salon AND id = :id'
    );
    $statement->execute(['salon' => $salonId, 'id' => $saleId]);
    $sale = $statement->fetch();
    if (!$sale) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        bookili_json_response(404, ['error' => 'Vente introuvable.']);
    }
    $statement = $pdo->prepare(
        'SELECT item_kind, item_id, item_name, quantity, unit_price_dzd FROM cash_sale_lines
         WHERE sale_id = :id ORDER BY item_kind, item_id'
    );
    $statement->execute(['id' => $saleId]);
    return $sale + ['lines' => $statement->fetchAll()];
}

function bookili_cash_record(PDO $pdo, int $actorId, array $data): never
{
    $payment = $data['paymentMethod'] ?? null;
    $key = $data['requestKey'] ?? null;
    $lines = $data['lines'] ?? null;
    $giftCode = $data['giftCardCode'] ?? '';
    if (!is_string($payment) || !in_array($payment, ['cash', 'card', 'transfer', 'other'], true)
        || !is_string($key) || !preg_match('/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/D', $key)
        || !is_string($giftCode) || strlen($giftCode) > 64
        || !is_array($lines) || !array_is_list($lines) || count($lines) < 1 || count($lines) > 20) {
        bookili_json_response(422, ['error' => 'Vérifiez le mode de règlement et le panier (1 à 20 lignes).']);
    }
    $giftCode = strtoupper(str_replace(' ', '', trim($giftCode)));
    $cart = [];
    foreach ($lines as $line) {
        if (!is_array($line) || !in_array($line['kind'] ?? null, ['product', 'service'], true)) {
            bookili_json_response(422, ['error' => 'Article invalide.']);
        }
        $kind = $line['kind'];
        $id = bookili_id($line['id'] ?? null);
        $quantity = bookili_inventory_integer($line, 'quantity', 100, 1);
        $price = bookili_inventory_integer($line, 'expectedPrice', 10000000);
        $index = "$kind:$id";
        if (isset($cart[$index])) bookili_json_response(422, ['error' => 'Regroupez chaque article sur une seule ligne.']);
        $cart[$index] = ['kind' => $kind, 'id' => $id, 'quantity' => $quantity, 'price' => $price];
    }
    ksort($cart);
    $fingerprint = hash('sha256', json_encode([$payment, $cart, $giftCode], JSON_THROW_ON_ERROR));
    $pdo->beginTransaction();
    $salonId = (int) bookili_own_salon($pdo, $actorId, true)['id'];
    $statement = $pdo->prepare(    'SELECT id, request_hash, gift_card_id FROM cash_sales WHERE salon_id = :salon AND request_key = :key');
    $statement->execute(['salon' => $salonId, 'key' => $key]);
    if ($previous = $statement->fetch()) {
        if ($previous['request_hash'] !== $fingerprint) bookili_cash_conflict($pdo, 'Cette demande correspond déjà à une autre vente.');
        $pdo->commit();
        bookili_json_response(200, ['saleId' => (int) $previous['id'], 'duplicate' => true]);
    }
    $total = 0;
    $giftCard = null;
    if ($giftCode !== '') {
        if (!preg_match('/^[A-F0-9]{32}$/D', $giftCode)) {
            bookili_cash_conflict($pdo, 'Code de carte cadeau invalide.');
        }
        $statement = $pdo->prepare(
            'SELECT id, balance_dzd, expires_on, status FROM gift_cards
             WHERE salon_id = :salon AND code_hash = :code FOR UPDATE'
        );
        $statement->execute(['salon' => $salonId, 'code' => hash('sha256', $giftCode)]);
        $giftCard = $statement->fetch();
        if (!$giftCard || $giftCard['status'] !== 'active' || $giftCard['expires_on'] < bookili_now()->format('Y-m-d')
            || (int) $giftCard['balance_dzd'] < 1) {
            bookili_cash_conflict($pdo, 'Carte cadeau introuvable, expirée ou sans solde.');
        }
    }
    foreach ($cart as &$line) {
        $product = $line['kind'] === 'product';
        $item = $product
            ? bookili_own_product($pdo, $salonId, $line['id'], true)
            : bookili_service($pdo, $salonId, $line['id']);
        if ((int) $item['price_dzd'] !== $line['price']) {
            bookili_cash_conflict($pdo, 'Un prix a changé. Actualisez le catalogue et ajoutez de nouveau l’article.');
        }
        if ($product && (!(int) $item['is_active'] || (int) $item['quantity'] < $line['quantity'])) {
            bookili_cash_conflict($pdo, 'Produit archivé ou stock insuffisant : vérifiez votre panier.');
        }
        $line['name'] = $item['name'];
        if ($product) $line['after'] = (int) $item['quantity'] - $line['quantity'];
        $total += $line['quantity'] * $line['price'];
    }
    unset($line);
    $applied = min($total, (int) ($giftCard['balance_dzd'] ?? 0));
    $collected = $total - $applied;
    $storedPayment = $collected === 0 ? 'gift_card' : $payment;
    $now = bookili_now()->format('Y-m-d H:i:s');
    $pdo->prepare(
        'INSERT INTO cash_sales
         (salon_id, actor_id, request_key, request_hash, payment_method, total_dzd, collected_dzd, gift_card_applied_dzd, gift_card_id, recorded_at)
         VALUES (:salon, :actor, :key, :hash, :payment, :total, :collected, :applied, :gift_card, :now)'
    )->execute([
        'salon' => $salonId, 'actor' => $actorId, 'key' => $key, 'hash' => $fingerprint,
        'payment' => $storedPayment, 'total' => $total, 'collected' => $collected,
        'applied' => $applied, 'gift_card' => $giftCard['id'] ?? null, 'now' => $now,
    ]);
    $saleId = (int) $pdo->lastInsertId();
    $insert = $pdo->prepare(
        'INSERT INTO cash_sale_lines (sale_id, item_kind, item_id, item_name, quantity, unit_price_dzd)
         VALUES (:sale, :kind, :id, :name, :quantity, :price)'
    );
    foreach ($cart as $line) {
        $insert->execute([
            'sale' => $saleId, 'kind' => $line['kind'], 'id' => $line['id'],
            'name' => $line['name'], 'quantity' => $line['quantity'], 'price' => $line['price'],
        ]);
        if ($line['kind'] === 'product') {
            bookili_write_stock_movement($pdo, $line['id'], $actorId, bin2hex(random_bytes(16)), -$line['quantity'], $line['after'], "Vente n° $saleId", $now);
        }
    }
    if ($giftCard && $applied > 0) {
        $balance = (int) $giftCard['balance_dzd'] - $applied;
        $pdo->prepare('UPDATE gift_cards SET balance_dzd = :balance WHERE id = :id')
            ->execute(['balance' => $balance, 'id' => $giftCard['id']]);
        $pdo->prepare(
            "INSERT INTO gift_card_events (gift_card_id, sale_id, event_kind, amount_dzd, balance_after_dzd, created_at)
             VALUES (:card, :sale, 'redeemed', :amount, :balance, :now)"
        )->execute(['card' => $giftCard['id'], 'sale' => $saleId, 'amount' => $applied, 'balance' => $balance, 'now' => $now]);
    }
    $pdo->commit();
    bookili_json_response(201, [
        'saleId' => $saleId, 'duplicate' => false, 'totalDzd' => $total,
        'collectedDzd' => $collected, 'giftCardAppliedDzd' => $applied,
        'giftCardRemainingDzd' => $giftCard ? (int) $giftCard['balance_dzd'] - $applied : 0,
    ]);
}

function bookili_cash_void(PDO $pdo, int $actorId, array $data): never
{
    $saleId = bookili_id($data['saleId'] ?? null);
    $reason = bookili_required_text($data, 'reason', 255);
    $pdo->beginTransaction();
    $salonId = (int) bookili_own_salon($pdo, $actorId, true)['id'];
    $sale = bookili_cash_sale($pdo, $salonId, $saleId);
    if ($sale['voided_at'] !== null) {
        if ($sale['void_reason'] !== $reason) bookili_cash_conflict($pdo, 'Cette vente est déjà annulée.');
        $pdo->commit();
        bookili_json_response(200, ['saleId' => $saleId, 'duplicate' => true]);
    }
    $now = bookili_now()->format('Y-m-d H:i:s');
    if ($sale['gift_card_id'] !== null && (int) $sale['gift_card_applied_dzd'] > 0) {
        $statement = $pdo->prepare('SELECT balance_dzd, status FROM gift_cards WHERE id = :id FOR UPDATE');
        $statement->execute(['id' => $sale['gift_card_id']]);
        $card = $statement->fetch();
        if (!$card) bookili_cash_conflict($pdo, 'Carte cadeau introuvable.');
        $restored = (int) $card['balance_dzd'] + (int) $sale['gift_card_applied_dzd'];
        if ($restored > 10000000) bookili_cash_conflict($pdo, 'Le solde restauré dépasserait la limite de la carte cadeau.');
        $pdo->prepare('UPDATE gift_cards SET balance_dzd = :balance WHERE id = :id')
            ->execute(['balance' => $restored, 'id' => $sale['gift_card_id']]);
        $pdo->prepare(
            "INSERT INTO gift_card_events (gift_card_id, sale_id, event_kind, amount_dzd, balance_after_dzd, created_at)
             VALUES (:card, :sale, 'restored', :amount, :balance, :now)"
        )->execute(['card' => $sale['gift_card_id'], 'sale' => $saleId, 'amount' => $sale['gift_card_applied_dzd'], 'balance' => $restored, 'now' => $now]);
    }
    $statement = $pdo->prepare('SELECT id, balance_dzd FROM gift_cards WHERE issued_sale_id = :sale FOR UPDATE');
    $statement->execute(['sale' => $saleId]);
    $issuedCard = $statement->fetch();
    if ($issuedCard) {
        $statement = $pdo->prepare('SELECT COUNT(*) FROM gift_card_events WHERE gift_card_id = :id AND event_kind = \'redeemed\'');
        $statement->execute(['id' => $issuedCard['id']]);
        if ((int) $statement->fetchColumn() > 0 || (int) $issuedCard['balance_dzd'] !== (int) $sale['total_dzd']) {
            bookili_cash_conflict($pdo, 'Cette carte cadeau a déjà été utilisée. Son émission ne peut pas être annulée.');
        }
        $pdo->prepare('UPDATE gift_cards SET status = \'voided\', voided_at = :now, voided_by = :actor, void_reason = :reason WHERE id = :id')
            ->execute(['now' => $now, 'actor' => $actorId, 'reason' => $reason, 'id' => $issuedCard['id']]);
    }
    foreach ($sale['lines'] as $line) {
        if ($line['item_kind'] !== 'product') continue;
        $id = (int) $line['item_id'];
        $quantity = (int) $line['quantity'];
        $product = bookili_own_product($pdo, $salonId, $id, true);
        $after = (int) $product['quantity'] + $quantity;
        if ($after > 1000000) bookili_cash_conflict($pdo, 'L’annulation dépasserait la limite de stock pour un produit.');
        bookili_write_stock_movement($pdo, $id, $actorId, bin2hex(random_bytes(16)), $quantity, $after, "Annulation vente n° $saleId", $now);
    }
    $pdo->prepare('UPDATE cash_sales SET voided_at = :now, voided_by = :actor, void_reason = :reason WHERE id = :id')
        ->execute(['now' => $now, 'actor' => $actorId, 'reason' => $reason, 'id' => $saleId]);
    $pdo->commit();
    bookili_json_response(200, ['saleId' => $saleId, 'duplicate' => false]);
}

function bookili_cash_catalog(PDO $pdo, int $salonId): never
{
    $query = $_GET['q'] ?? '';
    $kind = $_GET['kind'] ?? 'product';
    if (!is_string($query) || strlen($query) > 180 || !in_array($kind, ['product', 'service'], true)) {
        bookili_json_response(422, ['error' => 'Recherche invalide.']);
    }
    $product = $kind === 'product';
    $statement = $pdo->prepare(
        'SELECT id, name, price_dzd' . ($product ? ', quantity, reference FROM products' : ' FROM services')
        . ' WHERE salon_id = :salon AND is_active = 1 AND (LOCATE(:q, name) > 0'
        . ($product ? ' OR LOCATE(:reference, reference) > 0' : '')
        . ') ORDER BY name, id LIMIT 51'
    );
    $params = ['salon' => $salonId, 'q' => trim($query)];
    if ($product) $params['reference'] = $params['q'];
    $statement->execute($params);
    $items = $statement->fetchAll();
    bookili_json_response(200, ['items' => array_slice($items, 0, 50), 'hasMore' => count($items) > 50]);
}

function bookili_cash_journal(PDO $pdo, int $salonId, bool $csv): never
{
    $today = bookili_now()->format('Y-m-d');
    $from = bookili_calendar_date($_GET['from'] ?? $today);
    $to = bookili_calendar_date($_GET['to'] ?? $today);
    $page = isset($_GET['page']) ? bookili_id($_GET['page']) : 1;
    if ($from < bookili_calendar_date('2000-01-01') || $to < $from || $to->format('Y-m-d') > $today
        || $from->diff($to)->days > 365 || $page > 10000) {
        bookili_json_response(422, ['error' => 'Sélectionnez une période passée ou en cours de 366 jours maximum.']);
    }
    $sql = "(SELECT id, payment_method, CAST(total_dzd AS SIGNED) AS amount_dzd, recorded_at AS event_at,
                    'sale' AS event_kind, voided_at, NULL AS reason, collected_dzd, gift_card_applied_dzd
             FROM cash_sales WHERE salon_id = :sale_salon AND recorded_at >= :sale_from AND recorded_at < :sale_to)
            UNION ALL
            (SELECT id, payment_method, -CAST(total_dzd AS SIGNED) AS amount_dzd, voided_at AS event_at,
                    'void' AS event_kind, voided_at, void_reason AS reason, -CAST(collected_dzd AS SIGNED) AS collected_dzd,
                    -CAST(gift_card_applied_dzd AS SIGNED) AS gift_card_applied_dzd
             FROM cash_sales WHERE salon_id = :void_salon AND voided_at >= :void_from AND voided_at < :void_to)";
    $params = ['sale_salon' => $salonId, 'void_salon' => $salonId];
    $params['sale_from'] = $params['void_from'] = $from->format('Y-m-d H:i:s');
    $params['sale_to'] = $params['void_to'] = $to->modify('+1 day')->format('Y-m-d H:i:s');
    $statement = $pdo->prepare($sql . ' ORDER BY event_at DESC, id DESC, event_kind DESC'
        . ($csv ? '' : ' LIMIT 51 OFFSET ' . (($page - 1) * 50)));
    $statement->execute($params);
    if ($csv) {
        $output = fopen('php://output', 'wb');
        if ($output === false) throw new RuntimeException('Cannot open cash CSV output.');
        header('Content-Type: text/csv; charset=utf-8');
        header('Content-Disposition: attachment; filename="bookili-journal-caisse.csv"');
        header('Cache-Control: no-store');
        header('X-Content-Type-Options: nosniff');
        fwrite($output, "\xEF\xBB\xBF");
        fputcsv($output, ['Date (Algérie)', 'Vente', 'Opération', 'Mode de règlement', 'Montant brut (DA)', 'Encaissé (DA)', 'Carte cadeau (DA)', 'Motif'], ';', '"', '');
        while ($row = $statement->fetch()) {
            fputcsv($output, [
                $row['event_at'], $row['id'], $row['event_kind'] === 'void' ? 'Annulation' : 'Vente',
                BOOKILI_CASH_METHODS[$row['payment_method']], $row['amount_dzd'], $row['collected_dzd'],
                $row['gift_card_applied_dzd'], bookili_csv_text($row['reason'] ?? ''),
            ], ';', '"', '');
        }
        fclose($output);
        exit;
    }
    $rows = $statement->fetchAll();
    $summary = $pdo->prepare("SELECT COALESCE(SUM(amount_dzd), 0) FROM ($sql) AS journal");
    $summary->execute($params);
    bookili_json_response(200, ['entries' => array_slice($rows, 0, 50), 'hasMore' => count($rows) > 50, 'netDzd' => (int) $summary->fetchColumn()]);
}

if (basename((string) ($_SERVER['SCRIPT_FILENAME'] ?? '')) === 'professional-cash.php') {
    $method = bookili_booking_method();
    $data = $method === 'POST' ? bookili_read_json() : [];
    try {
        $pdo = bookili_database();
        $account = bookili_require_role($pdo, ['professional']);
        $actorId = (int) $account['id'];
        if ($method === 'POST') {
            if (($data['action'] ?? '') === 'record') bookili_cash_record($pdo, $actorId, $data);
            if (($data['action'] ?? '') === 'void') bookili_cash_void($pdo, $actorId, $data);
            bookili_json_response(422, ['error' => 'Action de caisse invalide.']);
        }
        $salonId = (int) bookili_own_salon($pdo, $actorId)['id'];
        $view = $_GET['view'] ?? 'journal';
        if ($view === 'catalog') bookili_cash_catalog($pdo, $salonId);
        if ($view === 'sale') bookili_json_response(200, bookili_cash_sale($pdo, $salonId, bookili_id($_GET['saleId'] ?? null)));
        if ($view === 'cards') {
            $page = isset($_GET['page']) ? bookili_id($_GET['page']) : 1;
            if ($page > 10000) bookili_json_response(422, ['error' => 'Page invalide.']);
            $statement = $pdo->prepare(
                'SELECT id, initial_value_dzd, balance_dzd, expires_on, issued_at, status
                 FROM gift_cards WHERE salon_id = :salon ORDER BY id DESC LIMIT 51 OFFSET ' . (($page - 1) * 50)
            );
            $statement->execute(['salon' => $salonId]);
            $cards = $statement->fetchAll();
            foreach ($cards as &$card) {
                if ($card['status'] === 'active' && $card['expires_on'] < bookili_now()->format('Y-m-d')) $card['status'] = 'expired';
            }
            unset($card);
            bookili_json_response(200, ['cards' => array_slice($cards, 0, 50), 'hasMore' => count($cards) > 50]);
        }
        if ($view === 'journal' || $view === 'csv') bookili_cash_journal($pdo, $salonId, $view === 'csv');
        bookili_json_response(422, ['error' => 'Vue de caisse invalide.']);
    } catch (Throwable $error) {
        if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
        bookili_database_error($error);
    }
}
