ALTER TABLE appointments
  MODIFY COLUMN status ENUM('confirmed', 'cancelled', 'no_show') NOT NULL DEFAULT 'confirmed',
  ADD COLUMN no_show_at DATETIME NULL DEFAULT NULL AFTER status;
