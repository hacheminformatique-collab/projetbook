ALTER TABLE appointments
  ADD COLUMN notification_version INT UNSIGNED NOT NULL DEFAULT 1 AFTER status;

CREATE TABLE notification_outbox (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  appointment_id BIGINT UNSIGNED NOT NULL,
  appointment_version INT UNSIGNED NOT NULL,
  kind ENUM('confirmation', 'rescheduled', 'cancelled', 'reminder_7d', 'reminder_1d') NOT NULL,
  recipient VARCHAR(254) NOT NULL,
  subject VARCHAR(200) NOT NULL,
  message_body TEXT NOT NULL,
  send_after DATETIME NOT NULL,
  status ENUM('queued', 'sending', 'retry', 'sent', 'failed', 'cancelled') NOT NULL DEFAULT 'queued',
  attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  locked_at DATETIME NULL,
  sent_at DATETIME NULL,
  last_error VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY notification_outbox_dedupe (appointment_id, appointment_version, kind),
  KEY notification_outbox_queue (status, send_after, id),
  CONSTRAINT notification_outbox_appointment_fk
    FOREIGN KEY (appointment_id) REFERENCES appointments (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
