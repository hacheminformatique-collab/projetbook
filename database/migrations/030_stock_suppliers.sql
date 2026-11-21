CREATE TABLE IF NOT EXISTS stock_suppliers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  salon_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(120) NOT NULL,
  phone VARCHAR(40) NOT NULL DEFAULT '',
  email VARCHAR(254) NOT NULL DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (id),
  UNIQUE KEY stock_suppliers_salon_id (salon_id, id),
  CONSTRAINT stock_suppliers_salon_fk FOREIGN KEY (salon_id) REFERENCES salons (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE products
  ADD COLUMN supplier_id BIGINT UNSIGNED NULL DEFAULT NULL,
  ADD KEY products_salon_supplier (salon_id, supplier_id),
  ADD CONSTRAINT products_supplier_fk FOREIGN KEY (salon_id, supplier_id) REFERENCES stock_suppliers (salon_id, id) ON DELETE RESTRICT;
