<?php
declare(strict_types=1);

// Run after professional-agenda.py, only against the same disposable installation.
if (getenv('BOOKILI_DISPOSABLE_TEST') !== '1' || !getenv('BOOKILI_TEST_URL')) {
    throw new RuntimeException('An explicitly disposable test installation and BOOKILI_TEST_URL are required.');
}
require_once __DIR__ . '/../public/api/booking.php';

$pdo = bookili_database();
$appointment = $pdo->query(
    "SELECT b.id, b.starts_at, b.ends_at, b.price_dzd, b.notification_version, b.staff_id, a.email
     FROM appointments b
     INNER JOIN salons s ON s.id = b.salon_id
     INNER JOIN professional_profiles p ON p.id = s.professional_profile_id
     INNER JOIN accounts a ON a.id = p.account_id
     WHERE b.service_name = 'Coupe + Soin' AND b.status = 'confirmed'
       AND NOT EXISTS (SELECT 1 FROM cash_sales cs WHERE cs.appointment_id = b.id)
     ORDER BY b.id LIMIT 1"
)->fetch();
if (!$appointment) throw new RuntimeException('Expected an uncashed multi-service appointment from professional-agenda.py.');
$id = (int) $appointment['id'];
$services = $pdo->prepare(
    'SELECT position, service_id, service_name, duration_minutes, price_dzd
     FROM appointment_services WHERE appointment_id = :id ORDER BY position'
);
$services->execute(['id' => $id]);
$original = $services->fetchAll();
if (count($original) !== 2) throw new RuntimeException('Expected two saved services.');

$curl = curl_init();
curl_setopt_array($curl, [
    CURLOPT_RETURNTRANSFER => true, CURLOPT_COOKIEFILE => '', CURLOPT_TIMEOUT => 15,
]);
$base = rtrim(getenv('BOOKILI_TEST_URL'), '/') . '/api/';
$request = static function (string $path, ?array $body = null, string $csrf = '', bool $csv = false) use ($curl, $base): array {
    curl_setopt_array($curl, [
        CURLOPT_URL => $base . $path,
        CURLOPT_HTTPGET => true,
        CURLOPT_HTTPHEADER => [],
    ]);
    if ($body !== null) {
        curl_setopt_array($curl, [
            CURLOPT_POST => true, CURLOPT_POSTFIELDS => json_encode($body, JSON_THROW_ON_ERROR),
            CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'X-CSRF-Token: ' . $csrf],
        ]);
    }
    $result = curl_exec($curl);
    if ($result === false) throw new RuntimeException(curl_error($curl));
    return [curl_getinfo($curl, CURLINFO_RESPONSE_CODE), $csv ? $result : json_decode($result, true, 512, JSON_THROW_ON_ERROR)];
};
$check = static function (bool $condition, string $message): void {
    if (!$condition) throw new RuntimeException($message);
};
[$status, $csrf] = $request('csrf.php');
$check($status === 200, 'Could not obtain a CSRF token.');
[$status, $session] = $request('login.php', [
    'email' => $appointment['email'], 'password' => 'Mot-de-passe-test-123',
], $csrf['csrfToken']);
$check($status === 200, 'Could not log in as the test professional.');
$token = $session['csrfToken'];
$agendaPath = 'professional-agenda.php?date=' . substr($appointment['starts_at'], 0, 10);
$delete = $pdo->prepare('DELETE FROM appointment_services WHERE appointment_id = :id');
$insert = $pdo->prepare(
    'INSERT INTO appointment_services (appointment_id, position, service_id, service_name, duration_minutes, price_dzd)
     VALUES (:appointment, :position, :service_id, :service_name, :duration_minutes, :price_dzd)'
);
$restore = static function () use ($pdo, $id, $appointment, $original, $delete, $insert): void {
    $delete->execute(['id' => $id]);
    foreach ($original as $row) $insert->execute(['appointment' => $id] + $row);
    $pdo->prepare('UPDATE appointments SET price_dzd = :price WHERE id = :id')
        ->execute(['price' => $appointment['price_dzd'], 'id' => $id]);
};
$sale = [
    'action' => 'record', 'appointmentId' => $id,
    'requestKey' => 'f2a64b39-9d0c-46c9-8aa1-000000000001', 'paymentMethod' => 'cash',
    'lines' => [['kind' => 'service', 'id' => (int) $original[0]['service_id'],
        'quantity' => 1, 'expectedPrice' => (int) $original[0]['price_dzd']]],
];
try {
    $delete->execute(['id' => $id]);
    [$status, $agenda] = $request($agendaPath);
    $items = array_values(array_filter($agenda['appointments'], static fn(array $item): bool => $item['id'] === $id));
    $check($status === 200 && count($items) === 1 && $items[0]['services'] === [], 'Missing services were fabricated by the agenda API.');
    [$status, $response] = $request('professional-cash.php', $sale, $token);
    $check($status === 409 && str_contains($response['error'], 'détail des prestations'), 'Checkout accepted missing service details.');

    $insert->execute(['appointment' => $id] + $original[0]);
    $pdo->prepare('UPDATE appointments SET price_dzd = :price WHERE id = :id')
        ->execute(['price' => $original[0]['price_dzd'], 'id' => $id]);
    [$status, $response] = $request('professional-cash.php', $sale, $token);
    $check($status === 409 && str_contains($response['error'], 'détail des prestations'), 'Checkout accepted a partial breakdown with a matching total.');
    echo "Missing and incomplete appointment details are rejected by agenda and checkout.\n";
} finally {
    $restore();
}

$mark = ['action' => 'no_show', 'appointmentId' => $id, 'expectedVersion' => (int) $appointment['notification_version']];
[$status] = $request('appointments.php', $mark, $token);
$check($status === 409, 'A future appointment accepted a non-presentation mark.');
$past = bookili_now()->modify('-1 day');
$date = $past->format('Y-m-d');
$changeDate = $pdo->prepare('UPDATE appointments SET starts_at = :start, ends_at = :end WHERE id = :id');
$countNotifications = $pdo->prepare('SELECT COUNT(*) FROM notification_outbox WHERE appointment_id = :id');
$countNotifications->execute(['id' => $id]);
$notifications = (int) $countNotifications->fetchColumn();
try {
    $changeDate->execute(['start' => "$date 09:00:00", 'end' => "$date 10:15:00", 'id' => $id]);
    [$status] = $request('appointments.php', $mark, $token);
    $check($status === 200, 'Could not mark an ended appointment as not presented.');
    [$status, $agenda] = $request("professional-agenda.php?date=$date");
    $items = array_values(array_filter($agenda['appointments'], static fn(array $item): bool => $item['id'] === $id));
    $check($status === 200 && count($items) === 1 && $items[0]['status'] === 'no_show', 'The mark is not present in the agenda.');
    [$status] = $request('professional-cash.php', $sale, $token);
    $check($status === 409, 'A non-presented appointment was accepted at checkout.');
    $scope = $appointment['staff_id'] ?? 'unassigned';
    $period = "&from=$date&to=$date&staff=$scope";
    [$status, $report] = $request('professional-cash.php?view=statistics' . $period);
    $check($status === 200 && $report['no_show_count'] === 1, 'The correct appointment date and staff did not include the mark.');
    [$status, $csv] = $request('professional-cash.php?view=statistics-csv' . $period, null, '', true);
    $check($status === 200 && str_contains($csv, '"Rendez-vous non présentés";1'), 'The CSV does not include the count.');
    $today = bookili_now()->format('Y-m-d');
    [$status, $report] = $request("professional-cash.php?view=statistics&from=$today&to=$today");
    $check($status === 200 && $report['no_show_count'] === 0, 'Mark counted by its recording date instead of the appointment date.');
    $undo = ['action' => 'undo_no_show'] + $mark;
    [$status, $response] = $request('appointments.php', $undo, $token);
    $check($status === 409 && $response['code'] === 'appointment_changed', 'A stale correction was accepted.');
    $undo['expectedVersion'] = $items[0]['version'];
    [$status] = $request('appointments.php', $undo, $token);
    $check($status === 200, 'Could not correct the status.');
    [$status, $report] = $request('professional-cash.php?view=statistics' . $period);
    $check($status === 200 && $report['no_show_count'] === 0, 'The corrected mark was kept in the report.');
    $countNotifications->execute(['id' => $id]);
    $check((int) $countNotifications->fetchColumn() === $notifications, 'Marking the appointment or correcting it queued a notification.');
    echo "Non-presentation, correction, checkout and statistics checks passed.\n";
} finally {
    $pdo->prepare("UPDATE appointments SET starts_at = :start, ends_at = :end, status = 'confirmed', no_show_at = NULL, notification_version = :version WHERE id = :id")
        ->execute(['start' => $appointment['starts_at'], 'end' => $appointment['ends_at'], 'version' => $appointment['notification_version'], 'id' => $id]);
    curl_close($curl);
}
