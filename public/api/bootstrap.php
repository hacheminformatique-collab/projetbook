<?php
declare(strict_types=1);

require_once __DIR__ . '/database.php';

function bookili_json_response(int $status, array $body): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function bookili_require_method(string $method): void
{
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== $method) {
        header('Allow: ' . $method);
        bookili_json_response(405, ['error' => 'Méthode non autorisée.']);
    }
}

function bookili_start_session(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }

    ini_set('session.use_strict_mode', '1');
    ini_set('session.use_only_cookies', '1');
    ini_set('session.cookie_httponly', '1');
    ini_set('session.cookie_samesite', 'Strict');

    session_name('BOOKILI_SESSION');
    session_set_cookie_params([
        'lifetime' => 0,
        'path' => '/',
        'secure' => isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off',
        'httponly' => true,
        'samesite' => 'Strict',
    ]);

    if (!session_start()) {
        throw new RuntimeException('Could not start the session.');
    }
}

function bookili_require_csrf(): void
{
    bookili_start_session();
    $provided = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
    $expected = $_SESSION['csrf_token'] ?? '';

    if (
        !is_string($provided)
        || !is_string($expected)
        || $provided === ''
        || !hash_equals($expected, $provided)
    ) {
        bookili_json_response(403, ['error' => 'La session du formulaire a expiré. Rechargez la page.']);
    }
}

function bookili_read_json(): array
{
    $contentType = strtolower(trim(explode(';', $_SERVER['CONTENT_TYPE'] ?? '')[0]));
    if ($contentType !== 'application/json') {
        bookili_json_response(415, ['error' => 'Le format JSON est requis.']);
    }

    $raw = file_get_contents('php://input', false, null, 0, 16385);
    if ($raw === false || strlen($raw) > 16384) {
        bookili_json_response(413, ['error' => 'Le formulaire est trop volumineux.']);
    }

    try {
        $data = json_decode($raw, true, 16, JSON_THROW_ON_ERROR);
    } catch (JsonException) {
        bookili_json_response(400, ['error' => 'Le formulaire contient des données invalides.']);
    }

    if (!is_array($data) || array_is_list($data)) {
        bookili_json_response(400, ['error' => 'Le formulaire contient des données invalides.']);
    }

    return $data;
}

function bookili_required_text(array $data, string $key, int $maxBytes): string
{
    $value = $data[$key] ?? null;
    if (!is_string($value)) {
        bookili_json_response(422, ['error' => 'Veuillez vérifier les champs du formulaire.']);
    }

    $value = trim($value);
    if ($value === '' || strlen($value) > $maxBytes || str_contains($value, "\0")) {
        bookili_json_response(422, ['error' => 'Veuillez vérifier les champs du formulaire.']);
    }

    return $value;
}

function bookili_valid_phone(string $phone): bool
{
    return preg_match('/^\+?[0-9\s().-]{8,24}$/', $phone) === 1;
}

function bookili_valid_password(array $data): string
{
    $password = $data['password'] ?? null;
    if (
        !is_string($password)
        || strlen($password) < 12
        || strlen($password) > 128
        || str_contains($password, "\0")
    ) {
        bookili_json_response(422, ['error' => 'Le mot de passe doit contenir entre 12 et 128 caractères.']);
    }

    return $password;
}

function bookili_rate_limit(PDO $pdo, string $action, int $limit = 8): void
{
    $remoteAddress = $_SERVER['REMOTE_ADDR'] ?? '';
    if (!is_string($remoteAddress) || $remoteAddress === '') {
        bookili_json_response(400, ['error' => 'La requête ne peut pas être traitée.']);
    }

    $bucket = intdiv(time(), 3600);
    $ipHash = hash('sha256', $remoteAddress);
    $statement = $pdo->prepare(
        'INSERT INTO registration_rate_limits (action_name, ip_hash, hour_bucket, attempts)
         VALUES (:action, :ip_hash, :hour_bucket, 1)
         ON DUPLICATE KEY UPDATE attempts = attempts + 1'
    );
    $statement->execute([
        'action' => $action,
        'ip_hash' => $ipHash,
        'hour_bucket' => $bucket,
    ]);

    if (random_int(1, 100) === 1) {
        $cleanup = $pdo->prepare(
            'DELETE FROM registration_rate_limits WHERE hour_bucket < :oldest_bucket'
        );
        $cleanup->execute(['oldest_bucket' => max(0, $bucket - 24)]);
    }

    $statement = $pdo->prepare(
        'SELECT attempts FROM registration_rate_limits
         WHERE action_name = :action AND ip_hash = :ip_hash AND hour_bucket = :hour_bucket'
    );
    $statement->execute([
        'action' => $action,
        'ip_hash' => $ipHash,
        'hour_bucket' => $bucket,
    ]);

    if ((int) $statement->fetchColumn() > $limit) {
        header('Retry-After: ' . (3600 - (time() % 3600)));
        bookili_json_response(429, ['error' => 'Trop de tentatives. Réessayez plus tard.']);
    }
}

function bookili_normalize_email(array $data): string
{
    $email = $data['email'] ?? null;
    if (
        !is_string($email)
        || strlen($email) > 254
        || filter_var($email, FILTER_VALIDATE_EMAIL) === false
    ) {
        bookili_json_response(422, ['error' => 'Veuillez saisir une adresse e-mail valide.']);
    }

    return strtolower($email);
}

function bookili_database_error(Throwable $error): never
{
    error_log('BOOKILI API error: ' . $error->getMessage());
    bookili_json_response(503, ['error' => 'Le service est temporairement indisponible. Réessayez plus tard.']);
}
