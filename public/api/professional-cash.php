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

function bookili_cash_ticket_input(mixed $lines): array
{
    if (!is_array($lines) || !array_is_list($lines) || count($lines) < 1 || count($lines) > 20) {
        bookili_json_response(422, ['error' => 'Vérifiez le panier (1 à 20 lignes).']);
    }
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
    return $cart;
}

function bookili_cash_ticket_current_lines(PDO $pdo, int $salonId, array $cart): array
{
    foreach ($cart as &$line) {
        $item = $line['kind'] === 'product'
            ? bookili_own_product($pdo, $salonId, $line['id'], true)
            : bookili_service($pdo, $salonId, $line['id']);
        if ((int) $item['price_dzd'] !== $line['price']) {
            bookili_cash_conflict($pdo, 'Un prix a changé. Actualisez le catalogue et ajoutez de nouveau l’article.');
        }
        if ($line['kind'] === 'product' && !(int) $item['is_active']) {
            bookili_cash_conflict($pdo, 'Un produit du ticket a été archivé. Modifiez le ticket avant de l’encaisser.');
        }
        $line['name'] = $item['name'];
    }
    unset($line);
    return $cart;
}

function bookili_cash_ticket_store_lines(PDO $pdo, int $ticketId, array $cart): void
{
    $pdo->prepare('DELETE FROM cash_ticket_lines WHERE ticket_id = :ticket')->execute(['ticket' => $ticketId]);
    $insert = $pdo->prepare(
        'INSERT INTO cash_ticket_lines (ticket_id, item_kind, item_id, item_name, quantity, unit_price_dzd)
         VALUES (:ticket, :kind, :id, :name, :quantity, :price)'
    );
    foreach ($cart as $line) {
        $insert->execute([
            'ticket' => $ticketId, 'kind' => $line['kind'], 'id' => $line['id'],
            'name' => $line['name'], 'quantity' => $line['quantity'], 'price' => $line['price'],
        ]);
    }
}

function bookili_cash_ticket_total(array $cart): int
{
    $total = 0;
    foreach ($cart as $line) $total += $line['quantity'] * $line['price'];
    return $total;
}

function bookili_cash_ticket_save(PDO $pdo, int $actorId, array $data): never
{
    $cart = bookili_cash_ticket_input($data['lines'] ?? null);
    $key = $data['requestKey'] ?? null;
    if (!is_string($key) || !preg_match('/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/D', $key)) {
        bookili_json_response(422, ['error' => 'Clé de demande invalide.']);
    }
    $fingerprint = hash('sha256', json_encode($cart, JSON_THROW_ON_ERROR));
    $pdo->beginTransaction();
    $salonId = (int) bookili_own_salon($pdo, $actorId, true)['id'];
    $statement = $pdo->prepare('SELECT id, request_hash, revision FROM cash_tickets WHERE salon_id = :salon AND request_key = :key');
    $statement->execute(['salon' => $salonId, 'key' => $key]);
    if ($previous = $statement->fetch()) {
        if (!hash_equals($previous['request_hash'], $fingerprint)) {
            bookili_cash_conflict($pdo, 'Cette demande correspond déjà à un autre ticket.');
        }
        $pdo->commit();
        bookili_json_response(200, ['ticketId' => (int) $previous['id'], 'revision' => (int) $previous['revision'], 'duplicate' => true]);
    }
    $cart = bookili_cash_ticket_current_lines($pdo, $salonId, $cart);
    $now = bookili_now()->format('Y-m-d H:i:s');
    $pdo->prepare(
        "INSERT INTO cash_tickets (salon_id, actor_id, request_key, request_hash, status, revision, total_dzd, created_at, updated_at)
         VALUES (:salon, :actor, :key, :hash, 'pending', 1, :total, :created, :updated)"
    )->execute([
        'salon' => $salonId, 'actor' => $actorId, 'key' => $key, 'hash' => $fingerprint,
        'total' => bookili_cash_ticket_total($cart), 'created' => $now, 'updated' => $now,
    ]);
    $ticketId = (int) $pdo->lastInsertId();
    bookili_cash_ticket_store_lines($pdo, $ticketId, $cart);
    $pdo->commit();
    bookili_json_response(201, ['ticketId' => $ticketId, 'revision' => 1, 'duplicate' => false]);
}

function bookili_cash_ticket_update(PDO $pdo, int $actorId, array $data): never
{
    $ticketId = bookili_id($data['ticketId'] ?? null);
    $expectedRevision = $data['expectedRevision'] ?? null;
    $key = $data['requestKey'] ?? null;
    if (!is_int($expectedRevision) || $expectedRevision < 1
        || !is_string($key) || !preg_match('/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/D', $key)) {
        bookili_json_response(422, ['error' => 'Version de ticket invalide.']);
    }
    $cart = bookili_cash_ticket_input($data['lines'] ?? null);
    $fingerprint = hash('sha256', json_encode([$expectedRevision, $cart], JSON_THROW_ON_ERROR));
    $pdo->beginTransaction();
    $salonId = (int) bookili_own_salon($pdo, $actorId, true)['id'];
    $statement = $pdo->prepare(
        'SELECT status, revision, update_request_key, update_request_hash
         FROM cash_tickets WHERE id = :id AND salon_id = :salon FOR UPDATE'
    );
    $statement->execute(['id' => $ticketId, 'salon' => $salonId]);
    $ticket = $statement->fetch();
    if (!$ticket) {
        $pdo->rollBack();
        bookili_json_response(404, ['error' => 'Ticket introuvable.']);
    }
    if ($ticket['status'] !== 'pending') bookili_cash_conflict($pdo, 'Ce ticket n’est plus en attente.');
    if ($ticket['update_request_key'] === $key) {
        if (!hash_equals($ticket['update_request_hash'], $fingerprint)) {
            bookili_cash_conflict($pdo, 'Cette demande correspond déjà à une autre modification.');
        }
        $pdo->commit();
        bookili_json_response(200, ['ticketId' => $ticketId, 'revision' => (int) $ticket['revision'], 'duplicate' => true]);
    }
    if ((int) $ticket['revision'] !== $expectedRevision) {
        bookili_cash_conflict($pdo, 'Ce ticket a été modifié ailleurs. Rechargez-le avant de continuer.');
    }
    $cart = bookili_cash_ticket_current_lines($pdo, $salonId, $cart);
    $revision = $expectedRevision + 1;
    $pdo->prepare(
        'UPDATE cash_tickets SET revision = :revision, total_dzd = :total, update_request_key = :key,
         update_request_hash = :hash, updated_at = :now WHERE id = :id'
    )
        ->execute([
            'revision' => $revision, 'total' => bookili_cash_ticket_total($cart), 'key' => $key, 'hash' => $fingerprint,
            'now' => bookili_now()->format('Y-m-d H:i:s'), 'id' => $ticketId,
        ]);
    bookili_cash_ticket_store_lines($pdo, $ticketId, $cart);
    $pdo->commit();
    bookili_json_response(200, ['ticketId' => $ticketId, 'revision' => $revision, 'duplicate' => false]);
}

function bookili_cash_ticket_cancel(PDO $pdo, int $actorId, array $data): never
{
    $ticketId = bookili_id($data['ticketId'] ?? null);
    $expectedRevision = $data['expectedRevision'] ?? null;
    if (!is_int($expectedRevision) || $expectedRevision < 1) {
        bookili_json_response(422, ['error' => 'Version de ticket invalide.']);
    }
    $pdo->beginTransaction();
    $salonId = (int) bookili_own_salon($pdo, $actorId, true)['id'];
    $statement = $pdo->prepare('SELECT status, revision FROM cash_tickets WHERE id = :id AND salon_id = :salon FOR UPDATE');
    $statement->execute(['id' => $ticketId, 'salon' => $salonId]);
    $ticket = $statement->fetch();
    if (!$ticket) {
        $pdo->rollBack();
        bookili_json_response(404, ['error' => 'Ticket introuvable.']);
    }
    if ($ticket['status'] === 'cancelled') {
        $pdo->commit();
        bookili_json_response(200, ['ticketId' => $ticketId, 'duplicate' => true]);
    }
    if ($ticket['status'] !== 'pending') bookili_cash_conflict($pdo, 'Un ticket encaissé ne peut pas être abandonné.');
    if ((int) $ticket['revision'] !== $expectedRevision) {
        bookili_cash_conflict($pdo, 'Ce ticket a été modifié ailleurs. Rechargez-le avant de continuer.');
    }
    $pdo->prepare("UPDATE cash_tickets SET status = 'cancelled', revision = revision + 1, updated_at = :now WHERE id = :id")
        ->execute(['now' => bookili_now()->format('Y-m-d H:i:s'), 'id' => $ticketId]);
    $pdo->commit();
    bookili_json_response(200, ['ticketId' => $ticketId, 'duplicate' => false]);
}

function bookili_cash_ticket(PDO $pdo, int $salonId, int $ticketId): array
{
    $statement = $pdo->prepare(
        "SELECT id, status, revision, total_dzd, created_at, updated_at
         FROM cash_tickets WHERE id = :id AND salon_id = :salon AND status = 'pending'"
    );
    $statement->execute(['id' => $ticketId, 'salon' => $salonId]);
    $ticket = $statement->fetch();
    if (!$ticket) bookili_json_response(404, ['error' => 'Ticket en attente introuvable.']);
    $statement = $pdo->prepare(
        'SELECT item_kind, item_id, item_name, quantity, unit_price_dzd
         FROM cash_ticket_lines WHERE ticket_id = :ticket ORDER BY item_kind, item_id'
    );
    $statement->execute(['ticket' => $ticketId]);
    return $ticket + ['lines' => $statement->fetchAll()];
}

function bookili_cash_tickets(PDO $pdo, int $salonId): never
{
    $statement = $pdo->prepare(
        "SELECT t.id, t.revision, t.total_dzd, t.created_at, t.updated_at, COUNT(l.ticket_id) AS line_count
         FROM cash_tickets t LEFT JOIN cash_ticket_lines l ON l.ticket_id = t.id
         WHERE t.salon_id = :salon AND t.status = 'pending'
         GROUP BY t.id ORDER BY t.updated_at DESC, t.id DESC"
    );
    $statement->execute(['salon' => $salonId]);
    $tickets = $statement->fetchAll();
    foreach ($tickets as &$ticket) {
        foreach (['id', 'revision', 'total_dzd', 'line_count'] as $field) $ticket[$field] = (int) $ticket[$field];
    }
    unset($ticket);
    bookili_json_response(200, ['tickets' => $tickets]);
}

function bookili_cash_record(PDO $pdo, int $actorId, array $data): never
{
    $payment = $data['paymentMethod'] ?? null;
    $key = $data['requestKey'] ?? null;
    $lines = $data['lines'] ?? null;
    $giftCode = $data['giftCardCode'] ?? '';
    $appointmentId = isset($data['appointmentId']) ? bookili_id($data['appointmentId']) : null;
    $ticketId = isset($data['ticketId']) ? bookili_id($data['ticketId']) : null;
    $ticketRevision = $data['ticketRevision'] ?? null;
    if (!is_string($payment) || !in_array($payment, ['cash', 'card', 'transfer', 'other'], true)
        || !is_string($key) || !preg_match('/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/D', $key)
        || !is_string($giftCode) || strlen($giftCode) > 64
        || !is_array($lines) || !array_is_list($lines) || count($lines) < 1 || count($lines) > 20
        || ($ticketId !== null && (!is_int($ticketRevision) || $ticketRevision < 1 || $appointmentId !== null))
        || ($ticketId === null && array_key_exists('ticketRevision', $data))) {
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
    $fingerprintData = [$payment, $cart, $giftCode, $appointmentId];
    if ($ticketId !== null) $fingerprintData[] = ['ticketId' => $ticketId, 'revision' => $ticketRevision];
    $fingerprint = hash('sha256', json_encode($fingerprintData, JSON_THROW_ON_ERROR));
    $pdo->beginTransaction();
    $salonId = (int) bookili_own_salon($pdo, $actorId, true)['id'];
    $statement = $pdo->prepare(    'SELECT id, request_hash, gift_card_id FROM cash_sales WHERE salon_id = :salon AND request_key = :key');
    $statement->execute(['salon' => $salonId, 'key' => $key]);
    if ($previous = $statement->fetch()) {
        if ($previous['request_hash'] !== $fingerprint) bookili_cash_conflict($pdo, 'Cette demande correspond déjà à une autre vente.');
        $pdo->commit();
        bookili_json_response(200, ['saleId' => (int) $previous['id'], 'duplicate' => true]);
    }
    $ticket = null;
    $ticketLines = [];
    if ($ticketId !== null) {
        $statement = $pdo->prepare(
            'SELECT status, revision, sale_id FROM cash_tickets WHERE id = :id AND salon_id = :salon FOR UPDATE'
        );
        $statement->execute(['id' => $ticketId, 'salon' => $salonId]);
        $ticket = $statement->fetch();
        if (!$ticket) bookili_cash_conflict($pdo, 'Ticket introuvable dans ce salon.');
        if ($ticket['status'] !== 'pending') bookili_cash_conflict($pdo, 'Ce ticket n’est plus en attente.');
        if ((int) $ticket['revision'] !== $ticketRevision) {
            bookili_cash_conflict($pdo, 'Ce ticket a été modifié ailleurs. Rechargez-le avant de l’encaisser.');
        }
        $statement = $pdo->prepare(
            'SELECT item_kind, item_id, item_name, quantity, unit_price_dzd
             FROM cash_ticket_lines WHERE ticket_id = :ticket'
        );
        $statement->execute(['ticket' => $ticketId]);
        foreach ($statement->fetchAll() as $row) {
            $ticketLines[$row['item_kind'] . ':' . $row['item_id']] = $row;
        }
        if (count($ticketLines) !== count($cart)) {
            bookili_cash_conflict($pdo, 'Le panier ne correspond plus au ticket en attente.');
        }
        foreach ($cart as $index => $line) {
            $saved = $ticketLines[$index] ?? null;
            if (!$saved || (int) $saved['quantity'] !== $line['quantity'] || (int) $saved['unit_price_dzd'] !== $line['price']) {
                bookili_cash_conflict($pdo, 'Le panier ne correspond plus au ticket en attente.');
            }
        }
    }
    $appointment = null;
    $appointmentServices = [];
    if ($appointmentId !== null) {
        $statement = $pdo->prepare(
            "SELECT id, service_id, service_name, price_dzd, starts_at, ends_at, status FROM appointments
             WHERE id = :id AND salon_id = :salon FOR UPDATE"
        );
        $statement->execute(['id' => $appointmentId, 'salon' => $salonId]);
        $appointment = $statement->fetch();
        if (!$appointment || $appointment['status'] !== 'confirmed') {
            bookili_cash_conflict($pdo, 'Ce rendez-vous n’est plus disponible pour l’encaissement.');
        }
        $appointmentServices = bookili_appointment_services($pdo, $appointmentId);
        if (!bookili_consistent_service_details($appointment, $appointmentServices)
            || (int) $appointmentServices[0]['service_id'] !== (int) $appointment['service_id']) {
            bookili_cash_conflict($pdo, 'Encaissement impossible : le détail des prestations est absent ou incohérent. Vérifiez le rendez-vous.');
        }
        $statement = $pdo->prepare('SELECT id FROM cash_sales WHERE appointment_id = :id FOR UPDATE');
        $statement->execute(['id' => $appointmentId]);
        if ($statement->fetchColumn()) bookili_cash_conflict($pdo, 'Ce rendez-vous possède déjà une vente dans le journal.');
        $expected = [];
        foreach ($appointmentServices as $service) {
            $expected[(int) $service['service_id']] = [
                'name' => $service['service_name'], 'price' => (int) $service['price_dzd'],
            ];
        }
        if (count($cart) !== count($expected)) {
            bookili_cash_conflict($pdo, 'Le panier ne correspond plus aux prestations du rendez-vous.');
        }
        foreach ($cart as $index => &$line) {
            if ($line['kind'] !== 'service' || $line['quantity'] !== 1 || !isset($expected[$line['id']])
                || $expected[$line['id']]['price'] !== $line['price']) {
                bookili_cash_conflict($pdo, 'Le panier ne correspond plus aux prestations du rendez-vous.');
            }
            $line['name'] = $expected[$line['id']]['name'];
            unset($expected[$line['id']]);
        }
        unset($line);
        if ($expected) bookili_cash_conflict($pdo, 'Le panier ne correspond plus aux prestations du rendez-vous.');
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
    foreach ($cart as $index => &$line) {
        $product = $line['kind'] === 'product';
        $item = $appointmentId !== null
            ? ['name' => $line['name'], 'price_dzd' => $line['price']]
            : ($product
                ? bookili_own_product($pdo, $salonId, $line['id'], true)
                : bookili_service($pdo, $salonId, $line['id']));
        if ((int) $item['price_dzd'] !== $line['price']) {
            bookili_cash_conflict($pdo, 'Un prix a changé. Actualisez le catalogue et ajoutez de nouveau l’article.');
        }
        if ($product && (!(int) $item['is_active'] || (int) $item['quantity'] < $line['quantity'])) {
            bookili_cash_conflict($pdo, 'Produit archivé ou stock insuffisant : vérifiez votre panier.');
        }
        $line['name'] = $ticketLines[$index]['item_name'] ?? $item['name'];
        if ($product) $line['after'] = (int) $item['quantity'] - $line['quantity'];
        $total += $line['quantity'] * $line['price'];
    }
    unset($line);
    if ($appointment && $total !== (int) $appointment['price_dzd']) {
        bookili_cash_conflict($pdo, 'Le total du rendez-vous ne correspond pas à ses prestations.');
    }
    $applied = min($total, (int) ($giftCard['balance_dzd'] ?? 0));
    $collected = $total - $applied;
    $storedPayment = $collected === 0 ? 'gift_card' : $payment;
    $now = bookili_now()->format('Y-m-d H:i:s');
    $pdo->prepare(
        'INSERT INTO cash_sales
         (salon_id, appointment_id, actor_id, request_key, request_hash, payment_method, total_dzd, collected_dzd, gift_card_applied_dzd, gift_card_id, recorded_at)
         VALUES (:salon, :appointment, :actor, :key, :hash, :payment, :total, :collected, :applied, :gift_card, :now)'
    )->execute([
        'salon' => $salonId, 'appointment' => $appointmentId, 'actor' => $actorId, 'key' => $key, 'hash' => $fingerprint,
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
    if ($ticketId !== null) {
        $pdo->prepare("UPDATE cash_tickets SET status = 'paid', sale_id = :sale, revision = revision + 1, updated_at = :now WHERE id = :id")
            ->execute(['sale' => $saleId, 'now' => $now, 'id' => $ticketId]);
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

function bookili_cash_period(): array
{
    $today = bookili_now()->format('Y-m-d');
    $from = bookili_calendar_date($_GET['from'] ?? $today);
    $to = bookili_calendar_date($_GET['to'] ?? $today);
    $page = isset($_GET['page']) ? bookili_id($_GET['page']) : 1;
    if ($from < bookili_calendar_date('2000-01-01') || $to < $from || $to->format('Y-m-d') > $today
        || $from->diff($to)->days > 365 || $page > 10000) {
        bookili_json_response(422, ['error' => 'Sélectionnez une période passée ou en cours de 366 jours maximum.']);
    }
    return [$from, $to, $page];
}

function bookili_cash_event_sql(string $staffScope = 'all'): string
{
    $filter = static function (string $parameter) use ($staffScope): string {
        $appointment = 'SELECT 1 FROM appointments a WHERE a.id = cash_sales.appointment_id AND a.salon_id = cash_sales.salon_id';
        if ($staffScope === 'unassigned') return " AND NOT EXISTS ($appointment AND a.staff_id IS NOT NULL)";
        if ($staffScope !== 'all') return " AND EXISTS ($appointment AND a.staff_id = :$parameter)";
        return '';
    };
    return "(SELECT id, payment_method, CAST(total_dzd AS SIGNED) AS amount_dzd, recorded_at AS event_at,
                    'sale' AS event_kind, voided_at, NULL AS reason, collected_dzd, gift_card_applied_dzd
             FROM cash_sales WHERE salon_id = :sale_salon AND recorded_at >= :sale_from AND recorded_at < :sale_to" . $filter('sale_staff') . ")
            UNION ALL
            (SELECT id, payment_method, -CAST(total_dzd AS SIGNED) AS amount_dzd, voided_at AS event_at,
                    'void' AS event_kind, voided_at, void_reason AS reason, -CAST(collected_dzd AS SIGNED) AS collected_dzd,
                    -CAST(gift_card_applied_dzd AS SIGNED) AS gift_card_applied_dzd
             FROM cash_sales WHERE salon_id = :void_salon AND voided_at >= :void_from AND voided_at < :void_to" . $filter('void_staff') . ")";
}

function bookili_cash_event_params(int $salonId, DateTimeImmutable $from, DateTimeImmutable $to): array
{
    $params = ['sale_salon' => $salonId, 'void_salon' => $salonId];
    $params['sale_from'] = $params['void_from'] = $from->format('Y-m-d 00:00:00');
    $params['sale_to'] = $params['void_to'] = $to->modify('+1 day')->format('Y-m-d 00:00:00');
    return $params;
}

function bookili_cash_overview(PDO $pdo, int $salonId, bool $statistics = false, bool $csv = false): never
{
    [$from, $to] = bookili_cash_period();
    $staffScope = 'all';
    $staffLabel = 'Toute l’équipe';
    $staff = [];
    if ($statistics) {
        $scope = $_GET['staff'] ?? 'all';
        $staffScope = in_array($scope, ['all', 'unassigned'], true) ? $scope : (string) bookili_id($scope);
        $statement = $pdo->prepare('SELECT id, name, is_active FROM staff_members WHERE salon_id = :salon ORDER BY is_active DESC, name, id');
        $statement->execute(['salon' => $salonId]);
        $staff = $statement->fetchAll();
        if ($staffScope === 'unassigned') $staffLabel = 'Non attribué';
        elseif ($staffScope !== 'all') {
            $staffLabel = array_column($staff, 'name', 'id')[$staffScope] ?? null;
            if ($staffLabel === null) bookili_json_response(404, ['error' => 'Collaborateur introuvable.']);
        }
    }
    $sql = bookili_cash_event_sql($staffScope);
    $params = bookili_cash_event_params($salonId, $from, $to);
    $visitParams = [
        'salon' => $salonId, 'from' => $params['sale_from'], 'to' => $params['sale_to'],
        'now' => bookili_now()->format('Y-m-d H:i:s'),
    ];
    $visitFilter = '';
    if ($staffScope === 'unassigned') $visitFilter = ' AND staff_id IS NULL';
    elseif ($staffScope !== 'all') {
        $params['sale_staff'] = $params['void_staff'] = $visitParams['staff'] = (int) $staffScope;
        $visitFilter = ' AND staff_id = :staff';
    }
    $statement = $pdo->prepare(
        "SELECT COALESCE(SUM(CASE WHEN event_kind = 'sale' THEN amount_dzd ELSE 0 END), 0) AS gross_dzd,
                COALESCE(SUM(CASE WHEN event_kind = 'void' THEN -amount_dzd ELSE 0 END), 0) AS void_dzd,
                COALESCE(SUM(amount_dzd), 0) AS net_dzd, COALESCE(SUM(collected_dzd), 0) AS received_dzd,
                COALESCE(SUM(gift_card_applied_dzd), 0) AS gift_card_dzd,
                COALESCE(SUM(event_kind = 'sale'), 0) AS sale_count,
                COALESCE(SUM(event_kind = 'void'), 0) AS void_count
         FROM ($sql) AS journal"
    );
    $statement->execute($params);
    $summary = array_map('intval', $statement->fetch());

    $statement = $pdo->prepare(
        "SELECT payment_method, COALESCE(SUM(amount_dzd), 0) AS net_dzd,
                COALESCE(SUM(collected_dzd), 0) AS received_dzd,
                COALESCE(SUM(gift_card_applied_dzd), 0) AS gift_card_dzd,
                COALESCE(SUM(event_kind = 'sale'), 0) AS sale_count
         FROM ($sql) AS journal GROUP BY payment_method ORDER BY payment_method"
    );
    $statement->execute($params);
    $payments = $statement->fetchAll();
    foreach ($payments as &$payment) {
        foreach (['net_dzd', 'received_dzd', 'gift_card_dzd', 'sale_count'] as $field) $payment[$field] = (int) $payment[$field];
    }
    unset($payment);

    $statement = $pdo->prepare(
        "SELECT DATE(event_at) AS day, COALESCE(SUM(CASE WHEN event_kind = 'sale' THEN amount_dzd ELSE 0 END), 0) AS gross_dzd,
                COALESCE(SUM(CASE WHEN event_kind = 'void' THEN -amount_dzd ELSE 0 END), 0) AS void_dzd,
                COALESCE(SUM(amount_dzd), 0) AS net_dzd,
                COALESCE(SUM(event_kind = 'sale'), 0) AS sale_count,
                COALESCE(SUM(event_kind = 'void'), 0) AS void_count
         FROM ($sql) AS journal GROUP BY DATE(event_at) ORDER BY day DESC"
    );
    $statement->execute($params);
    $days = [];
    foreach ($statement->fetchAll() as $row) {
        $days[$row['day']] = array_map('intval', $row);
        $days[$row['day']]['day'] = $row['day'];
        $days[$row['day']]['visit_count'] = 0;
    }
    $statement = $pdo->prepare(
        "SELECT DATE(ends_at) AS day, COUNT(*) AS visit_count FROM appointments
         WHERE salon_id = :salon AND status = 'confirmed' AND ends_at >= :from AND ends_at < :to AND ends_at <= :now$visitFilter
         GROUP BY DATE(ends_at)"
    );
    $statement->execute($visitParams);
    foreach ($statement->fetchAll() as $row) {
        if (!isset($days[$row['day']])) {
            $days[$row['day']] = ['day' => $row['day'], 'gross_dzd' => 0, 'void_dzd' => 0, 'net_dzd' => 0, 'sale_count' => 0, 'void_count' => 0];
        }
        $days[$row['day']]['visit_count'] = (int) $row['visit_count'];
    }
    krsort($days);
    $report = [
        'from' => $from->format('Y-m-d'), 'to' => $to->format('Y-m-d'),
        'summary' => $summary, 'payments' => $payments, 'days' => array_values($days),
    ];
    if ($statistics) {
        $statement = $pdo->prepare(
            "SELECT line.item_kind, SUM(CASE WHEN journal.event_kind = 'void' THEN -1 ELSE 1 END
                    * CAST(line.quantity AS SIGNED) * CAST(line.unit_price_dzd AS SIGNED)) AS net_dzd
             FROM ($sql) AS journal JOIN cash_sale_lines line ON line.sale_id = journal.id
             GROUP BY line.item_kind"
        );
        $statement->execute($params);
        $net = array_map('intval', array_column($statement->fetchAll(), 'net_dzd', 'item_kind'));
        $report['breakdown'] = [
            'services_dzd' => $net['service'] ?? 0,
            'products_dzd' => $net['product'] ?? 0,
            'other_dzd' => $net['gift_card'] ?? 0,
        ];
        $report['average_basket_dzd'] = $summary['sale_count'] > 0 ? round($summary['gross_dzd'] / $summary['sale_count'], 2) : null;
        $report['staff'] = $staff;
        $report['staffLabel'] = $staffLabel;
    }
    if ($csv) bookili_cash_statistics_csv($report);
    bookili_json_response(200, $report);
}

function bookili_cash_statistics_csv(array $report): never
{
    $output = fopen('php://output', 'wb');
    if ($output === false) throw new RuntimeException('Cannot open statistics CSV output.');
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="bookili-statistiques.csv"');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    fwrite($output, "\xEF\xBB\xBF");
    $write = static function (array $row) use ($output): void {
        fputcsv($output, $row, ';', '"', '');
    };
    $write(['Du', 'Au', 'Équipe']);
    $write([$report['from'], $report['to'], bookili_csv_text($report['staffLabel'])]);
    $write(['Indicateur', 'Valeur']);
    foreach ([
        'Ventes brutes (DA)' => 'gross_dzd', 'Annulations (DA)' => 'void_dzd', 'Net sur la période (DA)' => 'net_dzd',
        'Règlements encaissés nets (DA)' => 'received_dzd', 'Cartes cadeaux utilisées nettes (DA)' => 'gift_card_dzd',
        'Ventes' => 'sale_count', 'Annulations' => 'void_count',
    ] as $label => $key) $write([$label, $report['summary'][$key]]);
    $average = $report['average_basket_dzd'];
    $write(['Panier moyen brut (DA)', $average === null ? '' : number_format($average, 2, ',', '')]);
    $write(['Prestations nettes (DA)', $report['breakdown']['services_dzd']]);
    $write(['Produits nets (DA)', $report['breakdown']['products_dzd']]);
    $write(['Divers nets, dont cartes cadeaux émises (DA)', $report['breakdown']['other_dzd']]);
    $write(['Mode de règlement', 'Net (DA)', 'Encaissé (DA)', 'Carte cadeau (DA)', 'Ventes']);
    foreach ($report['payments'] as $row) {
        $write([BOOKILI_CASH_METHODS[$row['payment_method']], $row['net_dzd'], $row['received_dzd'], $row['gift_card_dzd'], $row['sale_count']]);
    }
    $write(['Jour (Algérie)', 'RDV confirmés passés', 'Ventes', 'Annulations', 'Net (DA)']);
    foreach ($report['days'] as $row) {
        $write([$row['day'], $row['visit_count'], $row['sale_count'], $row['void_count'], $row['net_dzd']]);
    }
    fclose($output);
    exit;
}

function bookili_cash_csv_output(string $filename)
{
    $output = fopen('php://output', 'wb');
    if ($output === false) throw new RuntimeException('Cannot open cash CSV output.');
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="' . $filename . '"');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    fwrite($output, "\xEF\xBB\xBF");
    return $output;
}

function bookili_cash_report_totals_sql(): string
{
    return "COALESCE(SUM(CASE WHEN events.event_kind = 'sale' THEN events.amount_dzd ELSE 0 END), 0) AS gross_dzd,
            COALESCE(SUM(CASE WHEN events.event_kind = 'void' THEN -events.amount_dzd ELSE 0 END), 0) AS void_dzd,
            COALESCE(SUM(events.amount_dzd), 0) AS net_dzd,
            COALESCE(SUM(events.collected_dzd), 0) AS received_dzd,
            COALESCE(SUM(events.event_kind = 'sale'), 0) AS sale_count,
            COALESCE(SUM(events.event_kind = 'void'), 0) AS void_count";
}

function bookili_cash_team_report(PDO $pdo, int $salonId, bool $csv): never
{
    [$from, $to, $page] = bookili_cash_period();
    $events = bookili_cash_event_sql();
    $totals = bookili_cash_report_totals_sql();
    $statement = $pdo->prepare(
        "SELECT m.id AS staff_id, COALESCE(m.name, 'Non attribué') AS staff_name, m.is_active, $totals
         FROM ($events) AS events
         JOIN cash_sales s ON s.id = events.id
         LEFT JOIN appointments a ON a.id = s.appointment_id AND a.salon_id = s.salon_id
         LEFT JOIN staff_members m ON m.id = a.staff_id AND m.salon_id = s.salon_id
         GROUP BY m.id, m.name, m.is_active ORDER BY m.id IS NULL, m.name, m.id"
         . ($csv ? '' : ' LIMIT 51 OFFSET ' . (($page - 1) * 50))
    );
    $statement->execute(bookili_cash_event_params($salonId, $from, $to));
    if ($csv) {
        $output = bookili_cash_csv_output('bookili-ventes-equipe.csv');
        fputcsv($output, ['Référence', 'Collaborateur', 'Statut', 'Ventes', 'Annulations', 'Brut (DA)', 'Annulations (DA)', 'Net (DA)', 'Encaissé net (DA)'], ';', '"', '');
        while ($row = $statement->fetch()) {
            fputcsv($output, [$row['staff_id'], bookili_csv_text($row['staff_name']),
                $row['staff_id'] === null ? '' : ((int) $row['is_active'] ? 'Actif' : 'Inactif'),
                $row['sale_count'], $row['void_count'], $row['gross_dzd'], $row['void_dzd'], $row['net_dzd'], $row['received_dzd']], ';', '"', '');
        }
        fclose($output);
        exit;
    }
    $rows = $statement->fetchAll();
    bookili_json_response(200, ['entries' => array_slice($rows, 0, 50), 'hasMore' => count($rows) > 50]);
}

function bookili_cash_comparison_report(PDO $pdo, int $salonId, bool $csv): never
{
    [$from, $to] = bookili_cash_period();
    $length = (int) $from->diff($to)->days + 1;
    $previousFrom = $from->modify("-$length days");
    $previousTo = $from->modify('-1 day');
    $events = bookili_cash_event_sql();
    $totals = bookili_cash_report_totals_sql();
    $statement = $pdo->prepare(
        "SELECT event_at >= :boundary AS is_current, $totals FROM ($events) AS events GROUP BY is_current"
    );
    $statement->execute(bookili_cash_event_params($salonId, $previousFrom, $to) + ['boundary' => $from->format('Y-m-d 00:00:00')]);
    $labels = [
        'sale_count' => 'Ventes', 'void_count' => 'Annulations', 'gross_dzd' => 'Ventes brutes (DA)',
        'void_dzd' => 'Annulations (DA)', 'net_dzd' => 'Ventes nettes (DA)', 'received_dzd' => 'Encaissé net (DA)',
    ];
    $rows = array_column($statement->fetchAll(), null, 'is_current');
    $report = [
        'current' => ['from' => $from->format('Y-m-d'), 'to' => $to->format('Y-m-d')],
        'previous' => ['from' => $previousFrom->format('Y-m-d'), 'to' => $previousTo->format('Y-m-d')],
    ];
    foreach (['current' => 1, 'previous' => 0] as $period => $index) {
        foreach ($labels as $key => $label) $report[$period][$key] = (int) ($rows[$index][$key] ?? 0);
    }
    if ($csv) {
        $output = bookili_cash_csv_output('bookili-comparaison-periodes.csv');
        fputcsv($output, ['Indicateur', 'Période sélectionnée', 'Période précédente', 'Écart'], ';', '"', '');
        fputcsv($output, ['Du', $report['current']['from'], $report['previous']['from']], ';', '"', '');
        fputcsv($output, ['Au', $report['current']['to'], $report['previous']['to']], ';', '"', '');
        foreach ($labels as $key => $label) {
            $current = $report['current'][$key];
            $previous = $report['previous'][$key];
            fputcsv($output, [$label, $current, $previous, $current - $previous], ';', '"', '');
        }
        fclose($output);
        exit;
    }
    bookili_json_response(200, $report);
}

function bookili_cash_items_report(PDO $pdo, int $salonId, bool $csv): never
{
    [$from, $to, $page] = bookili_cash_period();
    $kind = $_GET['kind'] ?? 'service';
    if (!in_array($kind, ['service', 'product'], true)) {
        bookili_json_response(422, ['error' => 'Choisissez Prestations ou Produits.']);
    }
    $events = bookili_cash_event_sql();
    $statement = $pdo->prepare(
        "SELECT line.item_id, line.item_name,
                SUM(CASE WHEN events.event_kind = 'sale' THEN line.quantity ELSE 0 END) AS sold_quantity,
                SUM(CASE WHEN events.event_kind = 'void' THEN line.quantity ELSE 0 END) AS void_quantity,
                SUM(CASE WHEN events.event_kind = 'sale' THEN line.quantity * line.unit_price_dzd ELSE 0 END) AS gross_dzd,
                SUM(CASE WHEN events.event_kind = 'void' THEN line.quantity * line.unit_price_dzd ELSE 0 END) AS void_dzd
         FROM ($events) AS events JOIN cash_sale_lines line ON line.sale_id = events.id
         WHERE line.item_kind = :kind
         GROUP BY line.item_id, BINARY line.item_name, line.item_name
         ORDER BY line.item_name, line.item_id, BINARY line.item_name"
         . ($csv ? '' : ' LIMIT 51 OFFSET ' . (($page - 1) * 50))
    );
    $statement->execute(bookili_cash_event_params($salonId, $from, $to) + ['kind' => $kind]);
    if ($csv) {
        $output = bookili_cash_csv_output($kind === 'service' ? 'bookili-ventes-prestations.csv' : 'bookili-ventes-produits.csv');
        fputcsv($output, ['Référence', 'Nom à la vente', 'Quantité vendue', 'Quantité annulée', 'Brut (DA)', 'Annulations (DA)', 'Net (DA)'], ';', '"', '');
        while ($row = $statement->fetch()) {
            fputcsv($output, [$row['item_id'], bookili_csv_text($row['item_name']), $row['sold_quantity'],
                $row['void_quantity'], $row['gross_dzd'], $row['void_dzd'], (int) $row['gross_dzd'] - (int) $row['void_dzd']], ';', '"', '');
        }
        fclose($output);
        exit;
    }
    $rows = $statement->fetchAll();
    bookili_json_response(200, ['entries' => array_slice($rows, 0, 50), 'hasMore' => count($rows) > 50]);
}

function bookili_cash_journal(PDO $pdo, int $salonId, bool $csv, string $scope = 'all'): never
{
    [$from, $to, $page] = bookili_cash_period();
    $sql = bookili_cash_event_sql();
    $params = bookili_cash_event_params($salonId, $from, $to);
    $payments = $scope === 'payments';
    if ($scope === 'voids') {
        $sql = "SELECT * FROM ($sql) AS events WHERE event_kind = 'void'";
    }
    if ($payments) {
        $method = $_GET['method'] ?? '';
        if (!is_string($method) || ($method !== '' && !isset(BOOKILI_CASH_METHODS[$method]))) {
            bookili_json_response(422, ['error' => 'Mode de règlement invalide.']);
        }
        $sql = "SELECT id, event_at, event_kind, payment_method,
                       " . ($method === 'gift_card' ? '0' : 'collected_dzd') . " AS collected_dzd,
                       " . ($method === '' || $method === 'gift_card' ? 'gift_card_applied_dzd' : '0') . " AS gift_card_applied_dzd
                FROM ($sql) AS events WHERE ";
        if ($method === 'gift_card') $sql .= 'gift_card_applied_dzd <> 0';
        elseif ($method !== '') {
            $sql .= 'payment_method = :method AND collected_dzd <> 0';
            $params['method'] = $method;
        } else $sql .= '(collected_dzd <> 0 OR gift_card_applied_dzd <> 0)';
    }
    $statement = $pdo->prepare($sql . ' ORDER BY event_at DESC, id DESC, event_kind DESC'
        . ($csv ? '' : ' LIMIT 51 OFFSET ' . (($page - 1) * 50)));
    $statement->execute($params);
    if ($csv) {
        $output = bookili_cash_csv_output(match ($scope) {
            'payments' => 'bookili-reglements.csv',
            'voids' => 'bookili-annulations.csv',
            default => 'bookili-journal-caisse.csv',
        });
        $columns = ['Date (Algérie)', 'Vente', 'Opération', 'Mode de règlement'];
        fputcsv($output, [...$columns, ...($payments ? ['Encaissé (DA)', 'Carte cadeau (DA)']
            : ['Montant brut (DA)', 'Encaissé (DA)', 'Carte cadeau (DA)', 'Motif'])], ';', '"', '');
        while ($row = $statement->fetch()) {
            $base = [
                $row['event_at'], $row['id'], $row['event_kind'] === 'void' ? 'Annulation' : 'Vente',
                BOOKILI_CASH_METHODS[$payments && (int) $row['collected_dzd'] === 0 ? 'gift_card' : $row['payment_method']],
            ];
            fputcsv($output, [...$base, ...($payments ? [$row['collected_dzd'], $row['gift_card_applied_dzd']]
                : [$row['amount_dzd'], $row['collected_dzd'], $row['gift_card_applied_dzd'], bookili_csv_text($row['reason'] ?? '')])], ';', '"', '');
        }
        fclose($output);
        exit;
    }
    $rows = $statement->fetchAll();
    if ($payments) {
        $summary = $pdo->prepare("SELECT COALESCE(SUM(collected_dzd), 0) AS collected,
            COALESCE(SUM(gift_card_applied_dzd), 0) AS gift FROM ($sql) AS movements");
        $summary->execute($params);
        bookili_json_response(200, ['entries' => array_slice($rows, 0, 50), 'hasMore' => count($rows) > 50,
            'totals' => array_map('intval', $summary->fetch())]);
    }
    $summary = $pdo->prepare("SELECT COALESCE(SUM(amount_dzd), 0) FROM ($sql) AS journal");
    $summary->execute($params);
    bookili_json_response(200, ['entries' => array_slice($rows, 0, 50), 'hasMore' => count($rows) > 50, 'netDzd' => (int) $summary->fetchColumn()]);
}

function bookili_cash_cards(PDO $pdo, int $salonId, bool $csv): never
{
    $page = isset($_GET['page']) ? bookili_id($_GET['page']) : 1;
    $filter = $_GET['status'] ?? 'all';
    if ($page > 10000 || !in_array($filter, ['all', 'expired'], true)) {
        bookili_json_response(422, ['error' => 'Filtre de cartes cadeaux invalide.']);
    }
    $today = bookili_now()->format('Y-m-d');
    $status = "CASE WHEN status = 'active' AND expires_on < :today THEN 'expired' ELSE status END";
    $sql = "SELECT id, initial_value_dzd, balance_dzd, expires_on, issued_at, $status AS status
            FROM gift_cards WHERE salon_id = :salon";
    $params = ['salon' => $salonId, 'today' => $today];
    if ($filter === 'expired') {
        $sql .= " AND (status = 'expired' OR (status = 'active' AND expires_on < :expiry))";
        $params['expiry'] = $today;
    }
    $statement = $pdo->prepare($sql . ' ORDER BY id DESC' . ($csv ? '' : ' LIMIT 51 OFFSET ' . (($page - 1) * 50)));
    $statement->execute($params);
    if ($csv) {
        $output = bookili_cash_csv_output('bookili-cartes-cadeaux.csv');
        fputcsv($output, ['Carte', 'Émise le (Algérie)', 'Valable jusqu’au', 'Valeur initiale (DA)', 'Solde (DA)', 'Statut'], ';', '"', '');
        while ($row = $statement->fetch()) {
            $label = match ($row['status']) {
                'expired' => 'Expirée', 'voided' => 'Annulée',
                default => (int) $row['balance_dzd'] > 0 ? 'Active' : 'Solde épuisé',
            };
            fputcsv($output, [$row['id'], $row['issued_at'], $row['expires_on'], $row['initial_value_dzd'], $row['balance_dzd'], $label], ';', '"', '');
        }
        fclose($output);
        exit;
    }
    $cards = $statement->fetchAll();
    bookili_json_response(200, ['cards' => array_slice($cards, 0, 50), 'hasMore' => count($cards) > 50]);
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
            if (($data['action'] ?? '') === 'save_ticket') bookili_cash_ticket_save($pdo, $actorId, $data);
            if (($data['action'] ?? '') === 'update_ticket') bookili_cash_ticket_update($pdo, $actorId, $data);
            if (($data['action'] ?? '') === 'cancel_ticket') bookili_cash_ticket_cancel($pdo, $actorId, $data);
            if (($data['action'] ?? '') === 'void') bookili_cash_void($pdo, $actorId, $data);
            bookili_json_response(422, ['error' => 'Action de caisse invalide.']);
        }
        $salonId = (int) bookili_own_salon($pdo, $actorId)['id'];
        $view = $_GET['view'] ?? 'journal';
        if ($view === 'catalog') bookili_cash_catalog($pdo, $salonId);
        if ($view === 'sale') bookili_json_response(200, bookili_cash_sale($pdo, $salonId, bookili_id($_GET['saleId'] ?? null)));
        if ($view === 'tickets') bookili_cash_tickets($pdo, $salonId);
        if ($view === 'ticket') bookili_json_response(200, bookili_cash_ticket($pdo, $salonId, bookili_id($_GET['ticketId'] ?? null)));
        if ($view === 'overview') bookili_cash_overview($pdo, $salonId);
        if ($view === 'statistics' || $view === 'statistics-csv') bookili_cash_overview($pdo, $salonId, true, $view === 'statistics-csv');
        if ($view === 'cards' || $view === 'cards-csv') bookili_cash_cards($pdo, $salonId, $view === 'cards-csv');
        if ($view === 'payments' || $view === 'payments-csv') bookili_cash_journal($pdo, $salonId, $view === 'payments-csv', 'payments');
        if ($view === 'items-report' || $view === 'items-report-csv') bookili_cash_items_report($pdo, $salonId, $view === 'items-report-csv');
        if ($view === 'team-report' || $view === 'team-report-csv') bookili_cash_team_report($pdo, $salonId, $view === 'team-report-csv');
        if ($view === 'comparison' || $view === 'comparison-csv') bookili_cash_comparison_report($pdo, $salonId, $view === 'comparison-csv');
        if ($view === 'voids' || $view === 'voids-csv') bookili_cash_journal($pdo, $salonId, $view === 'voids-csv', 'voids');
        if ($view === 'journal' || $view === 'csv') bookili_cash_journal($pdo, $salonId, $view === 'csv');
        bookili_json_response(422, ['error' => 'Vue de caisse invalide.']);
    } catch (Throwable $error) {
        if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
        bookili_database_error($error);
    }
}
