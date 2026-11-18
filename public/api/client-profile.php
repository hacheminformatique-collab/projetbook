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
    $phone = isset($data['phone']) ? bookili_required_text($data, 'phone', 72) : null;
    $marketingConsent = $data['marketingConsent'] ?? null;
    if ($phone === null && !is_bool($marketingConsent)) bookili_json_response(422, ['error' => 'Aucune modification de compte à enregistrer.']);
    if ($phone !== null && !bookili_valid_phone($phone)) {
        bookili_json_response(422, ['error' => 'Veuillez saisir un numéro de téléphone valide.']);
    }
    if (array_key_exists('marketingConsent', $data) && !is_bool($marketingConsent)) {
        bookili_json_response(422, ['error' => 'Le choix de recevoir les communications BOOKILI est invalide.']);
    }
}

try {
    $pdo = bookili_database();
    $account = bookili_require_role($pdo, ['client']);

    if ($method === 'POST') {
        $pdo->beginTransaction();
        if ($phone !== null) {
            $statement = $pdo->prepare(
                'UPDATE client_profiles SET phone_number = :phone WHERE account_id = :account_id'
            );
            $statement->execute(['phone' => $phone, 'account_id' => $account['id']]);
        }
        if (is_bool($marketingConsent)) {
            $now = (new DateTimeImmutable('now', new DateTimeZone('Africa/Algiers')))->format('Y-m-d H:i:s');
            $statement = $pdo->prepare(
                'INSERT INTO client_marketing_preferences (account_id, consent, updated_at)
                 VALUES (:account_id, :consent, :updated_at)
                 ON DUPLICATE KEY UPDATE consent = VALUES(consent), updated_at = VALUES(updated_at)'
            );
            $statement->execute(['account_id' => $account['id'], 'consent' => (int) $marketingConsent, 'updated_at' => $now]);
            if (!$marketingConsent) {
                $pdo->prepare(
                    "UPDATE marketing_campaign_recipients SET status = 'cancelled'
                     WHERE account_id = :account_id AND status IN ('queued', 'retry')"
                )->execute(['account_id' => $account['id']]);
            }
        }
        $pdo->commit();
    }

    $statement = $pdo->prepare(
        'SELECT c.first_name, c.last_name, c.date_of_birth, c.phone_number, COALESCE(mp.consent, 0) AS marketing_consent
         FROM client_profiles c
         LEFT JOIN client_marketing_preferences mp ON mp.account_id = c.account_id
         WHERE c.account_id = :account_id'
    );
    $statement->execute(['account_id' => $account['id']]);
    $profile = $statement->fetch();
    if (!$profile) {
        throw new RuntimeException('Client profile is missing.');
    }

    bookili_json_response(200, ['profile' => $profile, 'email' => $account['email']]);
} catch (Throwable $error) {
    if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
    bookili_database_error($error);
}
