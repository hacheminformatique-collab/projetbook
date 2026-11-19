<?php
declare(strict_types=1);
require_once __DIR__ . '/booking.php';

$method = bookili_booking_method();
$data = $method === 'POST' ? bookili_read_json() : [];

try {
    $pdo = bookili_database();
    $account = bookili_require_role($pdo, ['professional']);
    $salon = bookili_own_salon($pdo, (int) $account['id']);

    if ($method === 'POST') {
        $action = $data['action'] ?? '';
        if ($action === 'save-description') {
            $description = $data['description'] ?? null;
            if (!is_string($description) || strlen($description) > 8000 || preg_match('/\A.{0,2000}\z/us', $description) !== 1) {
                bookili_json_response(422, ['error' => 'Le descriptif doit contenir au maximum 2 000 caractères.']);
            }
            $description = trim($description);
            $statement = $pdo->prepare(
                "UPDATE salons SET profile_description = :description,
                 profile_description_status = :status WHERE id = :id"
            );
            $statement->execute([
                'description' => $description,
                'status' => $description !== '' || $salon['public_description'] !== '' ? 'pending' : 'draft',
                'id' => $salon['id'],
            ]);
        } elseif ($action === 'add-entry') {
            $category = $data['category'] ?? '';
            $title = $data['title'] ?? null;
            $details = $data['details'] ?? null;
            if (!is_string($category) || !in_array($category, ['access', 'training', 'experience'], true)
                || !is_string($title) || trim($title) === '' || strlen($title) > 480
                || preg_match('/\A.{1,120}\z/us', trim($title)) !== 1
                || !is_string($details) || strlen($details) > 4000
                || preg_match('/\A.{0,1000}\z/us', $details) !== 1) {
                bookili_json_response(422, ['error' => 'Vérifiez le titre et le contenu de cette rubrique.']);
            }
            $statement = $pdo->prepare('SELECT COUNT(*) FROM salon_profile_entries WHERE salon_id = :salon_id');
            $statement->execute(['salon_id' => $salon['id']]);
            if ((int) $statement->fetchColumn() >= 30) {
                bookili_json_response(422, ['error' => 'Un établissement ne peut pas avoir plus de 30 rubriques de présentation.']);
            }
            $statement = $pdo->prepare(
                "INSERT INTO salon_profile_entries (salon_id, category, title, details, status)
                 VALUES (:salon_id, :category, :title, :details, 'pending')"
            );
            $statement->execute([
                'salon_id' => $salon['id'], 'category' => $category,
                'title' => trim($title), 'details' => trim($details),
            ]);
        } elseif ($action === 'delete-entry') {
            $entryId = bookili_id($data['entryId'] ?? null);
            $statement = $pdo->prepare('DELETE FROM salon_profile_entries WHERE id = :id AND salon_id = :salon_id');
            $statement->execute(['id' => $entryId, 'salon_id' => $salon['id']]);
            if ($statement->rowCount() !== 1) bookili_json_response(404, ['error' => 'Cette rubrique est introuvable.']);
        } else {
            bookili_json_response(422, ['error' => 'Action de présentation invalide.']);
        }
    }

    $salon = bookili_own_salon($pdo, (int) $account['id']);
    $statement = $pdo->prepare(
        'SELECT id, category, title, details, status, created_at
         FROM salon_profile_entries WHERE salon_id = :salon_id ORDER BY created_at, id'
    );
    $statement->execute(['salon_id' => $salon['id']]);
    bookili_json_response(200, ['salon' => $salon, 'entries' => $statement->fetchAll()]);
} catch (Throwable $error) {
    bookili_database_error($error);
}
