CREATE TABLE subscription_plans (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(120) NOT NULL,
  monthly_price_dzd BIGINT UNSIGNED NOT NULL,
  annual_price_dzd BIGINT UNSIGNED NOT NULL,
  trial_days SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (id),
  UNIQUE KEY subscription_plans_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE professional_subscriptions (
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

CREATE TABLE subscription_payments (
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

CREATE TABLE admin_account_events (
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
