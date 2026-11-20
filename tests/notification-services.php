<?php
declare(strict_types=1);

// Run after professional-agenda.py, using the same disposable database.
require_once __DIR__ . '/../public/api/booking.php';

$pdo = bookili_database();
$rows = $pdo->query(
    "SELECT n.kind, n.message_body FROM notification_outbox n
     INNER JOIN appointments a ON a.id = n.appointment_id
     WHERE a.service_name = 'Coupe + Soin'
     ORDER BY n.id"
)->fetchAll();
$seen = [];
foreach ($rows as $row) {
    if (!str_contains($row['message_body'], "- Coupe : 30 min, 1 500 DA\n- Soin : 45 min, 2 000 DA")) {
        throw new RuntimeException('Missing saved service details in ' . $row['kind']);
    }
    if ($row['kind'] === 'cancelled' && str_contains($row['message_body'], 'Prix à régler')) {
        throw new RuntimeException('A cancelled appointment must not request payment.');
    }
    $seen[$row['kind']] = true;
}
foreach (['confirmation', 'rescheduled', 'cancelled', 'reminder_7d', 'reminder_1d'] as $kind) {
    if (!isset($seen[$kind])) throw new RuntimeException('Missing notification kind: ' . $kind);
}
echo "Saved service details in appointment notifications passed.\n";
