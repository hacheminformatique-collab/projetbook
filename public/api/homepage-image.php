<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

bookili_require_method('GET');

try {
    $pdo = bookili_database();
    $statement = $pdo->query('SELECT mime_type, image_data FROM homepage_image WHERE id = 1');
    $image = $statement->fetch();
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    if (!$image) {
        http_response_code(204);
        exit;
    }

    if (!in_array($image['mime_type'], ['image/jpeg', 'image/png', 'image/webp'], true)) {
        throw new RuntimeException('Unexpected homepage image type.');
    }
    header('Content-Type: ' . $image['mime_type']);
    echo $image['image_data'];
} catch (Throwable $error) {
    bookili_database_error($error);
}
