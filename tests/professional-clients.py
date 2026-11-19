#!/usr/bin/env python3
"""Use only with a fresh disposable database and a PHP test server."""

import datetime
import os
import uuid

from bookings import Client, PASSWORD, SUFFIX, expect, new_client, new_professional, salon_payload


ENDPOINT = "professional-clients.php"


def main():
    guest, admin = Client(), Client()
    admin.token()
    email = f"clients-admin-{SUFFIX}@example.test"
    expect(admin.request("setup-admin.php", {
        "setupToken": os.environ["BOOKILI_TEST_SETUP_TOKEN"], "email": email, "password": PASSWORD,
    }), 201)
    assert admin.login(email, PASSWORD) == 200
    professional, salon = new_professional(admin, 1)
    other_professional, _ = new_professional(admin, 2)
    client, _ = new_client(1), new_client(2)

    service = expect(professional.request("professional-services.php", {
        "name": "Coupe test", "category": "coiffeur", "duration": 30, "price": 1800, "isActive": True,
    }), 200)["services"][0]
    expect(professional.request("professional-salon.php", salon_payload(salon)), 200)
    date = (
        datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=1))).date()
        + datetime.timedelta(days=30)
    ).isoformat()
    booking = {
        "action": "book", "salonId": int(salon["id"]), "serviceId": int(service["id"]),
        "date": date, "time": "10:00", "expectedPrice": 1800, "expectedDuration": 30,
    }
    appointment_id = expect(client.request("appointments.php", booking), 201)["appointmentId"]
    appointment_note = "Coupe en douceur à privilégier."
    expect(professional.request("professional-agenda.php", {
        "appointmentId": appointment_id, "note": appointment_note,
    }), 200)

    expect(guest.request(ENDPOINT), 401)
    expect(client.request(ENDPOINT), 403)
    assert expect(other_professional.request(ENDPOINT), 200)["clients"] == []
    directory = expect(professional.request(ENDPOINT), 200)
    assert directory["total"] == 1 and len(directory["clients"]) == 1
    row = directory["clients"][0]
    assert row["first_name"] == "Client 1" and row["email"] == f"client-{SUFFIX}-1@example.test"
    assert row["appointment_count"] == 1
    for query in ("Client 1", "0550123456", f"client-{SUFFIX}-1@example.test"):
        assert len(expect(professional.request(f"{ENDPOINT}?q={query.replace(' ', '%20')}"), 200)["clients"]) == 1
    expect(professional.request(ENDPOINT + "?q=C"), 422)

    detail_path = f"{ENDPOINT}?clientId={row['id']}"
    expect(guest.request(detail_path), 401)
    expect(client.request(detail_path), 403)
    expect(other_professional.request(detail_path), 404)
    detail = expect(professional.request(detail_path), 200)
    assert detail["client"]["private_note"] == ""
    assert detail["client"]["appointment_count"] == 1
    assert len(detail["appointments"]) == 1 and detail["appointments"][0]["private_note"] == appointment_note

    note = "Préférence : prévenir avant le brushing.\nInformations privées au salon."
    save = {"action": "save_note", "clientId": row["id"], "note": note}
    expect(professional.request(ENDPOINT, save, csrf=False), 403)
    expect(client.request(ENDPOINT, save), 403)
    expect(other_professional.request(ENDPOINT, save), 404)
    expect(professional.request(ENDPOINT, {**save, "note": "x" * 4001}), 422)
    saved = expect(professional.request(ENDPOINT, save), 200)
    assert saved["updatedAt"]
    detail = expect(professional.request(detail_path), 200)
    assert detail["client"]["private_note"] == note
    assert detail["appointments"][0]["private_note"] == appointment_note

    expect(professional.request(ENDPOINT, {**save, "note": ""}), 200)
    assert expect(professional.request(detail_path), 200)["client"]["private_note"] == ""
    expect(professional.request(ENDPOINT + "?clientId=999999"), 404)
    expect(professional.request(ENDPOINT + "?page=0"), 422)
    print("Professional client checks passed: search, history, private notes and salon isolation.")


if __name__ == "__main__":
    main()
