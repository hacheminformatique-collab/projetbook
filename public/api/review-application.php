<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

bookili_require_method('POST');
bookili_require_csrf();
$data = bookili_read_json();

$applicationId = filter_var($data['applicationId'] ?? null, FILTER_VALIDATE_INT, [
    'options' => ['min_range' => 1],
]);
$decision = $data['decision'] ?? null;
$reviewNote = $data['reviewNote'] ?? '';
$reviewNoteLength = is_string($reviewNote) ? preg_match_all('/./us', $reviewNote) : false;

if ($applicationId === false || !is_string($decision) || !in_array($decision, ['approve', 'reject'], true)) {
    bookili_json_response(422, ['error' => 'La décision de validation est invalide.']);
}
if ($reviewNoteLength === false || $reviewNoteLength > 1000 || str_contains($reviewNote, "\0")) {
    bookili_json_response(422, ['error' => 'La note de suivi ne peut pas dépasser 1 000 caractères.']);
}
$reviewNote = trim($reviewNote);

try {
    $pdo = bookili_database();
    $reviewer = bookili_require_role($pdo, ['commercial', 'super_admin']);
    $pdo->beginTransaction();

    $statement = $pdo->prepare(
        'SELECT id, account_id, business_name, wilaya_code, city, address, phone_number, status
         FROM professional_applications
         WHERE id = :id
         FOR UPDATE'
    );
    $statement->execute(['id' => $applicationId]);
    $application = $statement->fetch();

    if (!$application) {
        $pdo->rollBack();
        bookili_json_response(404, ['error' => 'Cette demande n’existe plus.']);
    }
    if (!in_array($application['status'], ['submitted', 'in_review'], true)) {
        $pdo->rollBack();
        bookili_json_response(409, ['error' => 'Cette demande a déjà été traitée.']);
    }

    $newStatus = $decision === 'approve' ? 'approved' : 'rejected';
    $statement = $pdo->prepare(
        'UPDATE professional_applications
         SET status = :status, reviewed_by = :reviewed_by, review_note = :review_note, reviewed_at = CURRENT_TIMESTAMP
         WHERE id = :id'
    );
    $statement->execute([
        'status' => $newStatus,
        'reviewed_by' => $reviewer['id'],
        'review_note' => $reviewNote !== '' ? $reviewNote : null,
        'id' => $applicationId,
    ]);

    if ($decision === 'approve') {
        $statement = $pdo->prepare(
            'INSERT INTO professional_profiles (account_id, display_name)
             VALUES (:account_id, :display_name)'
        );
        $statement->execute([
            'account_id' => $application['account_id'],
            'display_name' => $application['business_name'],
        ]);
        $professionalProfileId = (int) $pdo->lastInsertId();

        $statement = $pdo->prepare(
            'INSERT INTO salons (professional_profile_id, name, wilaya_code, city, address, phone_number)
             VALUES (:profile_id, :name, :wilaya_code, :city, :address, :phone_number)'
        );
        $statement->execute([
            'profile_id' => $professionalProfileId,
            'name' => $application['business_name'],
            'wilaya_code' => $application['wilaya_code'],
            'city' => $application['city'],
            'address' => $application['address'],
            'phone_number' => $application['phone_number'],
        ]);

        $statement = $pdo->prepare(
            "UPDATE accounts SET status = 'active' WHERE id = :account_id AND role = 'professional'"
        );
        $statement->execute(['account_id' => $application['account_id']]);
        if ($statement->rowCount() !== 1) {
            throw new RuntimeException('Professional account could not be activated.');
        }
    } else {
        $statement = $pdo->prepare(
            "UPDATE accounts SET status = 'suspended' WHERE id = :account_id AND role = 'professional'"
        );
        $statement->execute(['account_id' => $application['account_id']]);
        if ($statement->rowCount() !== 1) {
            throw new RuntimeException('Professional account could not be rejected.');
        }
    }

    $pdo->commit();
    bookili_json_response(200, ['status' => $newStatus]);
} catch (Throwable $error) {
    if (isset($pdo) && $pdo->inTransaction()) {
        $pdo->rollBack();
    }
    bookili_database_error($error);
}
