<?php
declare(strict_types=1);
require_once __DIR__ . '/booking.php';

$method = $_SERVER['REQUEST_METHOD'] ?? '';
if (!in_array($method, ['GET', 'POST'], true)) {
    header('Allow: GET, POST');
    bookili_json_response(405, ['error' => 'Méthode non autorisée.']);
}
if ($method === 'POST') {
    bookili_require_csrf();
    $data = bookili_read_json();
} else {
    $data = [];
}

try {
    $pdo = bookili_database();
    bookili_require_role($pdo, ['super_admin']);
    if ($method === 'POST') {
        $action = $data['action'] ?? '';
        $id = bookili_id($data['id'] ?? null);
        $decisions = [
            'approve-description' => ['description', 'approved'],
            'reject-description' => ['description', 'rejected'],
            'approve-entry' => ['entry', 'approved'],
            'reject-entry' => ['entry', 'rejected'],
            'approve-photo' => ['photo', 'approved'],
            'reject-photo' => ['photo', 'rejected'],
        ];
        if (!is_string($action) || !isset($decisions[$action])) {
            bookili_json_response(422, ['error' => 'Décision de validation invalide.']);
        }
        [$type, $status] = $decisions[$action];
        $compareDescription = $type === 'description' && array_key_exists('expectedDescription', $data);
        if ($type === 'description') {
            $update = $status === 'approved'
                ? "public_description = profile_description, profile_description_status = 'approved'"
                : "profile_description_status = 'rejected'";
            $condition = $compareDescription ? ' AND CAST(profile_description AS BINARY) = CAST(:expected_description AS BINARY)' : '';
            $statement = $pdo->prepare("UPDATE salons SET $update WHERE id = :id AND profile_description_status = 'pending'" . $condition);
            if ($compareDescription) {
                $expected = $data['expectedDescription'];
                if (!is_string($expected) || strlen($expected) > 8000) {
                    bookili_json_response(422, ['error' => 'Le descriptif à comparer est invalide.']);
                }
                $statement->bindValue(':expected_description', $expected);
            }
        } elseif ($type === 'entry') {
            $statement = $pdo->prepare(
                'UPDATE salon_profile_entries SET status = :status WHERE id = :id AND status = \'pending\''
            );
            $statement->bindValue(':status', $status);
        } else {
            $statement = $pdo->prepare(
                'UPDATE salon_photos SET status = :status WHERE id = :id AND status = \'pending\''
            );
            $statement->bindValue(':status', $status);
        }
        $statement->bindValue(':id', $id, PDO::PARAM_INT);
        $statement->execute();
        if ($statement->rowCount() !== 1 && $compareDescription) {
            bookili_json_response(409, ['error' => 'Le descriptif a changé ou a déjà été traité. Vérifiez la file actualisée.']);
        }
        if ($statement->rowCount() !== 1) bookili_json_response(404, ['error' => 'Ce contenu n’est plus en attente de validation.']);
        bookili_json_response(200, ['message' => $status === 'approved' ? 'Le contenu a été publié.' : 'Le contenu a été refusé.']);
    }

    $descriptions = $pdo->query(
        "SELECT s.id, s.name, s.city, s.wilaya_code, s.public_description, s.profile_description, s.updated_at
         FROM salons s WHERE s.profile_description_status = 'pending' ORDER BY s.updated_at, s.id"
    )->fetchAll();
    $entries = $pdo->query(
        "SELECT e.id, e.category, e.title, e.details, e.created_at, s.name AS salon_name, s.city
         FROM salon_profile_entries e
         INNER JOIN salons s ON s.id = e.salon_id
         WHERE e.status = 'pending' ORDER BY e.created_at, e.id"
    )->fetchAll();
    $photos = $pdo->query(
        "SELECT p.id, p.created_at, s.name AS salon_name, s.city
         FROM salon_photos p
         INNER JOIN salons s ON s.id = p.salon_id
         WHERE p.status = 'pending' ORDER BY p.created_at, p.id"
    )->fetchAll();
    bookili_json_response(200, ['descriptions' => $descriptions, 'entries' => $entries, 'photos' => $photos]);
} catch (Throwable $error) {
    bookili_database_error($error);
}
