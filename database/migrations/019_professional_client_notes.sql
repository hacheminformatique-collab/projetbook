CREATE TABLE professional_client_notes (
  salon_id BIGINT UNSIGNED NOT NULL,
  client_id BIGINT UNSIGNED NOT NULL,
  note TEXT NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (salon_id, client_id),
  CONSTRAINT professional_client_notes_salon_fk
    FOREIGN KEY (salon_id) REFERENCES salons (id) ON DELETE CASCADE,
  CONSTRAINT professional_client_notes_client_fk
    FOREIGN KEY (client_id) REFERENCES accounts (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
