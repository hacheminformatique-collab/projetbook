#!/usr/bin/env python3
"""Run against a disposable BOOKILI installation with a fresh test database."""

import http.cookiejar
import json
import os
import secrets
import urllib.error
import urllib.request

BASE = os.environ["BOOKILI_TEST_URL"].rstrip("/")


class Client:
    def __init__(self):
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar())
        )
        self.csrf = ""

    def request(self, path, body=None, csrf=True):
        headers = {}
        data = None
        if body is not None:
            data = json.dumps(body).encode()
            headers["Content-Type"] = "application/json"
            if csrf:
                headers["X-CSRF-Token"] = self.csrf
        request = urllib.request.Request(BASE + "/api/" + path, data=data, headers=headers)
        try:
            response = self.opener.open(request)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.status, json.load(response)

    def token(self):
        status, result = self.request("csrf.php")
        assert status == 200
        self.csrf = result["csrfToken"]

    def login(self, email, password):
        status, result = self.request("login.php", {"email": email, "password": password})
        if status == 200:
            self.csrf = result["csrfToken"]
        return status


def main():
    first, second = Client(), Client()
    assert first.request("client-profile.php")[0] == 401
    first.token()
    assert first.request("client-profile.php", {"phone": "0550123456"}, csrf=False)[0] == 403
    suffix = secrets.token_hex(8)
    old_password = "Ancien-mot-de-passe-123"
    new_password = "Nouveau-mot-de-passe-456"
    emails = [f"client-{suffix}-{number}@example.test" for number in (1, 2)]

    for client, email in zip((first, second), emails):
        client.token()
        status, result = client.request("register-client.php", {
            "firstName": "Test", "lastName": "Client", "email": email,
            "phone": "0550123456", "dateOfBirth": "1990-01-01", "password": old_password,
        })
        assert status == 201, (status, result)
        assert client.login(email, old_password) == 200

    status, result = first.request("client-profile.php")
    assert status == 200 and result["email"] == emails[0]
    assert result["profile"]["phone_number"] == "0550123456"
    assert first.request("client-profile.php", {"phone": "invalide"})[0] == 422
    status, result = first.request("client-profile.php", {"phone": "0660123456", "accountId": 2})
    assert status == 200 and result["profile"]["phone_number"] == "0660123456"
    assert second.request("client-profile.php")[1]["profile"]["phone_number"] == "0550123456"

    payload = {"currentPassword": "incorrect", "newPassword": new_password, "confirmPassword": new_password}
    assert first.request("client-password.php", payload)[0] == 403
    payload["currentPassword"] = old_password
    payload["confirmPassword"] = "different"
    assert first.request("client-password.php", payload)[0] == 422
    payload["newPassword"] = payload["confirmPassword"] = "x" * 73
    assert first.request("client-password.php", payload)[0] == 422
    payload["newPassword"] = payload["confirmPassword"] = new_password
    assert first.request("client-password.php", payload, csrf=False)[0] == 403
    assert first.request("client-password.php", payload)[0] == 200
    first.token()
    assert first.login(emails[0], old_password) == 401
    assert first.login(emails[0], new_password) == 200
    assert second.login(emails[1], old_password) == 200

    setup_token = os.environ.get("BOOKILI_TEST_SETUP_TOKEN")
    if setup_token:
        admin = Client()
        admin.token()
        admin_email = f"admin-{suffix}@example.test"
        status, result = admin.request("setup-admin.php", {
            "setupToken": setup_token, "email": admin_email, "password": old_password,
        })
        assert status == 201, (status, result)
        assert admin.login(admin_email, old_password) == 200
        assert admin.request("client-profile.php")[0] == 403
        assert admin.request("client-profile.php", {"phone": "0770123456"})[0] == 403
        assert admin.request("client-password.php", payload)[0] == 403

    print("Client account integration checks passed.")


if __name__ == "__main__":
    main()
