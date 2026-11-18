<?php
declare(strict_types=1);

function bookili_send_email(array $email, string $sender): void
{
    $fromName = bookili_configuration()['mail_from_name'] ?? 'BOOKILI';
    if (!is_string($fromName) || trim($fromName) === '' || strlen($fromName) > 100
        || preg_match('/[\r\n\x00-\x1f\x7f]/', $fromName)) {
        throw new RuntimeException('The configured sender name is invalid.');
    }

    $headers = [
        'From: =?UTF-8?B?' . base64_encode($fromName) . '?= <' . $sender . '>',
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: 8bit',
        'X-Mailer: BOOKILI',
    ];
    $subject = '=?UTF-8?B?' . base64_encode($email['subject']) . '?=';
    if (!@mail($email['recipient'], $subject, $email['message_body'], implode("\r\n", $headers), '-f' . $sender)) {
        throw new RuntimeException('The configured mail transport rejected a message.');
    }
}
