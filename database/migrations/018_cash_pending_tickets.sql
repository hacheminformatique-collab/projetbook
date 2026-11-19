CREATE TABLE cash_tickets (
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

CREATE TABLE cash_ticket_lines (
  ticket_id BIGINT UNSIGNED NOT NULL,
  item_kind ENUM('product', 'service') NOT NULL,
  item_id BIGINT UNSIGNED NOT NULL,
  item_name VARCHAR(180) NOT NULL,
  quantity INT UNSIGNED NOT NULL,
  unit_price_dzd BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (ticket_id, item_kind, item_id),
  CONSTRAINT cash_ticket_lines_ticket_fk FOREIGN KEY (ticket_id) REFERENCES cash_tickets (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
