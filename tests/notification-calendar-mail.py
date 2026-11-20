#!/usr/bin/env python3
"""Read fake-sendmail output after running professional-agenda.py on a disposable database."""

import email.policy
import re
import sys
from email.parser import BytesParser

messages = sys.stdin.buffer.read().split(b"\n\n--- BOOKILI TEST MESSAGE ---\n")
seen = set()
for raw in messages:
    if not raw.strip():
        continue
    message = BytesParser(policy=email.policy.default).parsebytes(raw.lstrip(b"\n"))
    for part in message.walk():
        if part.get_content_type() != "text/calendar":
            continue
        calendar = part.get_payload(decode=True).decode("utf-8")
        unfolded = re.sub(r"\r?\n[ \t]", "", calendar)
        if "SUMMARY:Coupe + Soin -" not in unfolded:
            continue
        assert r"- Coupe : 30 min\, 1 500 DA\n- Soin : 45 min\, 2 000 DA" in unfolded
        assert "Coupe modifiée" not in unfolded
        seen.add(str(message["Subject"]))

assert any("confirmé" in subject for subject in seen), seen
assert any("modifié" in subject for subject in seen), seen
print("Delivered confirmation and rescheduling calendars contain saved service details.")
