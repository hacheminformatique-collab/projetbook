<?php
declare(strict_types=1);
require_once __DIR__ . '/booking.php';
require_once __DIR__ . '/image-upload.php';

$method = $_SERVER['REQUEST_METHOD'] ?? '';
if (!in_array($method, ['GET', 'POST'], true)) {
    header('Allow: GET, POST');
    bookili_json_response(405, ['error' => 'Méthode non autorisée.']);
}
if ($method === 'POST') {
    bookili_require_csrf();
    $contentType = $_SERVER['CONTENT_TYPE'] ?? '';
    $data = str_starts_with(strtolower($contentType), 'multipart/form-data')
        ? $_POST
        : bookili_read_json();
} else {
    $data = [];
}

try {
    $pdo = bookili_database();
    $account = bookili_require_role($pdo, ['professional']);
    $salon = bookili_own_salon($pdo, (int) $account['id']);
    if ($method === 'POST') {
        $action = $data['action'] ?? '';
        if ($action === 'upload') {
            $image = bookili_process_image_upload($_FILES['photo'] ?? null);
            $pdo->beginTransaction();
            $salon = bookili_own_salon($pdo, (int) $account['id'], true);
            $statement = $pdo->prepare('SELECT COUNT(*) FROM salon_photos WHERE salon_id = :salon_id');
            $statement->execute(['salon_id' => $salon['id']]);
            if ((int) $statement->fetchColumn() >= 4) {
                $pdo->rollBack();
                bookili_json_response(422, ['error' => 'Vous pouvez importer au maximum quatre photos. Supprimez une photo pour libérer un emplacement.']);
            }
            $statement = $pdo->prepare('SELECT COALESCE(MAX(position), 0) + 1 FROM salon_photos WHERE salon_id = :salon_id');
            $statement->execute(['salon_id' => $salon['id']]);
            $position = (int) $statement->fetchColumn();
            $statement = $pdo->prepare(
                "INSERT INTO salon_photos (salon_id, mime_type, image_data, position, status)
                 VALUES (:salon_id, :mime_type, :image_data, :position, 'pending')"
            );
            $statement->bindValue(':salon_id', (int) $salon['id'], PDO::PARAM_INT);
            $statement->bindValue(':mime_type', $image['mime_type']);
            $statement->bindValue(':image_data', $image['image_data'], PDO::PARAM_LOB);
            $statement->bindValue(':position', $position, PDO::PARAM_INT);
            $statement->execute();
            $pdo->commit();
        } elseif ($action === 'delete') {
            $photoId = bookili_id($data['photoId'] ?? null);
            $pdo->beginTransaction();
            $salon = bookili_own_salon($pdo, (int) $account['id'], true);
            $statement = $pdo->prepare('DELETE FROM salon_photos WHERE id = :id AND salon_id = :salon_id');
            $statement->execute(['id' => $photoId, 'salon_id' => $salon['id']]);
            if ($statement->rowCount() !== 1) {
                $pdo->rollBack();
                bookili_json_response(404, ['error' => 'Cette photo est introuvable.']);
            }
            $statement = $pdo->prepare('SELECT id FROM salon_photos WHERE salon_id = :salon_id ORDER BY position, id');
            $statement->execute(['salon_id' => $salon['id']]);
            $position = $pdo->prepare('UPDATE salon_photos SET position = :position WHERE id = :id AND salon_id = :salon_id');
            foreach ($statement->fetchAll(PDO::FETCH_COLUMN) as $index => $id) {
                $position->execute(['position' => $index + 1, 'id' => $id, 'salon_id' => $salon['id']]);
            }
            $pdo->commit();
        } elseif ($action === 'reorder') {
            $photoIds = $data['photoIds'] ?? null;
            if (!is_array($photoIds) || !array_is_list($photoIds) || count($photoIds) > 4) {
                bookili_json_response(422, ['error' => 'L’ordre des photos est invalide.']);
            }
            $photoIds = array_map('bookili_id', $photoIds);
            if (count(array_unique($photoIds)) !== count($photoIds)) {
                bookili_json_response(422, ['error' => 'Une photo ne peut apparaître qu’une fois dans l’ordre.']);
            }
            $pdo->beginTransaction();
            $salon = bookili_own_salon($pdo, (int) $account['id'], true);
            $statement = $pdo->prepare(
                "SELECT id FROM salon_photos WHERE salon_id = :salon_id AND status != 'rejected' ORDER BY position, id"
            );
            $statement->execute(['salon_id' => $salon['id']]);
            $existingIds = array_map('intval', $statement->fetchAll(PDO::FETCH_COLUMN));
            $submittedIds = $photoIds;
            sort($submittedIds);
            sort($existingIds);
            if ($submittedIds !== $existingIds) {
                $pdo->rollBack();
                bookili_json_response(422, ['error' => 'Actualisez la galerie avant de modifier l’ordre des photos.']);
            }
            $statement = $pdo->prepare('UPDATE salon_photos SET position = :position WHERE id = :id AND salon_id = :salon_id');
            foreach ($photoIds as $index => $id) {
                $statement->execute(['position' => $index + 1, 'id' => $id, 'salon_id' => $salon['id']]);
            }
            $pdo->commit();
        } else {
            bookili_json_response(422, ['error' => 'Action photo invalide.']);
        }
    }

    $salon = bookili_own_salon($pdo, (int) $account['id']);
    $statement = $pdo->prepare(
        'SELECT id, mime_type, position, status, created_at
         FROM salon_photos WHERE salon_id = :salon_id ORDER BY position, id'
    );
    $statement->execute(['salon_id' => $salon['id']]);
    bookili_json_response(200, ['photos' => $statement->fetchAll()]);
} catch (Throwable $error) {
    if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
    bookili_database_error($error);
}
