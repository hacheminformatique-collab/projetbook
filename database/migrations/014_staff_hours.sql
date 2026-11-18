CREATE TABLE staff_hours (
  staff_id BIGINT UNSIGNED NOT NULL,
  weekday TINYINT UNSIGNED NOT NULL,
  opens_at TIME NOT NULL,
  closes_at TIME NOT NULL,
  PRIMARY KEY (staff_id, weekday),
  CONSTRAINT staff_hours_staff_fk FOREIGN KEY (staff_id) REFERENCES staff_members (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO staff_hours (staff_id, weekday, opens_at, closes_at)
SELECT sm.id, sh.weekday, sh.opens_at, sh.closes_at
FROM staff_members sm
INNER JOIN salon_hours sh ON sh.salon_id = sm.salon_id;
