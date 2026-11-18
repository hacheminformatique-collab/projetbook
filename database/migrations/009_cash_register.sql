CREATE TABLE cash_sales (
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

CREATE TABLE cash_sale_lines (
  sale_id BIGINT UNSIGNED NOT NULL,
  item_kind ENUM('product', 'service') NOT NULL,
  item_id BIGINT UNSIGNED NOT NULL,
  item_name VARCHAR(180) NOT NULL,
  quantity INT UNSIGNED NOT NULL,
  unit_price_dzd BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (sale_id, item_kind, item_id),
  CONSTRAINT cash_sale_lines_sale_fk FOREIGN KEY (sale_id) REFERENCES cash_sales (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
