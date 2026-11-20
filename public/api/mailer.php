<?php
declare(strict_types=1);

function bookili_prepare_email(array $email, string $sender): array
{
    $fromName = bookili_configuration()['mail_from_name'] ?? 'BOOKILI';
    if (!is_string($fromName) || trim($fromName) === '' || strlen($fromName) > 100
        || preg_match('/[\r\n\x00-\x1f\x7f]/', $fromName)) {
        throw new RuntimeException('The configured sender name is invalid.');
    }
    $headers = [
        'From: =?UTF-8?B?' . base64_encode($fromName) . '?= <' . $sender . '>',
        'MIME-Version: 1.0',
        'X-Mailer: BOOKILI',
    ];
    $subject = '=?UTF-8?B?' . base64_encode($email['subject']) . '?=';
    $calendar = $email['calendar_attachment'] ?? null;
    if ($calendar === null) {
        $headers[] = 'Content-Type: text/plain; charset=UTF-8';
        $headers[] = 'Content-Transfer-Encoding: 8bit';
        $body = $email['message_body'];
    } else {
        if (!is_string($calendar) || $calendar === '') {
            throw new RuntimeException('The calendar attachment is invalid.');
        }
        $boundary = 'BOOKILI-' . bin2hex(random_bytes(16));
        $headers[] = 'Content-Type: multipart/mixed; boundary="' . $boundary . '"';
        $body = '--' . $boundary . "\r\n"
            . "Content-Type: text/plain; charset=UTF-8\r\n"
            . "Content-Transfer-Encoding: base64\r\n\r\n"
            . chunk_split(base64_encode($email['message_body']), 76, "\r\n")
            . '--' . $boundary . "\r\n"
            . "Content-Type: text/calendar; charset=UTF-8; method=PUBLISH; name=\"BOOKILI-rendez-vous.ics\"\r\n"
            . "Content-Transfer-Encoding: base64\r\n"
            . "Content-Disposition: attachment; filename=\"BOOKILI-rendez-vous.ics\"\r\n\r\n"
            . chunk_split(base64_encode($calendar), 76, "\r\n")
            . '--' . $boundary . "--\r\n";
    }

    return ['subject' => $subject, 'headers' => $headers, 'body' => $body];
}

function bookili_send_email(array $email, string $sender): void
{
    $prepared = bookili_prepare_email($email, $sender);
    if (!@mail($email['recipient'], $prepared['subject'], $prepared['body'], implode("\r\n", $prepared['headers']), '-f' . $sender)) {
        throw new RuntimeException('The configured mail transport rejected a message.');
    }
}
