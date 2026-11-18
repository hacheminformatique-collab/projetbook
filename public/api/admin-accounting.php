<?php
declare(strict_types=1);
require_once __DIR__ . '/inventory.php';
bookili_require_method('GET');

try {
    $pdo = bookili_database();
    bookili_require_role($pdo, ['super_admin']);
    $today = bookili_now()->format('Y-m-d');
    $from = bookili_calendar_date($_GET['from'] ?? substr($today, 0, 7) . '-01');
    $to = bookili_calendar_date($_GET['to'] ?? $today);
    if ($to < $from || $to->format('Y-m-d') > $today || $from->diff($to)->days > 365) {
        bookili_json_response(422, ['error' => 'Choisissez une période passée ou en cours de 366 jours maximum.']);
    }
    $start = $from->format('Y-m-d 00:00:00');
    $end = $to->modify('+1 day')->format('Y-m-d 00:00:00');
    $statement = $pdo->prepare(
        "SELECT event_at, source, reference, salon_name, amount_dzd, collected_dzd, gift_card_dzd, payment_method, reason FROM (
           SELECT cs.recorded_at AS event_at, 'Vente salon' AS source, CONCAT('Vente n° ', cs.id) AS reference,
                  sa.name AS salon_name, CAST(cs.total_dzd AS SIGNED) AS amount_dzd,
                  CAST(cs.collected_dzd AS SIGNED) AS collected_dzd,
                  CAST(cs.gift_card_applied_dzd AS SIGNED) AS gift_card_dzd,
                  cs.payment_method, '' AS reason
           FROM cash_sales cs INNER JOIN salons sa ON sa.id = cs.salon_id
           WHERE cs.recorded_at >= :sale_from AND cs.recorded_at < :sale_to
           UNION ALL
           SELECT cs.voided_at, 'Annulation salon', CONCAT('Annulation vente n° ', cs.id),
                  sa.name, -CAST(cs.total_dzd AS SIGNED), -CAST(cs.collected_dzd AS SIGNED),
                  -CAST(cs.gift_card_applied_dzd AS SIGNED), cs.payment_method, cs.void_reason
           FROM cash_sales cs INNER JOIN salons sa ON sa.id = cs.salon_id
           WHERE cs.voided_at >= :void_from AND cs.voided_at < :void_to
           UNION ALL
           SELECT sp.paid_at, 'Abonnement BOOKILI', CONCAT('Règlement n° ', sp.id),
                  a.email, CAST(sp.amount_dzd AS SIGNED), CAST(sp.amount_dzd AS SIGNED), 0,
                  sp.payment_method, sp.reference
           FROM subscription_payments sp
           INNER JOIN professional_subscriptions ps ON ps.id = sp.subscription_id
           INNER JOIN professional_profiles pp ON pp.id = ps.professional_profile_id
           INNER JOIN accounts a ON a.id = pp.account_id
           WHERE sp.paid_at >= :payment_from AND sp.paid_at < :payment_to
         ) AS ledger ORDER BY event_at DESC, reference"
    );
    $statement->execute([
        'sale_from' => $start, 'sale_to' => $end, 'void_from' => $start, 'void_to' => $end,
        'payment_from' => $start, 'payment_to' => $end,
    ]);
    $output = fopen('php://output', 'wb');
    if ($output === false) throw new RuntimeException('Cannot open accounting export output.');
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="bookili-export-comptable.csv"');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    fwrite($output, "\xEF\xBB\xBF");
    fputcsv($output, ['Date (Algérie)', 'Origine', 'Référence', 'Salon / professionnel', 'Montant brut (DA)', 'Encaissé (DA)', 'Carte cadeau (DA)', 'Mode', 'Note'], ';', '"', '');
    while ($row = $statement->fetch()) {
        fputcsv($output, [
            $row['event_at'], $row['source'], bookili_csv_text($row['reference']),
            bookili_csv_text($row['salon_name']), $row['amount_dzd'], $row['collected_dzd'],
            $row['gift_card_dzd'], $row['payment_method'], bookili_csv_text((string) $row['reason']),
        ], ';', '"', '');
    }
    fclose($output);
    exit;
} catch (Throwable $error) {
    bookili_database_error($error);
}
