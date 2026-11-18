CREATE TABLE appointment_private_notes (
  appointment_id BIGINT UNSIGNED NOT NULL,
  note TEXT NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (appointment_id),
  CONSTRAINT appointment_private_notes_appointment_fk
    FOREIGN KEY (appointment_id) REFERENCES appointments (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
