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
        ];
        if (!is_string($action) || !isset($decisions[$action])) {
            bookili_json_response(422, ['error' => 'Décision de validation invalide.']);
        }
        [$type, $status] = $decisions[$action];
        if ($type === 'description') {
            $statement = $pdo->prepare(
                $status === 'approved'
                    ? "UPDATE salons SET public_description = profile_description, profile_description_status = 'approved'
                       WHERE id = :id AND profile_description_status = 'pending'"
                    : "UPDATE salons SET profile_description_status = 'rejected'
                       WHERE id = :id AND profile_description_status = 'pending'"
            );
        } else {
            $statement = $pdo->prepare(
                'UPDATE salon_profile_entries SET status = :status WHERE id = :id AND status = \'pending\''
            );
            $statement->bindValue(':status', $status);
        }
        $statement->bindValue(':id', $id, PDO::PARAM_INT);
        $statement->execute();
        if ($statement->rowCount() !== 1) bookili_json_response(404, ['error' => 'Ce contenu n’est plus en attente de validation.']);
        bookili_json_response(200, ['message' => $status === 'approved' ? 'Le contenu a été publié.' : 'Le contenu a été refusé.']);
    }

    $descriptions = $pdo->query(
        "SELECT s.id, s.name, s.city, s.wilaya_code, s.profile_description, s.updated_at
         FROM salons s WHERE s.profile_description_status = 'pending' ORDER BY s.updated_at, s.id"
    )->fetchAll();
    $entries = $pdo->query(
        "SELECT e.id, e.category, e.title, e.details, e.created_at, s.name AS salon_name, s.city
         FROM salon_profile_entries e
         INNER JOIN salons s ON s.id = e.salon_id
         WHERE e.status = 'pending' ORDER BY e.created_at, e.id"
    )->fetchAll();
    bookili_json_response(200, ['descriptions' => $descriptions, 'entries' => $entries]);
} catch (Throwable $error) {
    bookili_database_error($error);
}
