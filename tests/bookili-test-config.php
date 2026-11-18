<?php
declare(strict_types=1);

return [
    'db_host' => getenv('BOOKILI_DB_HOST') ?: 'database',
    'db_name' => getenv('BOOKILI_DB_NAME') ?: 'bookili',
    'db_user' => getenv('BOOKILI_DB_USER') ?: 'bookili',
    'db_password' => getenv('BOOKILI_DB_PASSWORD') ?: 'bookili-test',
    'setup_token' => getenv('BOOKILI_TEST_SETUP_TOKEN') ?: '',
    'mail_from' => 'notifications@example.test',
    'mail_from_name' => 'BOOKILI',
];
