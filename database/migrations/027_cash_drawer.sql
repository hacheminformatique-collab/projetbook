CREATE TABLE IF NOT EXISTS cash_drawer_days (
  salon_id BIGINT UNSIGNED NOT NULL,
  drawer_date DATE NOT NULL,
  opening_dzd INT UNSIGNED NOT NULL,
  opened_by BIGINT UNSIGNED NOT NULL,
  opened_at DATETIME NOT NULL,
  PRIMARY KEY (salon_id, drawer_date),
  CONSTRAINT cash_drawer_days_salon_fk FOREIGN KEY (salon_id) REFERENCES salons (id),
  CONSTRAINT cash_drawer_days_actor_fk FOREIGN KEY (opened_by) REFERENCES accounts (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cash_drawer_movements (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  salon_id BIGINT UNSIGNED NOT NULL,
  drawer_date DATE NOT NULL,
  actor_id BIGINT UNSIGNED NOT NULL,
  request_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  kind ENUM('deposit', 'withdrawal', 'bank') NOT NULL,
  amount_dzd INT UNSIGNED NOT NULL,
  note VARCHAR(160) NOT NULL,
  recorded_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY cash_drawer_movement_request (salon_id, request_key),
  KEY cash_drawer_movements_day (salon_id, drawer_date, id),
  CONSTRAINT cash_drawer_movements_day_fk FOREIGN KEY (salon_id, drawer_date) REFERENCES cash_drawer_days (salon_id, drawer_date),
  CONSTRAINT cash_drawer_movements_actor_fk FOREIGN KEY (actor_id) REFERENCES accounts (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
