<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/mailer.php';

bookili_require_method('POST');
bookili_require_csrf();
$data = bookili_read_json();

function bookili_reset_request_accepted(): never
{
    bookili_json_response(200, ['message' => 'Si un compte éligible correspond à cette adresse, vous recevrez un lien de réinitialisation. Vérifiez aussi vos courriers indésirables.']);
}

function bookili_invalid_reset_link(): never
{
    bookili_json_response(422, ['error' => 'Ce lien est invalide, expiré ou déjà utilisé. Demandez un nouveau lien.']);
}

try {
    $pdo = bookili_database();
    if (($data['action'] ?? null) === 'request') {
        $email = bookili_normalize_email($data);
        bookili_rate_limit($pdo, 'password-reset-request', 8);
        $configuration = bookili_configuration();
        $url = $configuration['public_url'] ?? '';
        $parts = is_string($url) && filter_var($url, FILTER_VALIDATE_URL) ? parse_url($url) : false;
        $sender = $configuration['mail_from'] ?? '';
        if (!$parts || ($parts['scheme'] ?? '') !== 'https'
            || isset($parts['query']) || isset($parts['fragment']) || isset($parts['user']) || isset($parts['pass'])
            || !is_string($sender) || !filter_var($sender, FILTER_VALIDATE_EMAIL)
            || preg_match('/[\r\n\x00-\x20\x7f]/', $sender)) {
            bookili_json_response(503, ['error' => 'La récupération par e-mail n’est pas encore configurée.']);
        }

        $pdo->beginTransaction();
        $statement = $pdo->prepare(
            "SELECT id, role, email, session_version FROM accounts
             WHERE email = :email AND role IN ('client', 'professional') AND status = 'active' FOR UPDATE"
        );
        $statement->execute(['email' => $email]);
        $account = $statement->fetch();
        if (!$account) {
            $pdo->rollBack();
            bookili_reset_request_accepted();
        }
        $statement = $pdo->prepare(
            'SELECT 1 FROM password_resets WHERE account_id = :id AND session_version = :version
             AND expires_at > UTC_TIMESTAMP() + INTERVAL 25 MINUTE'
        );
        $statement->execute(['id' => $account['id'], 'version' => $account['session_version']]);
        if ($statement->fetchColumn()) {
            $pdo->rollBack();
            bookili_reset_request_accepted();
        }
        $token = bin2hex(random_bytes(32));
        $hash = hash('sha256', $token);
        $pdo->prepare(
            'INSERT INTO password_resets (account_id, token_hash, session_version, expires_at)
             VALUES (:id, :hash, :version, UTC_TIMESTAMP() + INTERVAL 30 MINUTE)
             ON DUPLICATE KEY UPDATE token_hash = VALUES(token_hash), session_version = VALUES(session_version),
                 expires_at = VALUES(expires_at)'
        )->execute(['id' => $account['id'], 'hash' => $hash, 'version' => $account['session_version']]);
        $pdo->commit();

        $portal = $account['role'] === 'professional' ? 'professionnels' : 'compte';
        $link = rtrim($url, '/') . '/nouveau-mot-de-passe#token=' . $token . '&espace=' . $portal;
        try {
            bookili_send_email([
                'recipient' => $account['email'],
                'subject' => 'Réinitialisez votre mot de passe BOOKILI',
                'message_body' => "Ce lien permet de choisir un nouveau mot de passe BOOKILI pendant 30 minutes :\n\n"
                    . "$link\n\nSi vous n’avez pas demandé ce changement, ignorez cet e-mail.",
            ], $sender);
        } catch (Throwable $mailError) {
            error_log('BOOKILI password reset delivery failed: ' . $mailError->getMessage());
            try {
                $pdo->prepare('DELETE FROM password_resets WHERE account_id = :id AND token_hash = :hash')
                    ->execute(['id' => $account['id'], 'hash' => $hash]);
            } catch (PDOException $cleanupError) {
                error_log('BOOKILI password reset cleanup failed: ' . $cleanupError->getMessage());
            }
        }
        bookili_reset_request_accepted();
    }

    if (($data['action'] ?? null) !== 'reset') {
        bookili_json_response(422, ['error' => 'Action de réinitialisation invalide.']);
    }
    bookili_rate_limit($pdo, 'password-reset-confirm', 15);
    $token = $data['token'] ?? null;
    if (!is_string($token) || !preg_match('/^[a-f0-9]{64}$/D', $token)) bookili_invalid_reset_link();
    $password = bookili_valid_password($data);
    if (strlen($password) > 72) {
        bookili_json_response(422, ['error' => 'Le mot de passe ne doit pas dépasser 72 octets.']);
    }
    if ($password !== ($data['confirmPassword'] ?? null)) {
        bookili_json_response(422, ['error' => 'La confirmation ne correspond pas au nouveau mot de passe.']);
    }
    $hash = hash('sha256', $token);
    $statement = $pdo->prepare('SELECT account_id FROM password_resets WHERE token_hash = :hash AND expires_at > UTC_TIMESTAMP()');
    $statement->execute(['hash' => $hash]);
    $accountId = $statement->fetchColumn();
    if (!$accountId) bookili_invalid_reset_link();
    $newHash = password_hash($password, PASSWORD_DEFAULT);

    $pdo->beginTransaction();
    $statement = $pdo->prepare(
        "SELECT session_version FROM accounts WHERE id = :id AND status = 'active'
         AND role IN ('client', 'professional') FOR UPDATE"
    );
    $statement->execute(['id' => $accountId]);
    $version = $statement->fetchColumn();
    $statement = $pdo->prepare(
        'DELETE FROM password_resets WHERE account_id = :id AND token_hash = :hash
         AND expires_at > UTC_TIMESTAMP() AND session_version = :version'
    );
    if ($version === false) {
        $pdo->rollBack();
        bookili_invalid_reset_link();
    }
    $statement->execute(['id' => $accountId, 'hash' => $hash, 'version' => $version]);
    if ($statement->rowCount() !== 1) {
        $pdo->rollBack();
        bookili_invalid_reset_link();
    }
    $pdo->prepare('UPDATE accounts SET password_hash = :hash, session_version = session_version + 1 WHERE id = :id')
        ->execute(['hash' => $newHash, 'id' => $accountId]);
    $pdo->commit();
    bookili_json_response(200, ['message' => 'Votre mot de passe a été modifié. Reconnectez-vous avec votre nouveau mot de passe.']);
} catch (Throwable $error) {
    if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
    bookili_database_error($error);
}
