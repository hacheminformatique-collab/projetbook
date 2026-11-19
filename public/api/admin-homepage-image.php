<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/image-upload.php';

$method = $_SERVER['REQUEST_METHOD'] ?? '';
if (!in_array($method, ['GET', 'POST'], true)) {
    header('Allow: GET, POST');
    bookili_json_response(405, ['error' => 'Méthode non autorisée.']);
}
if ($method === 'POST') {
    bookili_require_csrf();
}

try {
    $pdo = bookili_database();
    bookili_require_role($pdo, ['super_admin']);

    if ($method === 'GET') {
        $statement = $pdo->query('SELECT updated_at FROM homepage_image WHERE id = 1');
        $image = $statement->fetch();
        bookili_json_response(200, ['hasImage' => (bool) $image]);
    }

    $action = $_POST['action'] ?? '';
    if ($action === 'remove') {
        $pdo->exec('DELETE FROM homepage_image WHERE id = 1');
        bookili_json_response(200, ['hasImage' => false, 'message' => 'Le fond gris a été rétabli.']);
    }
    if ($action !== 'upload') {
        bookili_json_response(422, ['error' => 'Action invalide ou fichier trop volumineux.']);
    }

    $image = bookili_process_image_upload($_FILES['image'] ?? null);

    $statement = $pdo->prepare(
        'INSERT INTO homepage_image (id, mime_type, image_data)
         VALUES (1, :mime_type, :image_data)
         ON DUPLICATE KEY UPDATE mime_type = VALUES(mime_type), image_data = VALUES(image_data)'
    );
    $statement->bindValue(':mime_type', $image['mime_type']);
    $statement->bindValue(':image_data', $image['image_data'], PDO::PARAM_LOB);
    $statement->execute();
    bookili_json_response(200, ['hasImage' => true, 'message' => 'L’image de la page d’accueil a été enregistrée.']);
} catch (Throwable $error) {
    bookili_database_error($error);
}
