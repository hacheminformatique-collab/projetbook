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
            bookili_json_response(422, ['error' => 'Action d’absence invalide.']);
        }
        if ($action === 'add') {
            $staffId = bookili_id($data['staffId'] ?? null);
            $start = bookili_calendar_date($data['startDate'] ?? null);
            $end = bookili_calendar_date($data['endDate'] ?? null);
            $today = bookili_now()->setTime(0, 0);
            $maximum = $today->modify('+365 days');
            $reason = $data['reason'] ?? '';
            if ($start < $today || $end < $start || $end > $maximum) {
                bookili_json_response(422, ['error' => 'Choisissez des dates futures ou actuelles, dans une période maximale d’un an.']);
            }
            if (!is_string($reason) || strlen(trim($reason)) > 180 || str_contains($reason, "\0")) {
                bookili_json_response(422, ['error' => 'Le motif privé ne doit pas dépasser 180 caractères.']);
            }
        } else {
            $absenceId = bookili_id($data['absenceId'] ?? null);
        }
        $pdo->beginTransaction();
        $salon = bookili_own_salon($pdo, (int) $account['id'], true);
        if ($action === 'add') {
            $statement = $pdo->prepare('SELECT id FROM staff_members WHERE id = :staff AND salon_id = :salon FOR UPDATE');
            $statement->execute(['staff' => $staffId, 'salon' => $salon['id']]);
            if (!$statement->fetchColumn()) {
                $pdo->rollBack();
                bookili_json_response(404, ['error' => 'Collaborateur introuvable.']);
            }

            $startDate = $start->format('Y-m-d');
            $endDate = $end->format('Y-m-d');
            $statement = $pdo->prepare(
                'SELECT id FROM staff_absences
                 WHERE staff_id = :staff AND start_date <= :end_date AND end_date >= :start_date LIMIT 1'
            );
            $statement->execute(['staff' => $staffId, 'start_date' => $startDate, 'end_date' => $endDate]);
            if ($statement->fetchColumn()) {
                $pdo->rollBack();
                bookili_json_response(409, ['error' => 'Cette période chevauche une absence déjà enregistrée.']);
            }

            $statement = $pdo->prepare(
                "SELECT id FROM appointments
                 WHERE salon_id = :salon AND staff_id = :staff AND status = 'confirmed'
                   AND starts_at < :end AND ends_at > :start LIMIT 1"
            );
            $statement->execute([
                'salon' => $salon['id'], 'staff' => $staffId,
                'start' => $start->format('Y-m-d 00:00:00'),
                'end' => $end->modify('+1 day')->format('Y-m-d 00:00:00'),
            ]);
            if ($statement->fetchColumn()) {
                $pdo->rollBack();
                bookili_json_response(409, ['error' => 'Des rendez-vous confirmés sont prévus avec ce collaborateur. Gérez-les dans l’agenda avant d’ajouter son absence.']);
            }

            $pdo->prepare(
                'INSERT INTO staff_absences (staff_id, start_date, end_date, reason, created_at)
                 VALUES (:staff, :start_date, :end_date, :reason, :created)'
            )->execute([
                'staff' => $staffId, 'start_date' => $startDate, 'end_date' => $endDate,
                'reason' => trim($reason), 'created' => bookili_now()->format('Y-m-d H:i:s'),
            ]);
            $message = 'Absence du collaborateur enregistrée. Les nouvelles réservations seront bloquées pendant cette période.';
        } else {
            $statement = $pdo->prepare(
                'SELECT a.id FROM staff_absences a
                 INNER JOIN staff_members m ON m.id = a.staff_id
                 WHERE a.id = :absence AND m.salon_id = :salon FOR UPDATE'
            );
            $statement->execute(['absence' => $absenceId, 'salon' => $salon['id']]);
            if (!$statement->fetchColumn()) {
                $pdo->rollBack();
                bookili_json_response(404, ['error' => 'Cette absence est introuvable.']);
            }
            $pdo->prepare('DELETE FROM staff_absences WHERE id = :id')->execute(['id' => $absenceId]);
            $message = 'Absence supprimée. Les horaires habituels s’appliquent à nouveau.';
        }
        $pdo->commit();
        bookili_json_response(200, ['message' => $message]);
    }

    $salon = bookili_own_salon($pdo, (int) $account['id']);
    $page = isset($_GET['page']) ? bookili_id($_GET['page']) : 1;
    if ($page > 10000) bookili_json_response(422, ['error' => 'Page invalide.']);
    $statement = $pdo->prepare(
        'SELECT id, name, is_active FROM staff_members WHERE salon_id = :salon ORDER BY is_active DESC, name, id'
    );
    $statement->execute(['salon' => $salon['id']]);
    $staff = $statement->fetchAll();
    foreach ($staff as &$member) {
        $member['id'] = (int) $member['id'];
        $member['is_active'] = (bool) $member['is_active'];
    }
    unset($member);

    $statement = $pdo->prepare(
        'SELECT a.id, a.staff_id, a.start_date, a.end_date, a.reason, m.name AS staff_name
         FROM staff_absences a
         INNER JOIN staff_members m ON m.id = a.staff_id
         WHERE m.salon_id = :salon AND a.end_date >= :today
         ORDER BY a.start_date, a.end_date, m.name, a.id LIMIT 51 OFFSET ' . (($page - 1) * 50)
    );
    $statement->execute(['salon' => $salon['id'], 'today' => bookili_now()->format('Y-m-d')]);
    $absences = $statement->fetchAll();
    foreach ($absences as &$absence) {
        $absence['id'] = (int) $absence['id'];
        $absence['staff_id'] = (int) $absence['staff_id'];
    }
    unset($absence);
    bookili_json_response(200, [
        'staff' => $staff, 'absences' => array_slice($absences, 0, 50),
        'hasMore' => count($absences) > 50, 'page' => $page,
    ]);
} catch (Throwable $error) {
    if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
    bookili_database_error($error);
}
