<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

bookili_require_method('POST');
bookili_require_csrf();
$data = bookili_read_json();
$currentPassword = $data['currentPassword'] ?? null;
$newPassword = bookili_valid_password(['password' => $data['newPassword'] ?? null]);
$confirmation = $data['confirmPassword'] ?? null;

if (!is_string($currentPassword) || $currentPassword === '' || strlen($currentPassword) > 128) {
    bookili_json_response(422, ['error' => 'Veuillez saisir votre mot de passe actuel.']);
}
if (strlen($newPassword) > 72) {
    bookili_json_response(422, ['error' => 'Le nouveau mot de passe ne doit pas dépasser 72 octets.']);
}
if (!is_string($confirmation) || $newPassword !== $confirmation) {
    bookili_json_response(422, ['error' => 'La confirmation ne correspond pas au nouveau mot de passe.']);
}

try {
    $pdo = bookili_database();
    $account = bookili_require_role($pdo, ['client']);
    bookili_rate_limit($pdo, 'client-password', 10);

    $statement = $pdo->prepare('SELECT password_hash FROM accounts WHERE id = :id');
    $statement->execute(['id' => $account['id']]);
    $passwordHash = $statement->fetchColumn();
    if (!is_string($passwordHash)) {
        throw new RuntimeException('Client account is missing.');
    }
    if (!password_verify($currentPassword, $passwordHash)) {
        bookili_json_response(403, ['error' => 'Le mot de passe actuel est incorrect.']);
    }
    if (password_verify($newPassword, $passwordHash)) {
        bookili_json_response(422, ['error' => 'Choisissez un mot de passe différent du mot de passe actuel.']);
    }

    $newHash = password_hash($newPassword, PASSWORD_DEFAULT);
    $statement = $pdo->prepare(
        "UPDATE accounts SET password_hash = :new_hash, session_version = session_version + 1
         WHERE id = :id AND BINARY password_hash = BINARY :old_hash AND session_version = :version
           AND role = 'client' AND status = 'active'"
    );
    $statement->execute(['new_hash' => $newHash, 'id' => $account['id'], 'old_hash' => $passwordHash, 'version' => $account['session_version']]);
    if ($statement->rowCount() !== 1) {
        bookili_json_response(409, ['error' => 'Votre compte a été modifié. Reconnectez-vous et réessayez.']);
    }

    $_SESSION['session_version'] = (int) $account['session_version'] + 1;
    bookili_json_response(200, ['message' => 'Votre mot de passe a été modifié.']);
} catch (Throwable $error) {
    bookili_database_error($error);
}
