ALTER TABLE marketing_campaigns
  ADD COLUMN request_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER message_body,
  ADD COLUMN expected_recipients SMALLINT UNSIGNED NULL AFTER request_key,
  ADD UNIQUE KEY marketing_campaigns_request_key (request_key);
