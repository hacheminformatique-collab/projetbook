#!/usr/bin/env python3
"""Use only with a fresh disposable database and a PHP test server."""

import datetime
import importlib.util
import os
import pathlib
import uuid

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
    expected_display = {
        "showTime": True, "showClient": True, "showServices": True,
        "showNote": True, "showAddButton": True,
    }
    assert agenda["displaySettings"] == expected_display and agenda["services"]
    settings_path = "professional-agenda-settings.php"
    expect(guest.request(settings_path), 401)
    expect(client.request(settings_path), 403)
    assert expect(professional.request(settings_path), 200)["settings"] == expected_display
    custom_display = {**expected_display, "showNote": False, "showAddButton": False}
    expect(professional.request(settings_path, {"settings": custom_display}, csrf=False), 403)
    expect(professional.request(settings_path, {"settings": {**custom_display, "showTime": "yes"}}), 422)
    saved_display = expect(professional.request(settings_path, {"settings": custom_display}), 200)
    assert saved_display["settings"] == custom_display
    assert expect(professional.request(agenda_path), 200)["displaySettings"] == custom_display
    expect(professional.request(settings_path, {"settings": expected_display}), 200)
    expect(guest.request(f"professional-agenda.php?clients=Client"), 401)
    expect(client.request(f"professional-agenda.php?clients=Client"), 403)
    found = expect(professional.request(f"professional-agenda.php?clients=Client%201"), 200)["clients"]
    assert len(found) == 1 and found[0]["first_name"] == "Client 1"
    assert found[0]["email"] == f"client-{booking.SUFFIX}-1@example.test"
    assert expect(other_pro.request(f"professional-agenda.php?clients=Client%201"), 200)["clients"] == []
    note = {"appointmentId": appointment_id, "note": "Note confidentielle épreuve"}
    expect(professional.request("professional-agenda.php", note, csrf=False), 403)
    expect(client.request("professional-agenda.php", note), 403)
    expect(other_pro.request("professional-agenda.php", note), 404)
    expect(professional.request("professional-agenda.php", {**note, "note": "é" * 2001}), 422)
    expect(professional.request("professional-agenda.php", note), 200)
    agenda = expect(professional.request(agenda_path), 200)
    assert next(item for item in agenda["appointments"] if item["id"] == appointment_id)["private_note"] == note["note"]
    assert "private_note" not in expect(client.request("appointments.php"), 200)["appointments"][0]
    history_path = f"professional-agenda.php?historyFor={appointment_id}"
    expect(guest.request(history_path), 401)
    expect(client.request(history_path), 403)
    expect(other_pro.request(history_path), 404)
    assert expect(professional.request(history_path), 200)["history"] == []

    multiple = expect(professional.request("appointments.php", {
        "action": "book", "clientId": int(found[0]["id"]),
        "serviceIds": [int(service["id"]), int(alternate["id"])],
        "date": day, "time": "13:00", "expectedPrice": 3500, "expectedDuration": 75,
    }), 201)["appointmentId"]
    client_appointments = expect(client.request("appointments.php"), 200)["appointments"]
    client_multiple = next(item for item in client_appointments if int(item["id"]) == multiple)
    assert int(client_multiple["service_count"]) == 2
    assert [item["id"] for item in client_multiple["services"]] == [int(service["id"]), int(alternate["id"])]
    assert not any(int(item["id"]) == multiple for item in expect(other_client.request("appointments.php"), 200)["appointments"])
    move_client = {
        "action": "reschedule", "appointmentId": multiple,
        "serviceIds": [int(service["id"]), int(alternate["id"])], "date": day,
        "time": "13:15", "expectedPrice": 3500, "expectedDuration": 75,
    }
    multi_availability = f"availability.php?salonId={int(salon['id'])}&serviceIds={service['id']},{alternate['id']}&date={day}&appointmentId={multiple}"
    assert "13:15" in expect(client.request(multi_availability), 200)["slots"]
    expect(other_client.request(multi_availability), 404)
    expect(client.request("appointments.php", {**move_client, "time": "09:00"}), 409)
    expect(client.request("appointments.php", {**move_client, "expectedPrice": 1}), 409)
    before_move = next(item for item in expect(client.request("appointments.php"), 200)["appointments"] if int(item["id"]) == multiple)
    assert before_move["starts_at"].endswith("13:00:00") and len(before_move["services"]) == 2
    expect(client.request("appointments.php", move_client), 200)
    after_move = next(item for item in expect(client.request("appointments.php"), 200)["appointments"] if int(item["id"]) == multiple)
    assert after_move["starts_at"].endswith("13:15:00") and after_move["ends_at"].endswith("14:30:00")
    assert [item["id"] for item in after_move["services"]] == [int(service["id"]), int(alternate["id"])]
    booking_day = (datetime.date.fromisoformat(day) + datetime.timedelta(days=10)).isoformat()
    multi_booking = {
        "action": "book", "salonId": int(salon["id"]),
        "serviceIds": [int(service["id"]), int(alternate["id"])],
        "date": booking_day, "time": "11:00", "expectedPrice": 3500, "expectedDuration": 75,
    }
    multi_booking_availability = f"availability.php?salonId={int(salon['id'])}&serviceIds={service['id']},{alternate['id']}&date={booking_day}"
    initial_slots = expect(guest.request(multi_booking_availability), 200)["slots"]
    assert len(initial_slots) == 28 and initial_slots[0] == "09:00" and initial_slots[-1] == "15:45"
    assert "11:00" in initial_slots
    expect(client.request("appointments.php", {**multi_booking, "expectedPrice": 1500}), 409)
    expect(client.request("appointments.php", {**multi_booking, "expectedDuration": 30}), 409)
    expect(client.request("appointments.php", {**multi_booking, "serviceIds": [int(service["id"]), int(service["id"])]}), 422)
    booked_id = expect(client.request("appointments.php", multi_booking), 201)["appointmentId"]
    booked = next(item for item in expect(client.request("appointments.php"), 200)["appointments"] if int(item["id"]) == booked_id)
    assert booked["service_name"] == "Coupe + Soin" and int(booked["price_dzd"]) == 3500
    assert booked["starts_at"].endswith("11:00:00") and booked["ends_at"].endswith("12:15:00")
    assert [item["id"] for item in booked["services"]] == [int(service["id"]), int(alternate["id"])]
    assert "12:00" not in expect(guest.request(multi_booking_availability), 200)["slots"]
    expect(other_client.request("appointments.php", {**multi_booking, "time": "12:00"}), 409)
    new_email = f"walk-in-{booking.SUFFIX}@example.test"
    new_phone = "0550998765"
    walk_in = expect(professional.request("appointments.php", {
        "action": "book",
        "newClient": {
            "firstName": "Nouveau", "lastName": "Client", "email": new_email,
            "phone": new_phone, "dateOfBirth": "1994-05-06",
        },
        "serviceIds": [int(service["id"]), int(alternate["id"])],
        "date": day, "time": "15:00", "expectedPrice": 3500, "expectedDuration": 75,
    }), 201)["appointmentId"]
    assert not expect(other_pro.request(f"professional-agenda.php?clients={new_phone}"), 200)["clients"]
    matches = expect(professional.request(f"professional-agenda.php?clients={new_phone}"), 200)["clients"]
    assert len(matches) == 1 and matches[0]["email"] == new_email
    expect(professional.request("appointments.php", {
        "action": "book", "newClient": {"firstName": "Autre", "lastName": "Client", "email": new_email,
            "phone": "0550111111", "dateOfBirth": "1994-05-06"},
        "serviceIds": [int(service["id"])], "date": day, "time": "16:30",
        "expectedPrice": 1500, "expectedDuration": 30,
    }), 409)
    multi_move = {"action": "reschedule", "appointmentId": multiple, "serviceIds": [int(service["id"]), int(alternate["id"])],
        "date": day, "time": "15:00", "expectedPrice": 3500, "expectedDuration": 75}
    multi_appointment = next(item for item in expect(professional.request(agenda_path), 200)["appointments"] if item["id"] == multiple)
    assert multi_appointment["service_name"] == "Coupe + Soin" and int(multi_appointment["price_dzd"]) == 3500
    assert [item["id"] for item in multi_appointment["services"]] == [int(service["id"]), int(alternate["id"])]
    assert multi_appointment["ends_at"].endswith("14:30:00")
    invalid_cash = {
        "action": "record", "appointmentId": multiple, "requestKey": str(uuid.uuid4()), "paymentMethod": "cash",
        "lines": [{"kind": "service", "id": int(service["id"]), "quantity": 1, "expectedPrice": 1500}],
    }
    expect(professional.request("professional-cash.php", invalid_cash), 409)
    cash = expect(professional.request("professional-cash.php", {
        **invalid_cash, "requestKey": str(uuid.uuid4()),
        "lines": [
            {"kind": "service", "id": int(service["id"]), "quantity": 1, "expectedPrice": 1500},
            {"kind": "service", "id": int(alternate["id"]), "quantity": 1, "expectedPrice": 2000},
        ],
    }), 201)
    assert cash["totalDzd"] == 3500 and cash["collectedDzd"] == 3500
    expect(professional.request("appointments.php", {**multi_move, "time": "15:00"}), 409)
    expect(professional.request("appointments.php", {"action": "cancel", "appointmentId": multiple}), 409)
    expect(professional.request("professional-cash.php", {
        **invalid_cash, "requestKey": str(uuid.uuid4()),
        "lines": [
            {"kind": "service", "id": int(service["id"]), "quantity": 1, "expectedPrice": 1500},
            {"kind": "service", "id": int(alternate["id"]), "quantity": 1, "expectedPrice": 2000},
        ],
    }), 409)
    assert next(item for item in expect(professional.request(agenda_path), 200)["appointments"] if item["id"] == multiple)["cash_sale_id"] == cash["saleId"]
    assert next(item for item in expect(professional.request(agenda_path), 200)["appointments"] if item["id"] == walk_in)["client_id"] == matches[0]["id"]

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
    absence_start = (datetime.date.fromisoformat(day) + datetime.timedelta(days=2)).isoformat()
    absence_end = (datetime.date.fromisoformat(day) + datetime.timedelta(days=3)).isoformat()
    absences_path = "professional-staff-absences.php"
    expect(guest.request(absences_path), 401)
    expect(client.request(absences_path), 403)
    assert expect(other_pro.request(absences_path), 200)["absences"] == []
    absence = {
        "action": "add", "staffId": int(members[0]["id"]), "startDate": absence_start,
        "endDate": absence_end, "reason": "Congé privé",
    }
    expect(professional.request(absences_path, absence, csrf=False), 403)
    expect(other_pro.request(absences_path, absence), 404)
    expect(professional.request(absences_path, {**absence, "endDate": day}), 422)
    expect(professional.request(absences_path, {**absence, "reason": "x" * 181}), 422)
    expect(professional.request(absences_path, absence), 200)
    absences = expect(professional.request(absences_path), 200)
    assert len(absences["absences"]) == 1
    absence_id = absences["absences"][0]["id"]
    expect(professional.request(absences_path, absence), 409)
    absent_slots = f"availability.php?salonId={salon['id']}&serviceId={service['id']}&date={absence_start}&appointmentId={appointment_id}&staffId={members[0]['id']}"
    available_slots = absent_slots.replace(f"staffId={members[0]['id']}", f"staffId={members[1]['id']}")
    absent_availability = expect(professional.request(absent_slots), 200)
    assert absent_availability["slots"] == []
    assert next(item for item in absent_availability["staff"] if item["id"] == int(members[0]["id"]))["is_absent"] is True
    available_availability = expect(professional.request(available_slots), 200)
    assert available_availability["slots"]
    assert next(item for item in available_availability["staff"] if item["id"] == int(members[1]["id"]))["is_absent"] is False
    absent_booking = {
        "action": "book", "clientId": int(found[0]["id"]), "serviceIds": [int(service["id"])],
        "staffId": int(members[0]["id"]), "date": absence_start, "time": "09:00",
        "expectedPrice": 1500, "expectedDuration": 30,
    }
    expect(professional.request("appointments.php", absent_booking), 409)
    agenda_absence = expect(professional.request(f"professional-agenda.php?date={absence_start}"), 200)
    assert agenda_absence["staffAbsences"] == [{
        "staff_id": int(members[0]["id"]), "reason": "Congé privé",
    }]
    expect(other_pro.request(absences_path, {
        "action": "remove", "absenceId": absence_id,
    }), 404)
    expect(professional.request(absences_path, {
        "action": "remove", "absenceId": absence_id,
    }), 200)
    assert expect(professional.request(absent_slots), 200)["slots"]
    expect(professional.request("appointments.php", absent_booking), 201)
    for member in members:
        expect(professional.request("appointments.php", {
            **move, "time": "12:00", "staffId": int(member["id"]),
        }), 200)
    current = next(item for item in expect(professional.request(agenda_path), 200)["appointments"] if item["id"] == appointment_id)
    assert int(current["staff_id"]) == int(members[1]["id"])
    expect(professional.request(absences_path, {
        **absence, "staffId": int(members[1]["id"]), "startDate": day, "endDate": day,
    }), 409)
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
