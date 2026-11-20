CREATE TABLE IF NOT EXISTS accounts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  email VARCHAR(254) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  session_version INT UNSIGNED NOT NULL DEFAULT 0,
  role ENUM('client', 'professional', 'commercial', 'super_admin') NOT NULL,
  status ENUM('pending', 'active', 'suspended') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY accounts_email_unique (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS password_resets (
  account_id BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  session_version INT UNSIGNED NOT NULL,
  expires_at DATETIME NOT NULL,
  PRIMARY KEY (account_id),
  UNIQUE KEY password_resets_token (token_hash),
  CONSTRAINT password_resets_account_fk FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE CASCADE
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

CREATE TABLE IF NOT EXISTS client_marketing_preferences (
  account_id BIGINT UNSIGNED NOT NULL,
  consent BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (account_id),
  KEY client_marketing_consent (consent, account_id),
  CONSTRAINT client_marketing_account_fk FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE CASCADE
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
  booking_message VARCHAR(1000) NOT NULL DEFAULT '',
  profile_description VARCHAR(2000) NOT NULL DEFAULT '',
  public_description VARCHAR(2000) NOT NULL DEFAULT '',
  profile_description_status ENUM('draft', 'pending', 'approved', 'rejected') NOT NULL DEFAULT 'draft',
  agenda_show_time BOOLEAN NOT NULL DEFAULT TRUE,
  agenda_show_client BOOLEAN NOT NULL DEFAULT TRUE,
  agenda_show_services BOOLEAN NOT NULL DEFAULT TRUE,
  agenda_show_note BOOLEAN NOT NULL DEFAULT TRUE,
  agenda_show_add_button BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY salons_public_location (is_public, wilaya_code, city),
  CONSTRAINT salons_professional_profile_fk
    FOREIGN KEY (professional_profile_id) REFERENCES professional_profiles (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS salon_profile_entries (
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

CREATE TABLE IF NOT EXISTS salon_photos (
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
  pause_starts_at TIME NULL,
  pause_ends_at TIME NULL,
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

CREATE TABLE IF NOT EXISTS staff_members (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  salon_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(120) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY staff_members_salon_name (salon_id, name),
  KEY staff_members_active (salon_id, is_active, name),
  CONSTRAINT staff_members_salon_fk FOREIGN KEY (salon_id) REFERENCES salons (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS staff_hours (
  staff_id BIGINT UNSIGNED NOT NULL,
  weekday TINYINT UNSIGNED NOT NULL,
  opens_at TIME NOT NULL,
  closes_at TIME NOT NULL,
  pause_starts_at TIME NULL,
  pause_ends_at TIME NULL,
  PRIMARY KEY (staff_id, weekday),
  CONSTRAINT staff_hours_staff_fk FOREIGN KEY (staff_id) REFERENCES staff_members (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS staff_absences (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  staff_id BIGINT UNSIGNED NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  reason VARCHAR(180) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY staff_absences_dates (staff_id, start_date, end_date),
  CONSTRAINT staff_absences_staff_fk
    FOREIGN KEY (staff_id) REFERENCES staff_members (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS appointments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  salon_id BIGINT UNSIGNED NOT NULL,
  client_id BIGINT UNSIGNED NOT NULL,
  service_id BIGINT UNSIGNED NOT NULL,
  staff_id BIGINT UNSIGNED NULL,
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
  KEY appointments_staff_time (staff_id, status, starts_at, ends_at),
  KEY appointments_client_time (client_id, starts_at),
  CONSTRAINT appointments_salon_fk FOREIGN KEY (salon_id) REFERENCES salons (id) ON DELETE RESTRICT,
  CONSTRAINT appointments_client_fk FOREIGN KEY (client_id) REFERENCES accounts (id) ON DELETE RESTRICT,
  CONSTRAINT appointments_service_fk FOREIGN KEY (service_id) REFERENCES services (id) ON DELETE RESTRICT,
  CONSTRAINT appointments_staff_fk FOREIGN KEY (staff_id) REFERENCES staff_members (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS appointment_private_notes (
  appointment_id BIGINT UNSIGNED NOT NULL,
  note TEXT NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (appointment_id),
  CONSTRAINT appointment_private_notes_appointment_fk
    FOREIGN KEY (appointment_id) REFERENCES appointments (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS professional_client_notes (
  salon_id BIGINT UNSIGNED NOT NULL,
  client_id BIGINT UNSIGNED NOT NULL,
  note TEXT NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (salon_id, client_id),
  CONSTRAINT professional_client_notes_salon_fk
    FOREIGN KEY (salon_id) REFERENCES salons (id) ON DELETE CASCADE,
  CONSTRAINT professional_client_notes_client_fk
    FOREIGN KEY (client_id) REFERENCES accounts (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS appointment_services (
  appointment_id BIGINT UNSIGNED NOT NULL,
  position TINYINT UNSIGNED NOT NULL,
  service_id BIGINT UNSIGNED NOT NULL,
  service_name VARCHAR(180) NOT NULL,
  duration_minutes SMALLINT UNSIGNED NOT NULL,
  price_dzd BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (appointment_id, position),
  UNIQUE KEY appointment_services_unique (appointment_id, service_id),
  CONSTRAINT appointment_services_appointment_fk
    FOREIGN KEY (appointment_id) REFERENCES appointments (id) ON DELETE CASCADE,
  CONSTRAINT appointment_services_service_fk
    FOREIGN KEY (service_id) REFERENCES services (id) ON DELETE RESTRICT
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
  appointment_id BIGINT UNSIGNED NULL,
  actor_id BIGINT UNSIGNED NOT NULL,
  request_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  request_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  payment_method ENUM('cash', 'card', 'transfer', 'other', 'gift_card') NOT NULL,
  total_dzd BIGINT UNSIGNED NOT NULL,
  collected_dzd BIGINT UNSIGNED NOT NULL DEFAULT 0,
  gift_card_applied_dzd BIGINT UNSIGNED NOT NULL DEFAULT 0,
  gift_card_id BIGINT UNSIGNED NULL,
  recorded_at DATETIME NOT NULL,
  voided_at DATETIME NULL,
  voided_by BIGINT UNSIGNED NULL,
  void_reason VARCHAR(255) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY cash_sales_request (salon_id, request_key),
  UNIQUE KEY cash_sales_appointment_unique (appointment_id),
  KEY cash_sales_recorded (salon_id, recorded_at, id),
  KEY cash_sales_voided (salon_id, voided_at, id),
  CONSTRAINT cash_sales_salon_fk FOREIGN KEY (salon_id) REFERENCES salons (id),
  CONSTRAINT cash_sales_appointment_fk FOREIGN KEY (appointment_id) REFERENCES appointments (id) ON DELETE RESTRICT,
  CONSTRAINT cash_sales_actor_fk FOREIGN KEY (actor_id) REFERENCES accounts (id),
  CONSTRAINT cash_sales_void_actor_fk FOREIGN KEY (voided_by) REFERENCES accounts (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cash_sale_lines (
  sale_id BIGINT UNSIGNED NOT NULL,
  item_kind ENUM('product', 'service', 'gift_card') NOT NULL,
  item_id BIGINT UNSIGNED NOT NULL,
  item_name VARCHAR(180) NOT NULL,
  quantity INT UNSIGNED NOT NULL,
  unit_price_dzd BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (sale_id, item_kind, item_id),
  CONSTRAINT cash_sale_lines_sale_fk FOREIGN KEY (sale_id) REFERENCES cash_sales (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cash_tickets (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  salon_id BIGINT UNSIGNED NOT NULL,
  actor_id BIGINT UNSIGNED NOT NULL,
  request_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  request_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  update_request_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  update_request_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  status ENUM('pending', 'paid', 'cancelled') NOT NULL DEFAULT 'pending',
  sale_id BIGINT UNSIGNED NULL,
  revision INT UNSIGNED NOT NULL DEFAULT 1,
  total_dzd BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY cash_tickets_request (salon_id, request_key),
  UNIQUE KEY cash_tickets_sale_unique (sale_id),
  KEY cash_tickets_pending (salon_id, status, updated_at, id),
  CONSTRAINT cash_tickets_salon_fk FOREIGN KEY (salon_id) REFERENCES salons (id),
  CONSTRAINT cash_tickets_actor_fk FOREIGN KEY (actor_id) REFERENCES accounts (id),
  CONSTRAINT cash_tickets_sale_fk FOREIGN KEY (sale_id) REFERENCES cash_sales (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cash_ticket_lines (
  ticket_id BIGINT UNSIGNED NOT NULL,
  item_kind ENUM('product', 'service') NOT NULL,
  item_id BIGINT UNSIGNED NOT NULL,
  item_name VARCHAR(180) NOT NULL,
  quantity INT UNSIGNED NOT NULL,
  unit_price_dzd BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (ticket_id, item_kind, item_id),
  CONSTRAINT cash_ticket_lines_ticket_fk FOREIGN KEY (ticket_id) REFERENCES cash_tickets (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS gift_cards (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  salon_id BIGINT UNSIGNED NOT NULL,
  issued_sale_id BIGINT UNSIGNED NOT NULL,
  code_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  initial_value_dzd BIGINT UNSIGNED NOT NULL,
  balance_dzd BIGINT UNSIGNED NOT NULL,
  expires_on DATE NOT NULL,
  issued_at DATETIME NOT NULL,
  status ENUM('active', 'voided', 'expired') NOT NULL DEFAULT 'active',
  voided_at DATETIME NULL,
  voided_by BIGINT UNSIGNED NULL,
  void_reason VARCHAR(255) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY gift_cards_code_hash (code_hash),
  KEY gift_cards_salon (salon_id, issued_at, id),
  CONSTRAINT gift_cards_salon_fk FOREIGN KEY (salon_id) REFERENCES salons (id),
  CONSTRAINT gift_cards_sale_fk FOREIGN KEY (issued_sale_id) REFERENCES cash_sales (id),
  CONSTRAINT gift_cards_void_actor_fk FOREIGN KEY (voided_by) REFERENCES accounts (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE cash_sales
  ADD CONSTRAINT cash_sales_gift_card_fk FOREIGN KEY (gift_card_id) REFERENCES gift_cards (id);

CREATE TABLE IF NOT EXISTS gift_card_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  gift_card_id BIGINT UNSIGNED NOT NULL,
  sale_id BIGINT UNSIGNED NOT NULL,
  event_kind ENUM('issued', 'redeemed', 'restored') NOT NULL,
  amount_dzd BIGINT UNSIGNED NOT NULL,
  balance_after_dzd BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY gift_card_events_once (gift_card_id, sale_id, event_kind),
  KEY gift_card_events_history (gift_card_id, id),
  CONSTRAINT gift_card_events_card_fk FOREIGN KEY (gift_card_id) REFERENCES gift_cards (id),
  CONSTRAINT gift_card_events_sale_fk FOREIGN KEY (sale_id) REFERENCES cash_sales (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS subscription_plans (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(120) NOT NULL,
  monthly_price_dzd BIGINT UNSIGNED NOT NULL,
  annual_price_dzd BIGINT UNSIGNED NOT NULL,
  trial_days SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (id),
  UNIQUE KEY subscription_plans_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS professional_subscriptions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  professional_profile_id BIGINT UNSIGNED NOT NULL,
  plan_id BIGINT UNSIGNED NOT NULL,
  billing_cycle ENUM('monthly', 'annual') NOT NULL,
  price_dzd BIGINT UNSIGNED NOT NULL,
  status ENUM('trial', 'active', 'past_due', 'cancelled') NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY professional_subscriptions_profile (professional_profile_id),
  KEY professional_subscriptions_renewal (status, period_end),
  CONSTRAINT subscriptions_profile_fk FOREIGN KEY (professional_profile_id) REFERENCES professional_profiles (id),
  CONSTRAINT subscriptions_plan_fk FOREIGN KEY (plan_id) REFERENCES subscription_plans (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS subscription_payments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  subscription_id BIGINT UNSIGNED NOT NULL,
  recorded_by BIGINT UNSIGNED NOT NULL,
  amount_dzd BIGINT UNSIGNED NOT NULL,
  payment_method ENUM('cash', 'transfer', 'card', 'other') NOT NULL,
  reference VARCHAR(120) NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  paid_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY subscription_payments_reference (subscription_id, reference),
  UNIQUE KEY subscription_payments_period (subscription_id, period_start, period_end),
  KEY subscription_payments_paid (paid_at, id),
  CONSTRAINT subscription_payments_subscription_fk FOREIGN KEY (subscription_id) REFERENCES professional_subscriptions (id),
  CONSTRAINT subscription_payments_admin_fk FOREIGN KEY (recorded_by) REFERENCES accounts (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admin_account_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  account_id BIGINT UNSIGNED NOT NULL,
  admin_id BIGINT UNSIGNED NOT NULL,
  old_status ENUM('pending', 'active', 'suspended') NOT NULL,
  new_status ENUM('pending', 'active', 'suspended') NOT NULL,
  reason VARCHAR(255) NOT NULL,
  created_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY admin_account_events_history (account_id, id),
  CONSTRAINT admin_account_events_account_fk FOREIGN KEY (account_id) REFERENCES accounts (id),
  CONSTRAINT admin_account_events_admin_fk FOREIGN KEY (admin_id) REFERENCES accounts (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS marketing_campaigns (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  created_by BIGINT UNSIGNED NOT NULL,
  subject VARCHAR(200) NOT NULL,
  message_body TEXT NOT NULL,
  status ENUM('queued', 'sending', 'completed', 'cancelled') NOT NULL DEFAULT 'queued',
  created_at DATETIME NOT NULL,
  completed_at DATETIME NULL,
  PRIMARY KEY (id),
  KEY marketing_campaigns_status (status, created_at),
  CONSTRAINT marketing_campaigns_admin_fk FOREIGN KEY (created_by) REFERENCES accounts (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS marketing_campaign_recipients (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  campaign_id BIGINT UNSIGNED NOT NULL,
  account_id BIGINT UNSIGNED NOT NULL,
  recipient VARCHAR(254) NOT NULL,
  status ENUM('queued', 'sending', 'retry', 'sent', 'failed', 'cancelled') NOT NULL DEFAULT 'queued',
  attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  send_after DATETIME NOT NULL,
  locked_at DATETIME NULL,
  sent_at DATETIME NULL,
  last_error VARCHAR(255) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY marketing_campaign_account (campaign_id, account_id),
  KEY marketing_recipient_queue (status, send_after, id),
  CONSTRAINT marketing_recipient_campaign_fk FOREIGN KEY (campaign_id) REFERENCES marketing_campaigns (id),
  CONSTRAINT marketing_recipient_account_fk FOREIGN KEY (account_id) REFERENCES accounts (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS marketing_unsubscribe_tokens (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  recipient_id BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY marketing_unsubscribe_hash (token_hash),
  KEY marketing_unsubscribe_recipient (recipient_id),
  CONSTRAINT marketing_unsubscribe_recipient_fk FOREIGN KEY (recipient_id) REFERENCES marketing_campaign_recipients (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
