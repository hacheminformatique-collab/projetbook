<?php
declare(strict_types=1);

function bookili_configuration(): array
{
    static $config = null;
    if (is_array($config)) {
        return $config;
    }

    $configuredPath = getenv('BOOKILI_CONFIG_PATH');
    $configPaths = array_filter([
        is_string($configuredPath) && $configuredPath !== '' ? $configuredPath : null,
        dirname(__DIR__, 2) . '/bookili-config.php',
        __DIR__ . '/config.php',
    ]);
    $configPath = null;
    foreach ($configPaths as $path) {
        if (is_file($path) && is_readable($path)) {
            $configPath = $path;
            break;
        }
    }

    if ($configPath === null) {
        throw new RuntimeException('BOOKILI database configuration is missing.');
    }

    $config = require $configPath;
    if (!is_array($config)) {
        throw new RuntimeException('BOOKILI database configuration is invalid.');
    }

    return $config;
}

function bookili_database(): PDO
{
    $config = bookili_configuration();
    foreach (['db_host', 'db_name', 'db_user', 'db_password'] as $key) {
        if (!isset($config[$key]) || $config[$key] === '') {
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
