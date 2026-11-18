#!/usr/bin/env python3
"""Use only with a fresh disposable database and a PHP test server."""

import datetime
import importlib.util
import os
import pathlib

spec = importlib.util.spec_from_file_location("booking_tests", pathlib.Path(__file__).with_name("bookings.py"))
booking = importlib.util.module_from_spec(spec)
spec.loader.exec_module(booking)
Client, expect = booking.Client, booking.expect


def main():
    guest, admin = Client(), Client()
    admin.token()
    email = f"agenda-admin-{booking.SUFFIX}@example.test"
    expect(admin.request("setup-admin.php", {
        "setupToken": os.environ["BOOKILI_TEST_SETUP_TOKEN"], "email": email, "password": booking.PASSWORD,
    }), 201)
    assert admin.login(email, booking.PASSWORD) == 200
    client, other_client = booking.new_client(1), booking.new_client(2)
    professional, salon = booking.new_professional(admin, 1)
    other_pro, _ = booking.new_professional(admin, 2)
    service_payload = {"name": "Coupe", "category": "coiffeur", "duration": 30, "price": 1500, "isActive": True}
    service = expect(professional.request("professional-services.php", service_payload), 200)["services"][0]
    alternate = expect(professional.request("professional-services.php", {
        **service_payload, "name": "Soin", "duration": 45, "price": 2000,
    }), 200)["services"][-1]
    expect(professional.request("professional-salon.php", booking.salon_payload(salon)), 200)
    day = (datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=1))).date() + datetime.timedelta(days=30)).isoformat()
    base = {
        "action": "book", "salonId": int(salon["id"]), "serviceId": int(service["id"]),
        "date": day, "time": "09:00", "expectedPrice": 1500, "expectedDuration": 30,
    }
    appointment_id = expect(client.request("appointments.php", base), 201)["appointmentId"]
    expect(other_client.request("appointments.php", {**base, "time": "10:00"}), 201)
    agenda_path = f"professional-agenda.php?date={day}"
    expect(guest.request(agenda_path), 401)
    expect(client.request(agenda_path), 403)
    assert not expect(other_pro.request(agenda_path), 200)["appointments"]
    agenda = expect(professional.request(agenda_path), 200)
    assert len(agenda["appointments"]) == 2 and agenda["hours"]["opens_at"] == "09:00:00"
    note = {"appointmentId": appointment_id, "note": "Note confidentielle épreuve"}
    expect(professional.request("professional-agenda.php", note, csrf=False), 403)
    expect(client.request("professional-agenda.php", note), 403)
    expect(other_pro.request("professional-agenda.php", note), 404)
    expect(professional.request("professional-agenda.php", {**note, "note": "é" * 2001}), 422)
    expect(professional.request("professional-agenda.php", note), 200)
    agenda = expect(professional.request(agenda_path), 200)
    assert next(item for item in agenda["appointments"] if item["id"] == appointment_id)["private_note"] == note["note"]
    assert "private_note" not in expect(client.request("appointments.php"), 200)["appointments"][0]

    available = f"availability.php?salonId={salon['id']}&serviceId={service['id']}&date={day}&appointmentId={appointment_id}"
    assert "09:00" in expect(professional.request(available), 200)["slots"]
    expect(other_pro.request(available), 404)
    expect(other_client.request(available), 404)
    move = {**base, "action": "reschedule", "appointmentId": appointment_id}
    expect(other_pro.request("appointments.php", {**move, "time": "11:00"}), 404)
    expect(professional.request("appointments.php", {**move, "time": "10:00"}), 409)
    assert expect(client.request("appointments.php"), 200)["appointments"][0]["starts_at"].endswith("09:00:00")
    expect(professional.request("professional-salon.php", booking.salon_payload(salon, public=False)), 200)
    expect(client.request(available), 404)
    assert "09:00" in expect(professional.request(available), 200)["slots"]
    expect(professional.request("appointments.php", {
        **move, "time": "11:00", "serviceId": int(alternate["id"]), "expectedPrice": 2000, "expectedDuration": 45,
    }), 200)
    changed = expect(client.request("appointments.php"), 200)["appointments"][0]
    assert changed["service_name"] == "Soin" and int(changed["price_dzd"]) == 2000
    assert changed["starts_at"].endswith("11:00:00") and changed["ends_at"].endswith("11:45:00")
    assert next(item for item in expect(professional.request(agenda_path), 200)["appointments"] if item["id"] == appointment_id)["private_note"] == note["note"]
    expect(professional.request("professional-agenda.php", {**note, "note": ""}), 200)
    assert next(item for item in expect(professional.request(agenda_path), 200)["appointments"] if item["id"] == appointment_id)["private_note"] == ""

    members = []
    for name in ("Equipe A", "Equipe B"):
        staff = expect(professional.request("professional-staff.php", {
            "action": "save", "name": name, "isActive": True,
        }), 200)["staff"]
        members.append(next(item for item in staff if item["name"] == name))
    for member in members:
        expect(professional.request("appointments.php", {
            **move, "time": "12:00", "staffId": int(member["id"]),
        }), 200)
    current = next(item for item in expect(professional.request(agenda_path), 200)["appointments"] if item["id"] == appointment_id)
    assert int(current["staff_id"]) == int(members[1]["id"])
    expect(professional.request("professional-staff.php", {
        "action": "save", "staffId": int(members[1]["id"]), "name": members[1]["name"], "isActive": False,
    }), 200)
    agenda = expect(professional.request(agenda_path), 200)
    assert any(not int(member["is_active"]) and int(member["id"]) == int(members[1]["id"]) for member in agenda["staff"])
    assert any(int(item["staff_id"] or 0) == int(members[1]["id"]) for item in agenda["appointments"])
    assert any(item["staff_id"] is None for item in agenda["appointments"])
    expect(professional.request("professional-agenda.php?date=2026-02-30"), 422)
    closed_day = (datetime.date.fromisoformat(day) + datetime.timedelta(days=1)).isoformat()
    expect(professional.request("professional-closures.php", {"action": "add", "date": closed_day}), 200)
    closed_agenda = expect(professional.request(f"professional-agenda.php?date={closed_day}"), 200)
    assert closed_agenda["closed"] is True and not closed_agenda["appointments"]
    print("Professional agenda integration checks passed.")


if __name__ == "__main__":
    main()
