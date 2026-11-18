CREATE TABLE salon_closures (
  salon_id BIGINT UNSIGNED NOT NULL,
  closure_date DATE NOT NULL,
  reason VARCHAR(180) NOT NULL DEFAULT '',
  PRIMARY KEY (salon_id, closure_date),
  CONSTRAINT salon_closures_salon_fk FOREIGN KEY (salon_id) REFERENCES salons (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
