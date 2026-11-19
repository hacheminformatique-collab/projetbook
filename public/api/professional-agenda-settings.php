<?php
declare(strict_types=1);
require_once __DIR__ . '/booking.php';

function bookili_agenda_settings(array $salon): array
{
    return [
        'showTime' => (bool) $salon['agenda_show_time'],
        'showClient' => (bool) $salon['agenda_show_client'],
        'showServices' => (bool) $salon['agenda_show_services'],
        'showNote' => (bool) $salon['agenda_show_note'],
        'showAddButton' => (bool) $salon['agenda_show_add_button'],
    ];
}

$method = bookili_booking_method();
$data = $method === 'POST' ? bookili_read_json() : [];

try {
    $pdo = bookili_database();
    $account = bookili_require_role($pdo, ['professional']);
    $salon = bookili_own_salon($pdo, (int) $account['id']);
    if ($method === 'POST') {
        $settings = $data['settings'] ?? null;
        $keys = ['showTime', 'showClient', 'showServices', 'showNote', 'showAddButton'];
        if (!is_array($settings) || array_diff(array_keys($settings), $keys)
            || array_diff($keys, array_keys($settings))) {
            bookili_json_response(422, ['error' => 'Vérifiez les options d’affichage de l’agenda.']);
        }
        foreach ($keys as $key) {
            if (!is_bool($settings[$key])) {
                bookili_json_response(422, ['error' => 'Chaque option de l’agenda doit être activée ou désactivée.']);
            }
        }
        $pdo->beginTransaction();
        $salon = bookili_own_salon($pdo, (int) $account['id'], true);
        $pdo->prepare(
            'UPDATE salons SET agenda_show_time = :time, agenda_show_client = :client,
             agenda_show_services = :services, agenda_show_note = :note,
             agenda_show_add_button = :add_button WHERE id = :id'
        )->execute([
            'time' => (int) $settings['showTime'], 'client' => (int) $settings['showClient'],
            'services' => (int) $settings['showServices'], 'note' => (int) $settings['showNote'],
            'add_button' => (int) $settings['showAddButton'], 'id' => $salon['id'],
        ]);
        $pdo->commit();
    }
    $statement = $pdo->prepare(
        'SELECT agenda_show_time, agenda_show_client, agenda_show_services,
                agenda_show_note, agenda_show_add_button FROM salons WHERE id = :id'
    );
    $statement->execute(['id' => $salon['id']]);
    $settings = $statement->fetch();
    bookili_json_response(200, [
        'settings' => bookili_agenda_settings($settings),
        'message' => $method === 'POST' ? 'Affichage de l’agenda enregistré.' : null,
    ]);
} catch (Throwable $error) {
    if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
    bookili_database_error($error);
}
