CREATE TABLE IF NOT EXISTS accounts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  email VARCHAR(254) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('client', 'professional', 'commercial', 'super_admin') NOT NULL,
  status ENUM('pending', 'active', 'suspended') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY accounts_email_unique (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS client_profiles (
  account_id BIGINT UNSIGNED NOT NULL,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  date_of_birth DATE NOT NULL,
  phone_number VARCHAR(32) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (account_id),
  CONSTRAINT client_profiles_account_fk
    FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS professional_applications (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  account_id BIGINT UNSIGNED NOT NULL,
  business_name VARCHAR(180) NOT NULL,
  business_category ENUM(
    'coiffeur', 'barbier', 'manucure', 'institut',
    'bien-etre', 'maquillage', 'spa', 'massage'
  ) NOT NULL,
  wilaya_code CHAR(2) NOT NULL,
  city VARCHAR(120) NOT NULL,
  address VARCHAR(255) NOT NULL,
  phone_number VARCHAR(32) NOT NULL,
  status ENUM('submitted', 'in_review', 'approved', 'rejected') NOT NULL DEFAULT 'submitted',
  reviewed_by BIGINT UNSIGNED NULL,
  review_note TEXT NULL,
  submitted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (id),
  KEY professional_applications_review_queue (status, submitted_at),
  KEY professional_applications_account (account_id, status),
  CONSTRAINT professional_applications_account_fk
    FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE RESTRICT,
  CONSTRAINT professional_applications_reviewer_fk
    FOREIGN KEY (reviewed_by) REFERENCES accounts (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS professional_profiles (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  account_id BIGINT UNSIGNED NOT NULL,
  display_name VARCHAR(180) NOT NULL,
  description TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY professional_profiles_account_unique (account_id),
  CONSTRAINT professional_profiles_account_fk
    FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS salons (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  professional_profile_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(180) NOT NULL,
  wilaya_code CHAR(2) NOT NULL,
  city VARCHAR(120) NOT NULL,
  address VARCHAR(255) NOT NULL,
  phone_number VARCHAR(32) NULL,
  is_public BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY salons_public_location (is_public, wilaya_code, city),
  CONSTRAINT salons_professional_profile_fk
    FOREIGN KEY (professional_profile_id) REFERENCES professional_profiles (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS services (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  salon_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(180) NOT NULL,
  category ENUM(
    'coiffeur', 'barbier', 'manucure', 'institut',
    'bien-etre', 'maquillage', 'spa', 'massage'
  ) NOT NULL,
  description TEXT NULL,
  duration_minutes SMALLINT UNSIGNED NOT NULL,
  price_dzd BIGINT UNSIGNED NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY services_active_by_salon (salon_id, is_active, category),
  CONSTRAINT services_salon_fk
    FOREIGN KEY (salon_id) REFERENCES salons (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
