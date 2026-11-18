<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

bookili_require_method('POST');
bookili_require_csrf();
$data = bookili_read_json();
$email = bookili_normalize_email($data);
$password = $data['password'] ?? null;

if (!is_string($password) || strlen($password) > 128) {
    bookili_json_response(422, ['error' => 'Veuillez vérifier votre adresse e-mail et votre mot de passe.']);
}

try {
    $pdo = bookili_database();
    bookili_rate_limit($pdo, 'login', 10);
    $statement = $pdo->prepare(
        'SELECT id, email, password_hash, role, status, session_version FROM accounts WHERE email = :email LIMIT 1'
    );
    $statement->execute(['email' => $email]);
    $account = $statement->fetch();

    if (!$account || !password_verify($password, $account['password_hash'])) {
        bookili_json_response(401, ['error' => 'Adresse e-mail ou mot de passe incorrect.']);
    }

    if ($account['status'] === 'pending') {
        bookili_json_response(403, ['code' => 'account_pending', 'error' => 'Votre demande professionnelle est en attente de validation.']);
    }

    if ($account['status'] !== 'active') {
        bookili_json_response(403, ['error' => 'Ce compte ne peut pas être utilisé actuellement.']);
    }

    bookili_start_session();
    if (!session_regenerate_id(true)) {
        throw new RuntimeException('Could not rotate the session identifier.');
    }

    $_SESSION['account_id'] = (int) $account['id'];
    $_SESSION['session_version'] = (int) $account['session_version'];
    $_SESSION['role'] = $account['role'];
    $_SESSION['email'] = $account['email'];
    $_SESSION['csrf_token'] = bin2hex(random_bytes(32));

    bookili_json_response(200, [
        'account' => [
            'email' => $account['email'],
            'role' => $account['role'],
        ],
        'csrfToken' => $_SESSION['csrf_token'],
    ]);
} catch (Throwable $error) {
    bookili_database_error($error);
}
