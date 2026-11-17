<?php
declare(strict_types=1);

function bookili_database(): PDO
{
    $configPath = __DIR__ . '/config.php';
    if (!is_file($configPath)) {
        throw new RuntimeException('BOOKILI database configuration is missing.');
    }

    $config = require $configPath;
    foreach (['db_host', 'db_name', 'db_user', 'db_password'] as $key) {
        if (!is_array($config) || !isset($config[$key]) || $config[$key] === '') {
            throw new RuntimeException('BOOKILI database configuration is incomplete.');
        }
    }

    $dsn = sprintf(
        'mysql:host=%s;dbname=%s;charset=utf8mb4',
        $config['db_host'],
        $config['db_name'],
    );

    try {
        return new PDO($dsn, $config['db_user'], $config['db_password'], [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
            PDO::ATTR_TIMEOUT => 5,
        ]);
    } catch (PDOException $error) {
        error_log('BOOKILI database connection failed: ' . $error->getMessage());
        throw new RuntimeException('BOOKILI database connection is unavailable.');
    }
}
