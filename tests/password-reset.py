#!/usr/bin/env python3
"""Use a fresh disposable database and capture PHP sendmail output to a file."""

import os
import re
from pathlib import Path

from bookings import Client, PASSWORD, SUFFIX, expect, new_client, new_professional


def main():
    mailbox = Path(os.environ["BOOKILI_TEST_MAILBOX"])
    admin, guest = Client(), Client()
    admin.token()
    guest.token()
    admin_email = f"admin-{SUFFIX}@example.test"
    expect(admin.request("setup-admin.php", {
        "setupToken": os.environ["BOOKILI_TEST_SETUP_TOKEN"],
        "email": admin_email, "password": PASSWORD,
    }), 201)
    assert admin.login(admin_email, PASSWORD) == 200
    professional, _ = new_professional(admin, 1)
    client = new_client(1)
    accepted = expect(guest.request("password-reset.php", {
        "action": "request", "email": "unknown@example.test",
    }), 200)
    assert expect(guest.request("password-reset.php", {
        "action": "request", "email": admin_email,
    }), 200) == accepted
    assert not mailbox.exists() or not mailbox.read_bytes()

    def captured_links():
        return re.findall(r"/nouveau-mot-de-passe#token=([a-f0-9]{64})&espace=(\w+)", mailbox.read_text())

    new_password = "Un-nouveau-mot-de-passe-123"
    for index, (account, email, portal, protected) in enumerate([
        (client, f"client-{SUFFIX}-1@example.test", "compte", "client-profile.php"),
        (professional, professional.email, "professionnels", "professional-salon.php"),
    ], start=1):
        request = {"action": "request", "email": email}
        expect(guest.request("password-reset.php", request, csrf=False), 403)
        assert expect(guest.request("password-reset.php", request), 200) == accepted
        assert expect(guest.request("password-reset.php", request), 200) == accepted
        links = captured_links()
        assert len(links) == index and links[-1][1] == portal
        reset = {"action": "reset", "token": links[-1][0], "password": new_password}
        expect(guest.request("password-reset.php", {**reset, "confirmPassword": PASSWORD}), 422)
        reset["confirmPassword"] = new_password
        expect(guest.request("password-reset.php", reset), 200)
        expect(guest.request("password-reset.php", reset), 422)
        expect(account.request(protected), 401)
        assert not expect(account.request("session.php"), 200)["authenticated"]
        account.token()
        assert account.login(email, PASSWORD) == 401
        assert account.login(email, new_password) == 200

    print("Password reset checks passed for client and professional accounts.")


if __name__ == "__main__":
    main()
