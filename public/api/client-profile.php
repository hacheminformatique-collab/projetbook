<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

$method = $_SERVER['REQUEST_METHOD'] ?? '';
if (!in_array($method, ['GET', 'POST'], true)) {
    header('Allow: GET, POST');
    bookili_json_response(405, ['error' => 'Méthode non autorisée.']);
}

if ($method === 'POST') {
    bookili_require_csrf();
    $data = bookili_read_json();
    $phone = bookili_required_text($data, 'phone', 72);
    if (!bookili_valid_phone($phone)) {
        bookili_json_response(422, ['error' => 'Veuillez saisir un numéro de téléphone valide.']);
    }
}

try {
    $pdo = bookili_database();
    $account = bookili_require_role($pdo, ['client']);

    if ($method === 'POST') {
        $statement = $pdo->prepare(
            'UPDATE client_profiles SET phone_number = :phone WHERE account_id = :account_id'
        );
        $statement->execute(['phone' => $phone, 'account_id' => $account['id']]);
    }

    $statement = $pdo->prepare(
        'SELECT first_name, last_name, date_of_birth, phone_number
         FROM client_profiles WHERE account_id = :account_id'
    );
    $statement->execute(['account_id' => $account['id']]);
    $profile = $statement->fetch();
    if (!$profile) {
        throw new RuntimeException('Client profile is missing.');
    }

    bookili_json_response(200, ['profile' => $profile, 'email' => $account['email']]);
} catch (Throwable $error) {
    bookili_database_error($error);
}
