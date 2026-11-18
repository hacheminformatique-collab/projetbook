<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

bookili_require_method('POST');
bookili_require_csrf();
$data = bookili_read_json();

$setupToken = $data['setupToken'] ?? null;
$email = bookili_normalize_email($data);
$password = bookili_valid_password($data);
if (!is_string($setupToken) || strlen($setupToken) < 64 || strlen($setupToken) > 256) {
    bookili_json_response(403, ['error' => 'La clé de configuration est invalide.']);
}

try {
    $config = bookili_configuration();
    $configuredToken = $config['setup_token'] ?? '';
    if (!is_string($configuredToken) || strlen($configuredToken) < 64) {
        bookili_json_response(403, ['error' => 'La configuration initiale est désactivée.']);
    }

    $pdo = bookili_database();
    bookili_rate_limit($pdo, 'setup-admin', 5);
    if (
        !hash_equals($configuredToken, $setupToken)
    ) {
        bookili_json_response(403, ['error' => 'La clé de configuration est invalide.']);
    }

    $pdo->beginTransaction();

    $statement = $pdo->prepare(
        'SELECT super_admin_created FROM platform_setup WHERE id = 1 FOR UPDATE'
    );
    $statement->execute();
    $setupRow = $statement->fetch();
    if (!$setupRow || (bool) $setupRow['super_admin_created']) {
        $pdo->rollBack();
        bookili_json_response(410, ['error' => 'Le compte super-admin a déjà été configuré.']);
    }

    $statement = $pdo->prepare(
        "INSERT INTO accounts (email, password_hash, role, status)
         VALUES (:email, :password_hash, 'super_admin', 'active')"
    );
    $statement->execute([
        'email' => $email,
        'password_hash' => password_hash($password, PASSWORD_DEFAULT),
    ]);

    $statement = $pdo->prepare(
        'UPDATE platform_setup SET super_admin_created = TRUE WHERE id = 1'
    );
    $statement->execute();
    $pdo->commit();

    bookili_json_response(201, ['message' => 'Le compte super-admin est créé. Vous pouvez maintenant vous connecter.']);
} catch (PDOException $error) {
    if (isset($pdo) && $pdo->inTransaction()) {
        $pdo->rollBack();
    }
    if ($error->getCode() === '23000') {
        bookili_json_response(409, ['error' => 'Un compte existe déjà avec cette adresse e-mail.']);
    }
    bookili_database_error($error);
} catch (Throwable $error) {
    if (isset($pdo) && $pdo->inTransaction()) {
        $pdo->rollBack();
    }
    bookili_database_error($error);
}
