<?php
declare(strict_types=1);
require_once __DIR__ . '/booking.php';
bookili_require_method('GET');

try {
    $pdo = bookili_database();
    if (isset($_GET['id'])) {
        $salon = bookili_public_salon($pdo, bookili_id($_GET['id']));
        $statement = $pdo->prepare(
            'SELECT id, name, category, duration_minutes, price_dzd FROM services
             WHERE salon_id = :id AND is_active = 1 ORDER BY name'
        );
        $statement->execute(['id' => $salon['id']]);
        $services = $statement->fetchAll();
        $statement = $pdo->prepare(
            "SELECT id, category, title, details FROM salon_profile_entries
             WHERE salon_id = :id AND status = 'approved' ORDER BY category, created_at, id"
        );
        $statement->execute(['id' => $salon['id']]);
        $profileEntries = $statement->fetchAll();
        $statement = $pdo->prepare(
            "SELECT id, position FROM salon_photos
             WHERE salon_id = :id AND status = 'approved' ORDER BY position, id"
        );
        $statement->execute(['id' => $salon['id']]);
        $photos = $statement->fetchAll();
        $statement = $pdo->prepare('SELECT weekday, opens_at, closes_at FROM salon_hours WHERE salon_id = :id ORDER BY weekday');
        $statement->execute(['id' => $salon['id']]);
        bookili_json_response(200, [
            'salon' => $salon, 'services' => $services, 'hours' => $statement->fetchAll(),
            'profileEntries' => $profileEntries, 'photos' => $photos,
        ]);
    }

    $query = $_GET['q'] ?? '';
    $city = $_GET['ville'] ?? '';
    $wilaya = $_GET['wilaya'] ?? '';
    $category = $_GET['categorie'] ?? '';
    $page = isset($_GET['page']) ? bookili_id($_GET['page']) : 1;
    if (!is_string($query) || strlen($query) > 400 || !is_string($city) || strlen($city) > 400
        || !is_string($wilaya) || !is_string($category) || $page > 10000
        || ($wilaya !== '' && !preg_match('/^(0[1-9]|[1-4][0-9]|5[0-8])$/D', $wilaya))
        || ($category !== '' && !in_array($category, [...BOOKILI_SERVICE_CATEGORIES, 'cadeau'], true))) {
        bookili_json_response(422, ['error' => 'Les filtres de recherche sont invalides.']);
    }
    // Gift-card sales are not yet available; never return unrelated services.
    if ($category === 'cadeau') bookili_json_response(200, ['salons' => [], 'hasMore' => false]);

    $sql = "SELECT s.id, s.name, s.city, s.wilaya_code, s.address,
                   (SELECT MIN(price_dzd) FROM services WHERE salon_id = s.id AND is_active = 1) AS from_price
            FROM salons s
            INNER JOIN professional_profiles p ON p.id = s.professional_profile_id
            INNER JOIN accounts a ON a.id = p.account_id
            WHERE s.is_public = 1 AND a.status = 'active' AND a.role = 'professional'
            AND EXISTS (SELECT 1 FROM salon_hours h WHERE h.salon_id = s.id)
            AND EXISTS (SELECT 1 FROM services v WHERE v.salon_id = s.id AND v.is_active = 1";
    $params = [];
    if ($category !== '') {
        $sql .= ' AND v.category = :category';
        $params['category'] = $category;
    }
    $sql .= ')';
    if ($wilaya !== '') {
        $sql .= ' AND s.wilaya_code = :wilaya';
        $params['wilaya'] = $wilaya;
    }
    if (trim($city) !== '') {
        $sql .= ' AND s.city = :city';
        $params['city'] = trim($city);
    }
    if (trim($query) !== '') {
        $sql .= " AND (s.name LIKE :salon_query ESCAPE '!' OR s.city LIKE :city_query ESCAPE '!'
                 OR EXISTS (SELECT 1 FROM services v WHERE v.salon_id = s.id AND v.is_active = 1 AND v.name LIKE :service_query ESCAPE '!'))";
        $pattern = '%' . strtr(trim($query), ['!' => '!!', '%' => '!%', '_' => '!_']) . '%';
        $params += ['salon_query' => $pattern, 'city_query' => $pattern, 'service_query' => $pattern];
    }
    $sql .= ' ORDER BY s.name, s.id LIMIT 21 OFFSET ' . (($page - 1) * 20);
    $statement = $pdo->prepare($sql);
    $statement->execute($params);
    $salons = $statement->fetchAll();
    bookili_json_response(200, ['salons' => array_slice($salons, 0, 20), 'hasMore' => count($salons) > 20]);
} catch (Throwable $error) {
    bookili_database_error($error);
}
