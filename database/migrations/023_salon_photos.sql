CREATE TABLE salon_photos (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  salon_id BIGINT UNSIGNED NOT NULL,
  mime_type VARCHAR(32) NOT NULL,
  image_data MEDIUMBLOB NOT NULL,
  position SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  status ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY salon_photos_gallery (salon_id, status, position, id),
  KEY salon_photos_review (status, created_at, id),
  CONSTRAINT salon_photos_salon_fk
    FOREIGN KEY (salon_id) REFERENCES salons (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
