CREATE TABLE client_marketing_preferences (
  account_id BIGINT UNSIGNED NOT NULL,
  consent BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (account_id),
  KEY client_marketing_consent (consent, account_id),
  CONSTRAINT client_marketing_account_fk FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE marketing_campaigns (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  created_by BIGINT UNSIGNED NOT NULL,
  subject VARCHAR(200) NOT NULL,
  message_body TEXT NOT NULL,
  status ENUM('queued', 'sending', 'completed', 'cancelled') NOT NULL DEFAULT 'queued',
  created_at DATETIME NOT NULL,
  completed_at DATETIME NULL,
  PRIMARY KEY (id),
  KEY marketing_campaigns_status (status, created_at),
  CONSTRAINT marketing_campaigns_admin_fk FOREIGN KEY (created_by) REFERENCES accounts (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE marketing_campaign_recipients (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  campaign_id BIGINT UNSIGNED NOT NULL,
  account_id BIGINT UNSIGNED NOT NULL,
  recipient VARCHAR(254) NOT NULL,
  status ENUM('queued', 'sending', 'retry', 'sent', 'failed', 'cancelled') NOT NULL DEFAULT 'queued',
  attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  send_after DATETIME NOT NULL,
  locked_at DATETIME NULL,
  sent_at DATETIME NULL,
  last_error VARCHAR(255) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY marketing_campaign_account (campaign_id, account_id),
  KEY marketing_recipient_queue (status, send_after, id),
  CONSTRAINT marketing_recipient_campaign_fk FOREIGN KEY (campaign_id) REFERENCES marketing_campaigns (id),
  CONSTRAINT marketing_recipient_account_fk FOREIGN KEY (account_id) REFERENCES accounts (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE marketing_unsubscribe_tokens (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  recipient_id BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY marketing_unsubscribe_hash (token_hash),
  KEY marketing_unsubscribe_recipient (recipient_id),
  CONSTRAINT marketing_unsubscribe_recipient_fk FOREIGN KEY (recipient_id) REFERENCES marketing_campaign_recipients (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
