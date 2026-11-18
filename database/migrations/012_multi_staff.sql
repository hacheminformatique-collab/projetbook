CREATE TABLE staff_members (
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

ALTER TABLE appointments
  ADD COLUMN staff_id BIGINT UNSIGNED NULL AFTER service_id,
  ADD KEY appointments_staff_time (staff_id, status, starts_at, ends_at),
  ADD CONSTRAINT appointments_staff_fk FOREIGN KEY (staff_id) REFERENCES staff_members (id);
