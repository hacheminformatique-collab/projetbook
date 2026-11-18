ALTER TABLE accounts ADD COLUMN session_version INT UNSIGNED NOT NULL DEFAULT 0;

CREATE TABLE password_resets (
  account_id BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  session_version INT UNSIGNED NOT NULL,
  expires_at DATETIME NOT NULL,
  PRIMARY KEY (account_id),
  UNIQUE KEY password_resets_token (token_hash),
  CONSTRAINT password_resets_account_fk FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
