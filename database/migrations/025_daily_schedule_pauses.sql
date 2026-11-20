ALTER TABLE salon_hours
  ADD COLUMN pause_starts_at TIME NULL AFTER closes_at,
  ADD COLUMN pause_ends_at TIME NULL AFTER pause_starts_at;

ALTER TABLE staff_hours
  ADD COLUMN pause_starts_at TIME NULL AFTER closes_at,
  ADD COLUMN pause_ends_at TIME NULL AFTER pause_starts_at;
