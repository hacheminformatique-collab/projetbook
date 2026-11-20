<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

bookili_require_method('GET');

try {
    bookili_start_session();
    $account = isset($_SESSION['account_id']) ? bookili_session_account(bookili_database()) : null;
    if (!$account) {
        bookili_json_response(200, ['authenticated' => false, 'csrfToken' => $_SESSION['csrf_token'] ?? null]);
    }

    bookili_json_response(200, [
        'authenticated' => true,
        'csrfToken' => $_SESSION['csrf_token'] ?? null,
        'account' => [
            'id' => (string) $account['id'],
            'email' => $account['email'],
            'role' => $account['role'],
        ],
    ]);
} catch (Throwable $error) {
    bookili_database_error($error);
}
