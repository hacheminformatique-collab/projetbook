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

CREATE TABLE IF NOT EXISTS registration_rate_limits (
  action_name VARCHAR(32) NOT NULL,
  ip_hash CHAR(64) NOT NULL,
  hour_bucket BIGINT UNSIGNED NOT NULL,
  attempts SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (action_name, ip_hash, hour_bucket),
  KEY registration_rate_limits_cleanup (hour_bucket)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS platform_setup (
  id TINYINT UNSIGNED NOT NULL,
  super_admin_created BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

INSERT IGNORE INTO platform_setup (id, super_admin_created) VALUES (1, FALSE);

CREATE TABLE IF NOT EXISTS homepage_image (
  id TINYINT UNSIGNED NOT NULL,
  mime_type VARCHAR(32) NOT NULL,
  image_data MEDIUMBLOB NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

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
  contact_name VARCHAR(100) NOT NULL,
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

CREATE TABLE IF NOT EXISTS salon_hours (
  salon_id BIGINT UNSIGNED NOT NULL,
  weekday TINYINT UNSIGNED NOT NULL,
  opens_at TIME NOT NULL,
  closes_at TIME NOT NULL,
  PRIMARY KEY (salon_id, weekday),
  CONSTRAINT salon_hours_salon_fk FOREIGN KEY (salon_id) REFERENCES salons (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS salon_closures (
  salon_id BIGINT UNSIGNED NOT NULL,
  closure_date DATE NOT NULL,
  reason VARCHAR(180) NOT NULL DEFAULT '',
  PRIMARY KEY (salon_id, closure_date),
  CONSTRAINT salon_closures_salon_fk FOREIGN KEY (salon_id) REFERENCES salons (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS appointments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  salon_id BIGINT UNSIGNED NOT NULL,
  client_id BIGINT UNSIGNED NOT NULL,
  service_id BIGINT UNSIGNED NOT NULL,
  service_name VARCHAR(180) NOT NULL,
  price_dzd BIGINT UNSIGNED NOT NULL,
  starts_at DATETIME NOT NULL,
  ends_at DATETIME NOT NULL,
  status ENUM('confirmed', 'cancelled') NOT NULL DEFAULT 'confirmed',
  notification_version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY appointments_salon_time (salon_id, status, starts_at, ends_at),
  KEY appointments_client_time (client_id, starts_at),
  CONSTRAINT appointments_salon_fk FOREIGN KEY (salon_id) REFERENCES salons (id) ON DELETE RESTRICT,
  CONSTRAINT appointments_client_fk FOREIGN KEY (client_id) REFERENCES accounts (id) ON DELETE RESTRICT,
  CONSTRAINT appointments_service_fk FOREIGN KEY (service_id) REFERENCES services (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notification_outbox (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  appointment_id BIGINT UNSIGNED NOT NULL,
  appointment_version INT UNSIGNED NOT NULL,
  kind ENUM('confirmation', 'rescheduled', 'cancelled', 'reminder_7d', 'reminder_1d') NOT NULL,
  recipient VARCHAR(254) NOT NULL,
  subject VARCHAR(200) NOT NULL,
  message_body TEXT NOT NULL,
  send_after DATETIME NOT NULL,
  status ENUM('queued', 'sending', 'retry', 'sent', 'failed', 'cancelled') NOT NULL DEFAULT 'queued',
  attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  locked_at DATETIME NULL,
  sent_at DATETIME NULL,
  last_error VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY notification_outbox_dedupe (appointment_id, appointment_version, kind),
  KEY notification_outbox_queue (status, send_after, id),
  CONSTRAINT notification_outbox_appointment_fk
    FOREIGN KEY (appointment_id) REFERENCES appointments (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS products (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  salon_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(180) NOT NULL,
  reference VARCHAR(80) NOT NULL DEFAULT '',
  price_dzd BIGINT UNSIGNED NOT NULL DEFAULT 0,
  quantity INT UNSIGNED NOT NULL DEFAULT 0,
  low_stock_threshold INT UNSIGNED NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (id),
  KEY products_salon_active (salon_id, is_active, id),
  CONSTRAINT products_salon_fk FOREIGN KEY (salon_id) REFERENCES salons (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS stock_movements (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  product_id BIGINT UNSIGNED NOT NULL,
  actor_id BIGINT UNSIGNED NOT NULL,
  request_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  quantity_delta INT NOT NULL,
  quantity_after INT UNSIGNED NOT NULL,
  reason VARCHAR(255) NOT NULL,
  created_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY stock_movements_request (product_id, request_key),
  KEY stock_movements_history (product_id, id),
  CONSTRAINT stock_movements_product_fk FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE RESTRICT,
  CONSTRAINT stock_movements_actor_fk FOREIGN KEY (actor_id) REFERENCES accounts (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cash_sales (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  salon_id BIGINT UNSIGNED NOT NULL,
  actor_id BIGINT UNSIGNED NOT NULL,
  request_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  request_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  payment_method ENUM('cash', 'card', 'transfer', 'other') NOT NULL,
  total_dzd BIGINT UNSIGNED NOT NULL,
  recorded_at DATETIME NOT NULL,
  voided_at DATETIME NULL,
  voided_by BIGINT UNSIGNED NULL,
  void_reason VARCHAR(255) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY cash_sales_request (salon_id, request_key),
  KEY cash_sales_recorded (salon_id, recorded_at, id),
  KEY cash_sales_voided (salon_id, voided_at, id),
  CONSTRAINT cash_sales_salon_fk FOREIGN KEY (salon_id) REFERENCES salons (id),
  CONSTRAINT cash_sales_actor_fk FOREIGN KEY (actor_id) REFERENCES accounts (id),
  CONSTRAINT cash_sales_void_actor_fk FOREIGN KEY (voided_by) REFERENCES accounts (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cash_sale_lines (
  sale_id BIGINT UNSIGNED NOT NULL,
  item_kind ENUM('product', 'service') NOT NULL,
  item_id BIGINT UNSIGNED NOT NULL,
  item_name VARCHAR(180) NOT NULL,
  quantity INT UNSIGNED NOT NULL,
  unit_price_dzd BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (sale_id, item_kind, item_id),
  CONSTRAINT cash_sale_lines_sale_fk FOREIGN KEY (sale_id) REFERENCES cash_sales (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
