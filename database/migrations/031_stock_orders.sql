CREATE TABLE IF NOT EXISTS stock_orders (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  salon_id BIGINT UNSIGNED NOT NULL,
  supplier_id BIGINT UNSIGNED NOT NULL,
  supplier_name VARCHAR(120) NOT NULL,
  reference VARCHAR(80) NOT NULL DEFAULT '',
  status ENUM('open', 'partial', 'received', 'cancelled') NOT NULL DEFAULT 'open',
  request_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  request_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY stock_orders_request (salon_id, request_key),
  KEY stock_orders_list (salon_id, id),
  CONSTRAINT stock_orders_supplier_fk FOREIGN KEY (salon_id, supplier_id) REFERENCES stock_suppliers (salon_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS stock_order_items (
  order_id BIGINT UNSIGNED NOT NULL,
  product_id BIGINT UNSIGNED NOT NULL,
  product_name VARCHAR(180) NOT NULL,
  ordered_quantity INT UNSIGNED NOT NULL,
  received_quantity INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (order_id, product_id),
  CONSTRAINT stock_order_items_order_fk FOREIGN KEY (order_id) REFERENCES stock_orders (id),
  CONSTRAINT stock_order_items_product_fk FOREIGN KEY (product_id) REFERENCES products (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS stock_order_receipts (
  order_id BIGINT UNSIGNED NOT NULL,
  request_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  request_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY (order_id, request_key),
  CONSTRAINT stock_order_receipts_order_fk FOREIGN KEY (order_id) REFERENCES stock_orders (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
