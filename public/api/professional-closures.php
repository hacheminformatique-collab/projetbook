<?php
declare(strict_types=1);
require_once __DIR__ . '/booking.php';

$method = bookili_booking_method();
$data = $method === 'POST' ? bookili_read_json() : [];

try {
    $pdo = bookili_database();
    $account = bookili_require_role($pdo, ['professional']);
    if ($method === 'POST') {
        $action = $data['action'] ?? null;
        if (!in_array($action, ['add', 'remove'], true)) {
            bookili_json_response(422, ['error' => 'Action invalide.']);
        }
        $day = bookili_calendar_date($data['date'] ?? null);
        $today = bookili_now()->setTime(0, 0);
        if ($action === 'add' && ($day < $today || $day > $today->modify('+365 days'))) {
            bookili_json_response(422, ['error' => 'Choisissez une date entre aujourd’hui et les 365 prochains jours.']);
        }
        $reason = $data['reason'] ?? '';
        if ($action === 'add' && (!is_string($reason) || strlen(trim($reason)) > 180 || str_contains($reason, "\0"))) {
            bookili_json_response(422, ['error' => 'Le motif ne doit pas dépasser 180 caractères.']);
        }
        $pdo->beginTransaction();
        $salon = bookili_own_salon($pdo, (int) $account['id'], true);
        $params = ['salon_id' => $salon['id'], 'date' => $day->format('Y-m-d')];
        if ($action === 'add') {
            $statement = $pdo->prepare(
                "SELECT COUNT(*) FROM appointments WHERE salon_id = :salon_id AND status = 'confirmed'
                 AND starts_at < :day_end AND ends_at > :day_start"
            );
            $statement->execute([
                'salon_id' => $salon['id'], 'day_start' => $day->format('Y-m-d 00:00:00'),
                'day_end' => $day->modify('+1 day')->format('Y-m-d 00:00:00'),
            ]);
            if ((int) $statement->fetchColumn() > 0) {
                $pdo->rollBack();
                bookili_json_response(409, ['error' => 'Des rendez-vous confirmés existent ce jour. Gérez-les dans votre agenda avant de fermer cette journée.']);
            }
            $statement = $pdo->prepare('SELECT 1 FROM salon_closures WHERE salon_id = :salon_id AND closure_date = :date');
            $statement->execute($params);
            if ($statement->fetchColumn()) {
                $pdo->rollBack();
                bookili_json_response(409, ['error' => 'Cette journée est déjà fermée.']);
            }
            $pdo->prepare('INSERT INTO salon_closures (salon_id, closure_date, reason) VALUES (:salon_id, :date, :reason)')
                ->execute($params + ['reason' => trim($reason)]);
        } else {
            $statement = $pdo->prepare('DELETE FROM salon_closures WHERE salon_id = :salon_id AND closure_date = :date');
            $statement->execute($params);
            if ($statement->rowCount() === 0) {
                $pdo->rollBack();
                bookili_json_response(404, ['error' => 'Cette fermeture est introuvable.']);
            }
        }
        $pdo->commit();
        bookili_json_response(200, ['message' => $action === 'add' ? 'Journée fermée aux nouvelles réservations.' : 'Fermeture supprimée. Les horaires habituels s’appliquent à nouveau.']);
    }

    $salon = bookili_own_salon($pdo, (int) $account['id']);
    $page = isset($_GET['page']) ? bookili_id($_GET['page']) : 1;
    if ($page > 10000) bookili_json_response(422, ['error' => 'Page invalide.']);
    $statement = $pdo->prepare(
        'SELECT closure_date, reason FROM salon_closures WHERE salon_id = :id AND closure_date >= :today
         ORDER BY closure_date LIMIT 51 OFFSET ' . (($page - 1) * 50)
    );
    $statement->execute(['id' => $salon['id'], 'today' => bookili_now()->format('Y-m-d')]);
    $closures = $statement->fetchAll();
    bookili_json_response(200, ['closures' => array_slice($closures, 0, 50), 'hasMore' => count($closures) > 50]);
} catch (Throwable $error) {
    if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
    bookili_database_error($error);
}
