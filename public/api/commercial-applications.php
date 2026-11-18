<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

bookili_require_method('GET');

try {
    $pdo = bookili_database();
    bookili_require_role($pdo, ['commercial', 'super_admin']);

    $status = $_GET['status'] ?? 'pending';
    $allowedStatuses = ['pending', 'submitted', 'in_review', 'approved', 'rejected'];
    if (!is_string($status) || !in_array($status, $allowedStatuses, true)) {
        bookili_json_response(422, ['error' => 'Le filtre de demandes est invalide.']);
    }

    $query = "
      SELECT
        pa.id,
        pa.business_name,
        pa.contact_name,
        pa.business_category,
        pa.wilaya_code,
        pa.city,
        pa.address,
        pa.phone_number,
        pa.status,
        pa.review_note,
        pa.submitted_at,
        a.email
      FROM professional_applications pa
      INNER JOIN accounts a ON a.id = pa.account_id
    ";

    if ($status === 'pending') {
        $query .= " WHERE pa.status IN ('submitted', 'in_review')";
    } else {
        $query .= ' WHERE pa.status = :status';
    }
    $query .= ' ORDER BY pa.submitted_at DESC LIMIT 200';

    $statement = $pdo->prepare($query);
    if ($status !== 'pending') {
        $statement->execute(['status' => $status]);
    } else {
        $statement->execute();
    }

    bookili_json_response(200, ['applications' => $statement->fetchAll()]);
} catch (Throwable $error) {
    bookili_database_error($error);
}
