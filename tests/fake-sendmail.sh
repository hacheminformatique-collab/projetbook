#!/bin/sh
set -eu
if [ "${BOOKILI_TEST_MAIL_FAIL:-}" = "1" ]; then
  exit 75
fi
if [ -z "${BOOKILI_TEST_MAILBOX:-}" ]; then
  exit 64
fi
cat >> "$BOOKILI_TEST_MAILBOX"
printf '\n\n--- BOOKILI TEST MESSAGE ---\n' >> "$BOOKILI_TEST_MAILBOX"
