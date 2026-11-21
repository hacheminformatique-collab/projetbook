<?php
declare(strict_types=1);
require_once __DIR__ . '/professional-cash.php';

$method = bookili_booking_method();
$data = $method === 'POST' ? bookili_read_json() : [];

try {
    $pdo = bookili_database();
    $account = bookili_require_role($pdo, ['professional']);
    $actorId = (int) $account['id'];
    $now = bookili_now();
    $today = $now->format('Y-m-d');
    $day = bookili_calendar_date($method === 'POST' ? ($data['date'] ?? null) : ($_GET['date'] ?? $today));
    $date = $day->format('Y-m-d');
    if ($date > $today || $date < '2000-01-01') {
        bookili_json_response(422, ['error' => 'Choisissez une date passée ou la journée en cours.']);
    }

    $pdo->beginTransaction();
    $salonId = (int) bookili_own_salon($pdo, $actorId, $method === 'POST')['id'];
    $params = ['salon' => $salonId, 'day' => $date];
    $statement = $pdo->prepare('SELECT opening_dzd, opened_at FROM cash_drawer_days WHERE salon_id = :salon AND drawer_date = :day');
    $statement->execute($params);
    $opening = $statement->fetch();

    if ($method === 'POST') {
        $action = $data['action'] ?? '';
        $amount = $data['amountDzd'] ?? null;
        if (!in_array($action, ['open', 'move'], true) || !is_int($amount) || $amount < ($action === 'open' ? 0 : 1) || $amount > 10000000) {
            bookili_json_response(422, ['error' => 'Saisissez un montant entier en DA dans les limites indiquées.']);
        }
        if ($action === 'move') {
            $kind = $data['kind'] ?? '';
            $key = $data['requestKey'] ?? '';
            $note = $data['note'] ?? '';
            if (!in_array($kind, ['deposit', 'withdrawal', 'bank'], true) || !is_string($key)
                || !preg_match('/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/D', $key)
                || !is_string($note) || str_contains($note, "\0") || !preg_match('/^.{1,160}$/usD', trim($note))) {
                bookili_json_response(422, ['error' => 'Vérifiez le type de mouvement et son motif (160 caractères maximum).']);
            }
            $note = trim($note);
            $statement = $pdo->prepare('SELECT id, drawer_date, kind, amount_dzd, note FROM cash_drawer_movements WHERE salon_id = :salon AND request_key = :request');
            $statement->execute(['salon' => $salonId, 'request' => $key]);
            if ($previous = $statement->fetch()) {
                if ($previous['drawer_date'] !== $date || $previous['kind'] !== $kind
                    || (int) $previous['amount_dzd'] !== $amount || $previous['note'] !== $note) {
                    bookili_cash_conflict($pdo, 'Cette demande correspond déjà à un autre mouvement.');
                }
                $pdo->commit();
                bookili_json_response(200, ['id' => (int) $previous['id'], 'duplicate' => true]);
            }
        } elseif ($opening && (int) $opening['opening_dzd'] === $amount) {
            $pdo->commit();
            bookili_json_response(200, ['duplicate' => true]);
        }

        $now = bookili_now();
        if ($date !== $now->format('Y-m-d')) {
            bookili_cash_conflict($pdo, 'Seule la caisse du jour peut être modifiée. Actualisez la page.');
        }
        $write = $params + ['actor' => $actorId, 'amount' => $amount, 'time' => $now->format('Y-m-d H:i:s')];
        if ($action === 'open') {
            if ($opening) bookili_cash_conflict($pdo, 'Le fond de caisse de cette journée est déjà enregistré.');
            $pdo->prepare('INSERT INTO cash_drawer_days (salon_id, drawer_date, opened_by, opening_dzd, opened_at)
                           VALUES (:salon, :day, :actor, :amount, :time)')->execute($write);
            $pdo->commit();
            bookili_json_response(201, ['duplicate' => false]);
        }
        if (!$opening) bookili_cash_conflict($pdo, 'Enregistrez le fond de caisse avant de saisir un mouvement.');
        $pdo->prepare('INSERT INTO cash_drawer_movements (salon_id, drawer_date, actor_id, amount_dzd, recorded_at, request_key, kind, note)
                       VALUES (:salon, :day, :actor, :amount, :time, :request, :kind, :note)')
            ->execute($write + ['request' => $key, 'kind' => $kind, 'note' => $note]);
        $id = (int) $pdo->lastInsertId();
        $pdo->commit();
        bookili_json_response(201, ['id' => $id, 'duplicate' => false]);
    }

    $page = isset($_GET['page']) ? bookili_id($_GET['page']) : 1;
    if ($page > 10000) bookili_json_response(422, ['error' => 'Page invalide.']);
    $sql = bookili_cash_event_sql();
    $statement = $pdo->prepare("SELECT COALESCE(SUM(collected_dzd), 0) FROM ($sql) AS events WHERE payment_method = 'cash'");
    $statement->execute(bookili_cash_event_params($salonId, $day, $day));
    $cashNet = (int) $statement->fetchColumn();
    $statement = $pdo->prepare(
        'SELECT kind, SUM(amount_dzd) AS total FROM cash_drawer_movements
         WHERE salon_id = :salon AND drawer_date = :day GROUP BY kind'
    );
    $statement->execute($params);
    $totals = array_map('intval', array_column($statement->fetchAll(), 'total', 'kind'))
        + ['deposit' => 0, 'withdrawal' => 0, 'bank' => 0];
    $statement = $pdo->prepare(
        'SELECT id, kind, amount_dzd, note, recorded_at FROM cash_drawer_movements
         WHERE salon_id = :salon AND drawer_date = :day ORDER BY id DESC LIMIT 51 OFFSET ' . (($page - 1) * 50)
    );
    $statement->execute($params);
    $rows = $statement->fetchAll();
    $pdo->commit();
    bookili_json_response(200, [
        'date' => $date, 'today' => $today, 'opening' => $opening ?: null,
        'cashNetDzd' => $cashNet, 'totals' => $totals,
        'expectedDzd' => $opening ? (int) $opening['opening_dzd'] + $cashNet + $totals['deposit'] - $totals['withdrawal'] - $totals['bank'] : null,
        'movements' => array_slice($rows, 0, 50), 'hasMore' => count($rows) > 50,
    ]);
} catch (Throwable $error) {
    if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
    bookili_database_error($error);
}
