CREATE TABLE IF NOT EXISTS platform_setup (
  id TINYINT UNSIGNED NOT NULL,
  super_admin_created BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

INSERT IGNORE INTO platform_setup (id, super_admin_created) VALUES (1, FALSE);
