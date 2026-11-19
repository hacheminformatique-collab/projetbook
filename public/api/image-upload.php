<?php
declare(strict_types=1);

function bookili_process_image_upload(mixed $file): array
{
    if (!is_array($file) || !isset($file['error']) || is_array($file['error'])) {
        bookili_json_response(422, ['error' => 'Veuillez choisir une image.']);
    }
    if (in_array($file['error'], [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true)) {
        bookili_json_response(422, ['error' => 'L’image dépasse la taille autorisée par le serveur.']);
    }
    if ($file['error'] !== UPLOAD_ERR_OK || !is_string($file['tmp_name']) || !is_uploaded_file($file['tmp_name'])) {
        bookili_json_response(422, ['error' => 'Le fichier n’a pas pu être transféré. Réessayez.']);
    }
    if (!is_int($file['size']) || $file['size'] < 1 || $file['size'] > 2 * 1024 * 1024) {
        bookili_json_response(422, ['error' => 'L’image doit peser au maximum 2 Mo.']);
    }
    if (!extension_loaded('gd')) {
        error_log('BOOKILI API error: The PHP GD extension is required for salon and homepage images.');
        bookili_json_response(503, ['error' => 'Activez l’extension PHP GD sur le serveur pour modifier les images.']);
    }

    $info = @getimagesize($file['tmp_name']);
    $allowed = [IMAGETYPE_JPEG => 'image/jpeg', IMAGETYPE_PNG => 'image/png', IMAGETYPE_WEBP => 'image/webp'];
    if (!$info || !isset($allowed[$info[2]]) || $info[0] < 1 || $info[1] < 1
        || $info[0] > 6000 || $info[1] > 6000 || $info[0] * $info[1] > 8000000) {
        bookili_json_response(422, ['error' => 'Utilisez une image JPEG, PNG ou WebP valide, de 8 mégapixels maximum.']);
    }

    $bytes = file_get_contents($file['tmp_name']);
    if ($bytes === false) {
        throw new RuntimeException('Could not read uploaded image.');
    }
    $decoded = @imagecreatefromstring($bytes);
    if ($decoded === false) {
        bookili_json_response(422, ['error' => 'Cette image ne peut pas être ouverte.']);
    }
    if ($info[2] === IMAGETYPE_JPEG) {
        if (!function_exists('exif_read_data')) {
            imagedestroy($decoded);
            error_log('BOOKILI API error: The PHP EXIF extension is required for JPEG orientation.');
            bookili_json_response(503, ['error' => 'Activez l’extension PHP EXIF sur le serveur pour utiliser une image JPEG.']);
        }
        $exif = @exif_read_data($file['tmp_name'], 'IFD0');
        $orientation = is_array($exif) ? (int) ($exif['Orientation'] ?? 1) : 1;
        if (in_array($orientation, [2, 4, 5, 7], true)) {
            $flip = $orientation === 4 ? IMG_FLIP_VERTICAL : IMG_FLIP_HORIZONTAL;
            if (!imageflip($decoded, $flip)) {
                imagedestroy($decoded);
                throw new RuntimeException('Could not orient uploaded image.');
            }
        }
        $rotation = match ($orientation) {
            3 => 180,
            5, 8 => 90,
            6, 7 => -90,
            default => 0,
        };
        if ($rotation !== 0) {
            $rotated = imagerotate($decoded, $rotation, 0);
            imagedestroy($decoded);
            if ($rotated === false) {
                throw new RuntimeException('Could not orient uploaded image.');
            }
            $decoded = $rotated;
        }
    }
    if ($info[2] === IMAGETYPE_PNG || $info[2] === IMAGETYPE_WEBP) {
        imagealphablending($decoded, false);
        imagesavealpha($decoded, true);
    }
    ob_start();
    try {
        $encoded = match ($info[2]) {
            IMAGETYPE_JPEG => imagejpeg($decoded, null, 85),
            IMAGETYPE_PNG => imagepng($decoded, null, 6),
            IMAGETYPE_WEBP => function_exists('imagewebp') && imagewebp($decoded, null, 85),
        };
        $cleanImage = ob_get_contents();
    } finally {
        ob_end_clean();
        imagedestroy($decoded);
    }
    if (!$encoded || !is_string($cleanImage) || $cleanImage === '') {
        throw new RuntimeException('Could not encode uploaded image.');
    }
    if (strlen($cleanImage) > 2 * 1024 * 1024) {
        bookili_json_response(422, ['error' => 'L’image reste trop volumineuse après traitement. Choisissez une image plus légère.']);
    }

    return ['mime_type' => $allowed[$info[2]], 'image_data' => $cleanImage];
}
