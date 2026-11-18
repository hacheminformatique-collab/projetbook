<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

bookili_require_method('GET');

try {
    bookili_start_session();
    if (!isset($_SESSION['account_id'], $_SESSION['role'], $_SESSION['email'])) {
        bookili_json_response(200, ['authenticated' => false, 'csrfToken' => $_SESSION['csrf_token'] ?? null]);
    }

    bookili_json_response(200, [
        'authenticated' => true,
        'csrfToken' => $_SESSION['csrf_token'] ?? null,
        'account' => [
            'email' => $_SESSION['email'],
            'role' => $_SESSION['role'],
        ],
    ]);
} catch (Throwable $error) {
    bookili_database_error($error);
}
