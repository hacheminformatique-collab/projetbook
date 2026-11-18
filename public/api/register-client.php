<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

bookili_require_method('POST');
bookili_require_csrf();
$data = bookili_read_json();

$firstName = bookili_required_text($data, 'firstName', 300);
$lastName = bookili_required_text($data, 'lastName', 300);
$email = bookili_normalize_email($data);
$phone = bookili_required_text($data, 'phone', 72);
$dateOfBirth = bookili_required_text($data, 'dateOfBirth', 10);
$password = bookili_valid_password($data);

if (!bookili_valid_phone($phone)) {
    bookili_json_response(422, ['error' => 'Veuillez saisir un numéro de téléphone valide.']);
}

$birthDate = DateTimeImmutable::createFromFormat('!Y-m-d', $dateOfBirth);
if (!$birthDate || $birthDate->format('Y-m-d') !== $dateOfBirth || $birthDate > new DateTimeImmutable('today')) {
    bookili_json_response(422, ['error' => 'Veuillez saisir une date de naissance valide.']);
}

try {
    $pdo = bookili_database();
    bookili_rate_limit($pdo, 'register-client');
    $pdo->beginTransaction();

    $statement = $pdo->prepare(
        "INSERT INTO accounts (email, password_hash, role, status)
         VALUES (:email, :password_hash, 'client', 'active')"
    );
    $statement->execute([
        'email' => $email,
        'password_hash' => password_hash($password, PASSWORD_DEFAULT),
    ]);
    $accountId = (int) $pdo->lastInsertId();

    $statement = $pdo->prepare(
        'INSERT INTO client_profiles (account_id, first_name, last_name, date_of_birth, phone_number)
         VALUES (:account_id, :first_name, :last_name, :date_of_birth, :phone_number)'
    );
    $statement->execute([
        'account_id' => $accountId,
        'first_name' => $firstName,
        'last_name' => $lastName,
        'date_of_birth' => $dateOfBirth,
        'phone_number' => $phone,
    ]);

    $pdo->commit();
    bookili_json_response(201, ['message' => 'Votre compte BOOKILI est créé. Vous pouvez maintenant vous connecter.']);
} catch (PDOException $error) {
    if (isset($pdo) && $pdo->inTransaction()) {
        $pdo->rollBack();
    }

    if ($error->getCode() === '23000') {
        bookili_json_response(409, ['error' => 'Un compte existe déjà avec cette adresse e-mail.']);
    }

    bookili_database_error($error);
} catch (Throwable $error) {
    if (isset($pdo) && $pdo->inTransaction()) {
        $pdo->rollBack();
    }
    bookili_database_error($error);
}
