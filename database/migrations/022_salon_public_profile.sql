ALTER TABLE salons
  ADD COLUMN profile_description VARCHAR(2000) NOT NULL DEFAULT '',
  ADD COLUMN public_description VARCHAR(2000) NOT NULL DEFAULT '',
  ADD COLUMN profile_description_status ENUM('draft', 'pending', 'approved', 'rejected') NOT NULL DEFAULT 'draft';

CREATE TABLE salon_profile_entries (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  salon_id BIGINT UNSIGNED NOT NULL,
  category ENUM('access', 'training', 'experience') NOT NULL,
  title VARCHAR(120) NOT NULL,
  details VARCHAR(1000) NOT NULL,
  status ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY salon_profile_entries_review (status, salon_id, category),
  CONSTRAINT salon_profile_entries_salon_fk
    FOREIGN KEY (salon_id) REFERENCES salons (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
