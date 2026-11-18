<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

bookili_require_method('POST');
bookili_require_csrf();
$data = bookili_read_json();

$businessName = bookili_required_text($data, 'businessName', 540);
$contactName = bookili_required_text($data, 'contactName', 300);
$email = bookili_normalize_email($data);
$phone = bookili_required_text($data, 'phone', 72);
$category = $data['category'] ?? null;
$wilayaCode = $data['wilaya'] ?? null;
$city = bookili_required_text($data, 'city', 360);
$address = bookili_required_text($data, 'address', 765);
$password = bookili_valid_password($data);

$allowedCategories = ['coiffeur', 'barbier', 'manucure', 'institut', 'bien-etre', 'maquillage', 'spa', 'massage'];
if (!is_string($category) || !in_array($category, $allowedCategories, true)) {
    bookili_json_response(422, ['error' => 'Veuillez choisir une catégorie de professionnel valide.']);
}

if (!is_string($wilayaCode) || preg_match('/^(0[1-9]|[1-5][0-8])$/', $wilayaCode) !== 1) {
    bookili_json_response(422, ['error' => 'Veuillez choisir une wilaya en Algérie.']);
}

if (!bookili_valid_phone($phone)) {
    bookili_json_response(422, ['error' => 'Veuillez saisir un numéro de téléphone valide.']);
}

try {
    $pdo = bookili_database();
    bookili_rate_limit($pdo, 'register-professional');
    $pdo->beginTransaction();

    $statement = $pdo->prepare(
        "INSERT INTO accounts (email, password_hash, role, status)
         VALUES (:email, :password_hash, 'professional', 'pending')"
    );
    $statement->execute([
        'email' => $email,
        'password_hash' => password_hash($password, PASSWORD_DEFAULT),
    ]);
    $accountId = (int) $pdo->lastInsertId();

    $statement = $pdo->prepare(
        'INSERT INTO professional_applications
          (account_id, business_name, contact_name, business_category, wilaya_code, city, address, phone_number, status)
         VALUES
          (:account_id, :business_name, :contact_name, :business_category, :wilaya_code, :city, :address, :phone_number, \'submitted\')'
    );
    $statement->execute([
        'account_id' => $accountId,
        'business_name' => $businessName,
        'contact_name' => $contactName,
        'business_category' => $category,
        'wilaya_code' => $wilayaCode,
        'city' => $city,
        'address' => $address,
        'phone_number' => $phone,
    ]);

    $pdo->commit();
    bookili_json_response(201, ['message' => 'Votre demande a bien été enregistrée. Elle sera examinée par notre équipe commerciale.']);
} catch (PDOException $error) {
    if (isset($pdo) && $pdo->inTransaction()) {
        $pdo->rollBack();
    }

    if ($error->getCode() === '23000') {
        bookili_json_response(409, ['error' => 'Une demande ou un compte existe déjà avec cette adresse e-mail.']);
    }

    bookili_database_error($error);
} catch (Throwable $error) {
    if (isset($pdo) && $pdo->inTransaction()) {
        $pdo->rollBack();
    }
    bookili_database_error($error);
}
