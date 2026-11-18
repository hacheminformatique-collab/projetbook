<?php
declare(strict_types=1);
require_once __DIR__ . '/booking.php';

function bookili_unsubscribe_page(string $message, ?string $token = null, bool $success = false): never
{
    $safeMessage = htmlspecialchars($message, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    $form = $token === null ? '' : '<form method="post"><input type="hidden" name="token" value="'
        . htmlspecialchars($token, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8')
        . '"><button type="submit">Me désinscrire</button></form>';
    http_response_code($success ? 200 : ($token === null ? 404 : 200));
    header('Content-Type: text/html; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    header('X-Robots-Tag: noindex, nofollow');
    header('Referrer-Policy: no-referrer');
    echo '<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width">'
        . '<title>Désinscription BOOKILI</title><body><main><h1>Désinscription BOOKILI</h1><p>'
        . $safeMessage . '</p>' . $form . '</main></body></html>';
    exit;
}

$method = $_SERVER['REQUEST_METHOD'] ?? '';
if (!in_array($method, ['GET', 'POST'], true)) {
    header('Allow: GET, POST');
    bookili_unsubscribe_page('Lien de désinscription invalide.');
}
$token = $method === 'POST' ? ($_POST['token'] ?? '') : ($_GET['token'] ?? '');
if (!is_string($token) || !preg_match('/^[a-f0-9]{64}$/D', $token)) {
    bookili_unsubscribe_page('Lien de désinscription invalide ou expiré.');
}

try {
    $pdo = bookili_database();
    $hash = hash('sha256', $token);
    if ($method === 'GET') {
        $statement = $pdo->prepare('SELECT id FROM marketing_unsubscribe_tokens WHERE token_hash = :hash');
        $statement->execute(['hash' => $hash]);
        if (!$statement->fetchColumn()) bookili_unsubscribe_page('Lien de désinscription invalide ou expiré.');
        bookili_unsubscribe_page('Confirmez votre désinscription des e-mails marketing BOOKILI.', $token);
    }

    $pdo->beginTransaction();
    $statement = $pdo->prepare(
        'SELECT r.account_id FROM marketing_unsubscribe_tokens t
         INNER JOIN marketing_campaign_recipients r ON r.id = t.recipient_id
         WHERE t.token_hash = :hash FOR UPDATE'
    );
    $statement->execute(['hash' => $hash]);
    $accountId = $statement->fetchColumn();
    if (!$accountId) {
        $pdo->rollBack();
        bookili_unsubscribe_page('Lien de désinscription invalide ou expiré.');
    }
    $now = bookili_now()->format('Y-m-d H:i:s');
    $pdo->prepare(
        'INSERT INTO client_marketing_preferences (account_id, consent, updated_at)
         VALUES (:account, 0, :updated)
         ON DUPLICATE KEY UPDATE consent = 0, updated_at = VALUES(updated_at)'
    )->execute(['account' => $accountId, 'updated' => $now]);
    $pdo->prepare(
        "UPDATE marketing_campaign_recipients SET status = 'cancelled'
         WHERE account_id = :account AND status IN ('queued', 'retry')"
    )->execute(['account' => $accountId]);
    $pdo->commit();
    bookili_unsubscribe_page('Votre désinscription est enregistrée. BOOKILI ne vous enverra plus de campagnes marketing.', null, true);
} catch (Throwable $error) {
    if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
    error_log('BOOKILI unsubscribe failed: ' . $error->getMessage());
    bookili_unsubscribe_page('Le service est temporairement indisponible. Réessayez plus tard.');
}
