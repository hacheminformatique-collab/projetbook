<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    http_response_code(405);
    header('Allow: GET');
    echo json_encode(['status' => 'error', 'message' => 'Method not allowed.']);
    exit;
}

require_once __DIR__ . '/database.php';

try {
    bookili_database()->query('SELECT 1');
    echo json_encode(['status' => 'ok']);
} catch (RuntimeException $error) {
    error_log('BOOKILI health check failed: ' . $error->getMessage());
    http_response_code(503);
    echo json_encode([
        'status' => 'unavailable',
        'message' => 'The database is not configured or could not be reached.',
    ]);
}
