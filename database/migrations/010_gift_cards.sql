CREATE TABLE gift_cards (
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

CREATE TABLE gift_card_events (
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

ALTER TABLE cash_sales
  MODIFY payment_method ENUM('cash', 'card', 'transfer', 'other', 'gift_card') NOT NULL,
  ADD COLUMN collected_dzd BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER total_dzd,
  ADD COLUMN gift_card_applied_dzd BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER collected_dzd,
  ADD COLUMN gift_card_id BIGINT UNSIGNED NULL AFTER gift_card_applied_dzd;

ALTER TABLE cash_sale_lines
  MODIFY item_kind ENUM('product', 'service', 'gift_card') NOT NULL;

ALTER TABLE cash_sales
  ADD CONSTRAINT cash_sales_gift_card_fk FOREIGN KEY (gift_card_id) REFERENCES gift_cards (id);

UPDATE cash_sales SET collected_dzd = total_dzd;
