<?php
declare(strict_types=1);

function verify(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

$configPath = tempnam(sys_get_temp_dir(), 'bookili-mail-test-');
if ($configPath === false) throw new RuntimeException('Unable to create test configuration.');
file_put_contents($configPath, "<?php return ['mail_from_name' => 'BOOKILI'];");
putenv('BOOKILI_CONFIG_PATH=' . $configPath);
require_once __DIR__ . '/../public/api/booking.php';
require_once __DIR__ . '/../public/api/mailer.php';

try {
    $appointment = [
        'id' => 55, 'salon_id' => 3, 'starts_at' => '2026-11-19 10:30:00',
        'ends_at' => '2026-11-19 11:00:00', 'service_name' => 'Coupe, couleur',
        'price_dzd' => 1000, 'salon_name' => 'Salon; zen', 'address' => '10 rue de l',
        'city' => 'Sétif', 'staff_name' => 'Sonia',
    ];
    $calendar = bookili_appointment_calendar_event($appointment);
    $unfolded = preg_replace("/\r\n[ \t]/", '', $calendar);
    verify(is_string($unfolded), 'Unable to unfold the calendar event.');
    verify(str_contains($unfolded, "DTSTART:20261119T093000Z\r\n"), 'Unexpected calendar start time.');
    verify(str_contains($unfolded, "DTEND:20261119T100000Z\r\n"), 'Unexpected calendar end time.');
    verify(str_contains($unfolded, "SUMMARY:Coupe\\, couleur - Salon\\; zen\r\n"), 'Calendar summary is not escaped.');
    verify(str_contains($unfolded, "LOCATION:10 rue de l\\, Sétif\r\n"), 'Calendar location is not escaped.');
    verify(str_contains($unfolded, "METHOD:PUBLISH\r\n"), 'Calendar publish method is missing.');
    verify(str_contains($unfolded, "Collaborateur : Sonia"), 'Calendar collaborator is missing.');
    verify(str_contains($unfolded, "Tarif : 1 000 DA\\, paiement sur place"), 'Calendar price is missing.');
    verify(count(array_filter(explode("\r\n", $calendar), static fn(string $line): bool => strlen($line) > 75)) === 0, 'Calendar line exceeds the iCalendar limit.');

    $appointment['service_name'] = 'Coupe + Soin';
    $appointment['ends_at'] = '2026-11-19 11:45:00';
    $appointment['price_dzd'] = 2500;
    $appointment['services'] = [
        ['service_name' => 'Coupe', 'duration_minutes' => 30, 'price_dzd' => 1000],
        ['service_name' => 'Soin', 'duration_minutes' => 45, 'price_dzd' => 1500],
    ];
    $details = bookili_notification_service_details($appointment);
    verify(str_contains($details, "- Coupe : 30 min, 1 000 DA\n- Soin : 45 min, 1 500 DA"), 'Service details are missing or incorrectly ordered.');
    $appointment['services'][1]['price_dzd'] = 1400;
    $details = bookili_notification_service_details($appointment);
    verify(str_contains($details, 'détail des prestations est indisponible') && !str_contains($details, '- Coupe'), 'Inconsistent details were presented as valid.');
    $appointment['services'] = [];
    verify(bookili_notification_service_details($appointment) === '', 'Legacy appointments should retain their aggregate summary.');
    $appointment['service_name'] = 'Coupe';
    $appointment['ends_at'] = '2026-11-19 11:00:00';
    $appointment['price_dzd'] = 1000;
    $appointment['services'] = [['service_name' => 'Coupe', 'duration_minutes' => 30, 'price_dzd' => 1000]];
    verify(bookili_notification_service_details($appointment) === '', 'Single-service messages should retain their existing format.');

    $email = [
        'recipient' => 'client@example.test',
        'subject' => 'Votre rendez-vous BOOKILI est confirmé',
        'message_body' => 'Bonjour Client, votre rendez-vous est confirmé.',
        'calendar_attachment' => $calendar,
    ];
    $prepared = bookili_prepare_email($email, 'noreply@example.test');
    $headers = implode("\r\n", $prepared['headers']);
    verify(preg_match('/Content-Type: multipart\/mixed; boundary="([^"]+)"/', $headers, $match) === 1, 'Multipart email boundary is missing.');
    $boundary = preg_quote($match[1], '/');
    verify(preg_match(
        '/Content-Type: text\/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+\/=\r\n]+)\r\n--' . $boundary . '/s',
        $prepared['body'],
        $plainMatch
    ) === 1, 'Multipart email body is missing.');
    verify(base64_decode($plainMatch[1], true) === $email['message_body'], 'Multipart email body did not decode.');
    verify(preg_match(
        '/Content-Type: text\/calendar; charset=UTF-8; method=PUBLISH; name="BOOKILI-rendez-vous\.ics"\r\n'
        . 'Content-Transfer-Encoding: base64\r\nContent-Disposition: attachment; filename="BOOKILI-rendez-vous\.ics"\r\n\r\n'
        . '([A-Za-z0-9+\/=\r\n]+)\r\n--' . $boundary . "--\r\n$/s",
        $prepared['body'],
        $calendarMatch
    ) === 1, 'Calendar MIME attachment is missing.');
    verify(base64_decode($calendarMatch[1], true) === $calendar, 'Calendar attachment did not decode.');

    $plain = bookili_prepare_email(array_diff_key($email, ['calendar_attachment' => true]), 'noreply@example.test');
    verify(in_array('Content-Type: text/plain; charset=UTF-8', $plain['headers'], true), 'Plain email content type changed.');
    verify($plain['body'] === $email['message_body'], 'Plain email body changed.');
    echo "Notification calendar attachment checks passed.\n";
} finally {
    unlink($configPath);
    putenv('BOOKILI_CONFIG_PATH');
}
