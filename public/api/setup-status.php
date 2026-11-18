<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

bookili_require_method('GET');

try {
    $config = bookili_configuration();
    $setupToken = $config['setup_token'] ?? '';
    $tokenConfigured = is_string($setupToken) && strlen($setupToken) >= 64;

    $pdo = bookili_database();
    $statement = $pdo->query(
        'SELECT super_admin_created FROM platform_setup WHERE id = 1 LIMIT 1'
    );
    $setupRow = $statement->fetch();
    if (!$setupRow) {
        throw new RuntimeException('BOOKILI platform setup row is missing.');
    }

    bookili_json_response(200, [
        'setupRequired' => !(bool) $setupRow['super_admin_created'],
        'setupAvailable' => $tokenConfigured && !(bool) $setupRow['super_admin_created'],
    ]);
} catch (Throwable $error) {
    bookili_database_error($error);
}
