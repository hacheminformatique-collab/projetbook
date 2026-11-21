<?php
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require_once __DIR__ . '/database.php';

$failures = 0;
$warnings = 0;

function preflight_result(string $label, bool $ok, string $failure, bool $warning = false): void
{
    global $failures, $warnings;
    if ($ok) {
        echo "[OK]   {$label}\n";
        return;
    }
    if ($warning) {
        $warnings++;
        echo "[WARN] {$failure}\n";
        return;
    }
    $failures++;
    echo "[FAIL] {$failure}\n";
}

preflight_result('PHP 8.1+', version_compare(PHP_VERSION, '8.1.0', '>='), 'PHP 8.1 ou supérieur est requis.');
foreach (['pdo_mysql', 'gd', 'exif'] as $extension) {
    preflight_result("Extension PHP {$extension}", extension_loaded($extension), "Activez l’extension PHP {$extension}.");
}
foreach (['imagejpeg', 'imagepng', 'imagewebp'] as $function) {
    preflight_result("Support image {$function}", function_exists($function), "Activez le support GD pour {$function}.");
}
preflight_result('Envoi de courriels PHP disponible', function_exists('mail'), 'La fonction PHP mail() est indisponible.');

$documentRoot = getenv('BOOKILI_DOCUMENT_ROOT');
$documentRoot = is_string($documentRoot) && $documentRoot !== ''
    ? realpath($documentRoot)
    : realpath(dirname(__DIR__));
$configuredPath = getenv('BOOKILI_CONFIG_PATH');
$configPaths = array_filter([
    is_string($configuredPath) && $configuredPath !== '' ? $configuredPath : null,
    dirname(__DIR__, 2) . '/bookili-config.php',
    __DIR__ . '/config.php',
]);
$configPath = null;
foreach ($configPaths as $path) {
    if (is_file($path) && is_readable($path)) {
        $configPath = realpath($path);
        break;
    }
}
$outsideDocumentRoot = is_string($documentRoot) && is_string($configPath)
    && !str_starts_with($configPath, rtrim($documentRoot, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR);
preflight_result(
    'Configuration privée hors du document root',
    $outsideDocumentRoot,
    'Placez bookili-config.php hors du document root et configurez BOOKILI_CONFIG_PATH si nécessaire.'
);

$configuration = [];
$configurationLoaded = false;
try {
    $configuration = bookili_configuration();
    $configurationLoaded = true;
} catch (Throwable) {
    preflight_result('Configuration BOOKILI lisible', false, 'Vérifiez le chemin et le format du fichier de configuration privé.');
}

$sender = $configuration['mail_from'] ?? null;
preflight_result(
    'Adresse d’expédition valide',
    is_string($sender) && filter_var($sender, FILTER_VALIDATE_EMAIL) !== false
        && preg_match('/[\r\n\x00-\x20\x7f]/', $sender) === 0,
    'Configurez mail_from avec une adresse valide.'
);
$senderName = $configuration['mail_from_name'] ?? null;
preflight_result(
    'Nom d’expédition valide',
    is_string($senderName) && trim($senderName) !== ''
        && preg_match('/[\r\n\x00-\x1f\x7f]/', $senderName) === 0,
    'Configurez mail_from_name sans retour à la ligne.'
);
$publicUrl = $configuration['public_url'] ?? null;
$urlParts = is_string($publicUrl) ? parse_url($publicUrl) : false;
preflight_result(
    'URL publique HTTPS valide',
    is_array($urlParts) && ($urlParts['scheme'] ?? '') === 'https' && !empty($urlParts['host'])
        && !isset($urlParts['user'], $urlParts['pass'], $urlParts['query'], $urlParts['fragment']),
    'Configurez public_url avec l’URL HTTPS publique exacte de BOOKILI.'
);
if ($configurationLoaded) {
    preflight_result(
        'Clé de création initiale retirée',
        empty($configuration['setup_token']),
        'Retirez setup_token du fichier privé après la création du premier super-admin.',
        true
    );
}

$pdo = null;
try {
    $pdo = bookili_database();
    $pdo->query('SELECT 1');
    preflight_result('Connexion MySQL/MariaDB', true, '');
} catch (Throwable) {
    preflight_result('Connexion MySQL/MariaDB', false, 'Connexion impossible. Vérifiez le nom d’hôte, la base et les identifiants.');
}

if ($pdo instanceof PDO) {
    $tables = [
        'accounts', 'password_resets', 'registration_rate_limits', 'platform_setup', 'homepage_image',
        'client_profiles', 'client_marketing_preferences', 'professional_applications', 'professional_profiles',
        'salons', 'salon_profile_entries', 'salon_photos', 'services', 'salon_hours', 'salon_closures',
        'staff_members', 'staff_hours', 'staff_absences', 'appointments', 'appointment_private_notes',
        'professional_client_notes', 'appointment_services', 'notification_outbox', 'products', 'stock_movements', 'stock_suppliers',
        'stock_orders', 'stock_order_items', 'stock_order_receipts', 'stock_batches',
        'cash_sales', 'cash_sale_lines', 'cash_tickets', 'cash_ticket_lines', 'gift_cards', 'gift_card_events',
        'subscription_plans', 'professional_subscriptions', 'subscription_payments', 'admin_account_events',
        'marketing_campaigns', 'marketing_campaign_recipients', 'marketing_unsubscribe_tokens',
    ];
    $placeholders = implode(',', array_fill(0, count($tables), '?'));
    $statement = $pdo->prepare(
        'SELECT table_name FROM information_schema.tables
         WHERE table_schema = DATABASE() AND table_name IN (' . $placeholders . ')'
    );
    $statement->execute($tables);
    $present = $statement->fetchAll(PDO::FETCH_COLUMN);
    $missing = array_values(array_diff($tables, $present));
    preflight_result(
        'Tables applicatives présentes',
        $missing === [],
        $missing === [] ? '' : 'Tables manquantes : ' . implode(', ', $missing) . '. Vérifiez les migrations.',
    );

    $requiredColumns = [
        'accounts' => ['session_version'],
        'products' => ['category', 'max_stock_quantity', 'supplier_id'],
        'stock_movements' => ['is_count'],
        'appointments' => ['notification_version'],
        'salon_hours' => ['pause_starts_at', 'pause_ends_at'],
        'staff_hours' => ['pause_starts_at', 'pause_ends_at'],
        'notification_outbox' => ['appointment_version', 'locked_at'],
        'marketing_campaigns' => ['request_key', 'expected_recipients'],
        'marketing_campaign_recipients' => ['locked_at', 'last_error'],
    ];
    $missingColumns = [];
    foreach ($requiredColumns as $table => $columns) {
        $columnPlaceholders = implode(',', array_fill(0, count($columns), '?'));
        $columnStatement = $pdo->prepare(
            'SELECT column_name FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = ? AND column_name IN (' . $columnPlaceholders . ')'
        );
        $columnStatement->execute([$table, ...$columns]);
        $presentColumns = $columnStatement->fetchAll(PDO::FETCH_COLUMN);
        foreach (array_diff($columns, $presentColumns) as $column) {
            $missingColumns[] = "{$table}.{$column}";
        }
    }
    preflight_result(
        'Colonnes requises par les migrations récentes présentes',
        $missingColumns === [],
        $missingColumns === [] ? '' : 'Colonnes manquantes : ' . implode(', ', $missingColumns) . '. Appliquez les migrations requises dans l’ordre.',
    );
}

echo "\n{$failures} erreur(s), {$warnings} avertissement(s).\n";
exit($failures === 0 ? 0 : 1);
