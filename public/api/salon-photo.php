<?php
declare(strict_types=1);
require_once __DIR__ . '/booking.php';
bookili_require_method('GET');

try {
    $pdo = bookili_database();
    $photoId = bookili_id($_GET['id'] ?? null);
    $statement = $pdo->prepare(
        'SELECT p.mime_type, p.image_data, p.status, s.id AS salon_id, s.is_public,
                a.id AS professional_id, a.status AS account_status, a.role AS account_role
         FROM salon_photos p
         INNER JOIN salons s ON s.id = p.salon_id
         INNER JOIN professional_profiles pp ON pp.id = s.professional_profile_id
         INNER JOIN accounts a ON a.id = pp.account_id
         WHERE p.id = :id'
    );
    $statement->execute(['id' => $photoId]);
    $photo = $statement->fetch();
    if (!$photo) bookili_json_response(404, ['error' => 'Photo introuvable.']);

    $isPublic = $photo['status'] === 'approved' && (int) $photo['is_public'] === 1
        && $photo['account_status'] === 'active' && $photo['account_role'] === 'professional';
    if (!$isPublic) {
        $viewer = bookili_session_account($pdo);
        $isOwner = $viewer && $viewer['role'] === 'professional'
            && (int) $viewer['id'] === (int) $photo['professional_id'];
        if (!$viewer || (!$isOwner && $viewer['role'] !== 'super_admin')) {
            bookili_json_response(404, ['error' => 'Photo introuvable.']);
        }
    }
    if (!in_array($photo['mime_type'], ['image/jpeg', 'image/png', 'image/webp'], true)
        || !is_string($photo['image_data'])) {
        throw new RuntimeException('Unexpected salon photo data.');
    }
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    header('Content-Type: ' . $photo['mime_type']);
    echo $photo['image_data'];
} catch (Throwable $error) {
    bookili_database_error($error);
}
