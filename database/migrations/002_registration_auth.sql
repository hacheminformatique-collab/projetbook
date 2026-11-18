CREATE TABLE IF NOT EXISTS registration_rate_limits (
  action_name VARCHAR(32) NOT NULL,
  ip_hash CHAR(64) NOT NULL,
  hour_bucket BIGINT UNSIGNED NOT NULL,
  attempts SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (action_name, ip_hash, hour_bucket),
  KEY registration_rate_limits_cleanup (hour_bucket)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

ALTER TABLE professional_applications
  ADD COLUMN contact_name VARCHAR(100) NOT NULL DEFAULT '' AFTER business_name;
