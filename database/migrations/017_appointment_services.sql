CREATE TABLE appointment_services (
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

INSERT INTO appointment_services (appointment_id, position, service_id, service_name, duration_minutes, price_dzd)
SELECT id, 0, service_id, service_name,
       TIMESTAMPDIFF(MINUTE, starts_at, ends_at), price_dzd
FROM appointments;

ALTER TABLE cash_sales
  ADD COLUMN appointment_id BIGINT UNSIGNED NULL AFTER salon_id,
  ADD UNIQUE KEY cash_sales_appointment_unique (appointment_id),
  ADD CONSTRAINT cash_sales_appointment_fk
    FOREIGN KEY (appointment_id) REFERENCES appointments (id) ON DELETE RESTRICT;
