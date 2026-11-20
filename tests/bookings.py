#!/usr/bin/env python3
"""Use only with a fresh disposable database and a multi-worker PHP server."""

import concurrent.futures
import datetime
import importlib.util
import os
import pathlib
import secrets
import threading
import urllib.error
import urllib.request

spec = importlib.util.spec_from_file_location("account_tests", pathlib.Path(__file__).with_name("client-account.py"))
account_tests = importlib.util.module_from_spec(spec)
spec.loader.exec_module(account_tests)
Client = account_tests.Client
PASSWORD = "Mot-de-passe-test-123"
SUFFIX = secrets.token_hex(5)


def expect(response, status):
    actual, result = response
    assert actual == status, (actual, status, result)
    return result


def expect_empty_response(client, path, status):
    request = urllib.request.Request(account_tests.BASE + "/api/" + path)
    try:
        response = client.opener.open(request)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        assert response.status == status
        assert response.read() == b""


def new_client(number, marketing_consent=False):
    client = Client()
    client.token()
    email = f"client-{SUFFIX}-{number}@example.test"
    expect(client.request("register-client.php", {
        "firstName": f"Client {number}", "lastName": "Test", "email": email,
        "phone": "0550123456", "dateOfBirth": "1990-01-01", "password": PASSWORD,
        "marketingConsent": marketing_consent,
    }), 201)
    assert client.login(email, PASSWORD) == 200
    return client


def new_professional(admin, number):
    professional = Client()
    professional.token()
    email = f"pro-{SUFFIX}-{number}@example.test"
    expect(professional.request("register-professional.php", {
        "businessName": f"Salon {SUFFIX} {number}", "contactName": "Responsable Test", "email": email,
        "phone": "0550123456", "password": PASSWORD, "category": "coiffeur",
        "wilaya": "19", "city": "Setif", "address": "10 rue de test",
    }), 201)
    assert professional.login(email, PASSWORD) == 403
    applications = expect(admin.request("commercial-applications.php"), 200)["applications"]
    application = next(row for row in applications if row["email"] == email)
    expect(admin.request("review-application.php", {"applicationId": application["id"], "decision": "approve"}), 200)
    assert professional.login(email, PASSWORD) == 200
    professional.email = email
    configuration = expect(professional.request("professional-salon.php"), 200)
    return professional, configuration["salon"]


def salon_payload(salon, public=True):
    return {
        "name": salon["name"], "city": salon["city"], "address": salon["address"],
        "phone": salon["phone_number"], "wilaya": salon["wilaya_code"], "isPublic": public,
        "bookingMessage": salon.get("booking_message", ""),
        "hours": [{"weekday": day, "opens_at": "09:00", "closes_at": "17:00"} for day in range(1, 8)],
    }


def main():
    guest, admin = Client(), Client()
    admin.token()
    email = f"admin-{SUFFIX}@example.test"
    expect(admin.request("setup-admin.php", {
        "setupToken": os.environ["BOOKILI_TEST_SETUP_TOKEN"], "email": email, "password": PASSWORD,
    }), 201)
    assert admin.login(email, PASSWORD) == 200
    first, second = new_client(1, marketing_consent=True), new_client(2)
    professional, salon = new_professional(admin, 1)
    other_pro, other_salon = new_professional(admin, 2)
    salon_id = int(salon["id"])
    expect(guest.request("professional-salon.php"), 401)
    expect(first.request("professional-services.php"), 403)
    expect(guest.request(f"salons.php?id={salon_id}"), 404)
    expect(professional.request("professional-salon.php", salon_payload(salon)), 422)

    service_payload = {"name": "Coupe test", "category": "coiffeur", "duration": 30, "price": 1500, "isActive": True}
    expect(professional.request("professional-services.php", {**service_payload, "duration": 0}), 422)
    services = expect(professional.request("professional-services.php", service_payload), 200)["services"]
    service_id = int(services[0]["id"])
    expect(other_pro.request("professional-services.php", {**service_payload, "id": service_id}), 404)
    expect(professional.request("professional-salon.php", salon_payload(salon), csrf=False), 403)
    duplicate_hours = salon_payload(salon)
    duplicate_hours["hours"][1]["weekday"] = 1
    expect(professional.request("professional-salon.php", duplicate_hours), 422)
    expect(professional.request("professional-salon.php", salon_payload(salon)), 200)
    booking_message = "Merci d’arriver cinq minutes avant votre rendez-vous."
    expect(professional.request("professional-salon.php", {**salon_payload(salon), "bookingMessage": booking_message}), 200)
    public_salon = expect(guest.request(f"salons.php?id={salon_id}"), 200)["salon"]
    assert public_salon["booking_message"] == booking_message
    expect(professional.request("professional-salon.php", {
        **salon_payload(salon), "bookingMessage": "x" * 1001,
    }), 422)
    assert expect(other_pro.request("professional-salon.php"), 200)["salon"]["booking_message"] == ""
    search = expect(guest.request(f"salons.php?q={SUFFIX}&wilaya=19&categorie=coiffeur"), 200)
    assert [int(row["id"]) for row in search["salons"]] == [salon_id]
    cities = expect(guest.request("salons.php?view=cities&q=Set"), 200)["cities"]
    assert "Setif" in cities
    assert expect(guest.request("salons.php?view=cities&q=%25"), 200)["cities"] == []
    assert expect(guest.request("salons.php?view=cities&q=S"), 200)["cities"] == []
    expect(guest.request("salons.php?view=cities&q[]=Set"), 422)
    assert [int(row["id"]) for row in expect(guest.request(f"salons.php?ville=Setif&q={SUFFIX}&categorie=coiffeur"), 200)["salons"]] == [salon_id]
    assert not expect(guest.request(f"salons.php?ville=Set&q={SUFFIX}"), 200)["salons"]
    assert not expect(guest.request(f"salons.php?ville=Paris&q={SUFFIX}"), 200)["salons"]
    assert not expect(guest.request("salons.php?ville=%25"), 200)["salons"]
    expect(guest.request("salons.php?ville[]=Setif"), 422)
    assert not expect(guest.request("salons.php?q=%25"), 200)["salons"]
    assert not expect(guest.request("salons.php?categorie=massage"), 200)["salons"]
    assert not expect(guest.request("salons.php?categorie=cadeau"), 200)["salons"]
    expect(guest.request("salons.php?wilaya=99"), 422)

    search_services = [
        {**service_payload, "name": "Brushing test", "price": 800},
        {**service_payload, "name": "Soin visage test", "category": "institut", "price": 500},
        {**service_payload, "name": "Coupe archivee", "price": 100, "isActive": False},
    ]
    for payload in search_services:
        rows = expect(professional.request("professional-services.php", payload), 200)["services"]
        payload["id"] = rows[-1]["id"]

    def starting_price(filters):
        rows = expect(guest.request(f"salons.php?wilaya=19&{filters}"), 200)["salons"]
        assert [int(row["id"]) for row in rows] == [salon_id]
        return int(rows[0]["from_price"])

    assert starting_price(f"q={SUFFIX}") == 500
    assert starting_price(f"q={SUFFIX}&categorie=coiffeur") == 800
    assert starting_price("q=Coupe") == 1500
    assert starting_price("q=Coupe&categorie=coiffeur") == 1500
    assert starting_price("q=Setif&categorie=coiffeur") == 800
    assert not expect(guest.request("salons.php?q=visage&categorie=coiffeur"), 200)["salons"]
    for payload in search_services[:2]:
        expect(professional.request("professional-services.php", {**payload, "isActive": False}), 200)

    expect(other_pro.request("professional-services.php", {**service_payload, "price": 900}), 200)
    expect(other_pro.request("professional-salon.php", salon_payload(other_salon)), 200)
    sort_search = "salons.php?q=Coupe&wilaya=19&categorie=coiffeur"
    alphabetical = expect(guest.request(sort_search), 200)["salons"]
    assert [int(row["id"]) for row in alphabetical] == [salon_id, int(other_salon["id"])]
    sorted_results = expect(guest.request(sort_search + "&tri=prix"), 200)["salons"]
    assert [(int(row["id"]), int(row["from_price"])) for row in sorted_results] == [
        (int(other_salon["id"]), 900), (salon_id, 1500),
    ]
    expect(guest.request(sort_search + "&tri=inconnu"), 422)
    expect(other_pro.request("professional-salon.php", salon_payload(other_salon, public=False)), 200)

    tomorrow = (datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=1))).date() + datetime.timedelta(days=1)).isoformat()
    booking_day = (datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=1))).date() + datetime.timedelta(days=30)).isoformat()
    notification_before = expect(admin.request("admin-notifications.php"), 200)["counts"]
    assert notification_before["queued"] == 0 and notification_before["sent"] == 0
    available = f"availability.php?salonId={salon_id}&serviceId={service_id}&date={booking_day}"
    slots = expect(guest.request(available), 200)["slots"]
    assert slots[0] == "09:00" and slots[-1] == "16:30" and len(slots) == 31
    weekday = datetime.date.fromisoformat(booking_day).isoweekday()
    pause_schedule = salon_payload(salon)
    target_pause = next(hour for hour in pause_schedule["hours"] if hour["weekday"] == weekday)
    target_pause.update(pause_starts_at="11:00", pause_ends_at="11:45")
    saved_hours = expect(professional.request("professional-salon.php", pause_schedule), 200)["hours"]
    saved_pause = next(hour for hour in saved_hours if int(hour["weekday"]) == weekday)
    assert saved_pause["pause_starts_at"].startswith("11:00") and saved_pause["pause_ends_at"].startswith("11:45")
    agenda_pause = expect(professional.request(f"professional-agenda.php?date={booking_day}"), 200)
    assert agenda_pause["hours"]["pause_starts_at"].startswith("11:00")
    public_hours = expect(guest.request(f"salons.php?id={salon_id}"), 200)["hours"]
    assert next(hour for hour in public_hours if int(hour["weekday"]) == weekday)["pause_starts_at"].startswith("11:00")
    pause_slots = expect(guest.request(available), 200)["slots"]
    assert "10:30" in pause_slots and "10:45" not in pause_slots and "11:00" not in pause_slots
    assert "11:30" not in pause_slots and "11:45" in pause_slots
    expect(first.request("appointments.php", {
        "action": "book", "salonId": salon_id, "serviceId": service_id, "date": booking_day,
        "time": "11:00", "expectedPrice": 1500, "expectedDuration": 30,
    }), 409)
    invalid_pause = salon_payload(salon)
    invalid_hour = next(hour for hour in invalid_pause["hours"] if hour["weekday"] == weekday)
    invalid_hour.update(pause_starts_at="08:30", pause_ends_at="09:00")
    expect(professional.request("professional-salon.php", invalid_pause), 422)
    invalid_pause = salon_payload(salon)
    invalid_hour = next(hour for hour in invalid_pause["hours"] if hour["weekday"] == weekday)
    invalid_hour.update(pause_starts_at="12:00", pause_ends_at="")
    expect(professional.request("professional-salon.php", invalid_pause), 422)
    expect(professional.request("professional-salon.php", salon_payload(salon)), 200)
    expect(guest.request(available.replace(booking_day, "2020-01-01")), 422)
    expect(guest.request(available.replace(booking_day, "2026-02-30")), 422)
    expect(guest.request(available.replace(booking_day, "%00")), 422)
    far_date = (datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=1))).date() + datetime.timedelta(days=61)).isoformat()
    expect(guest.request(available.replace(booking_day, far_date)), 422)
    booking = {
        "action": "book", "salonId": salon_id, "serviceId": service_id, "date": booking_day, "time": "09:00",
        "expectedPrice": 1500, "expectedDuration": 30,
    }
    expect(first.request("appointments.php", booking, csrf=False), 403)
    expect(guest.request("appointments.php"), 401)
    appointment_id = expect(first.request("appointments.php", booking), 201)["appointmentId"]
    notification_counts = expect(admin.request("admin-notifications.php"), 200)["counts"]
    assert notification_counts["queued"] == 3 and notification_counts["sent"] == 0
    expect(second.request("appointments.php", {**booking, "time": "09:15"}), 409)
    assert "09:15" not in expect(guest.request(available), 200)["slots"]
    assert "09:30" in expect(guest.request(available), 200)["slots"]
    expect(second.request("appointments.php", {"action": "cancel", "appointmentId": appointment_id}), 404)
    expect(other_pro.request("appointments.php", {"action": "cancel", "appointmentId": appointment_id}), 404)
    expect(second.request(available + f"&appointmentId={appointment_id}"), 404)
    assert "09:00" in expect(first.request(available + f"&appointmentId={appointment_id}"), 200)["slots"]
    assert not expect(other_pro.request(f"appointments.php?date={tomorrow}"), 200)["appointments"]
    agenda = expect(professional.request(f"appointments.php?date={booking_day}"), 200)["appointments"]
    assert len(agenda) == 1 and agenda[0]["first_name"] == "Client 1"
    clients = expect(professional.request("professional-clients.php"), 200)["clients"]
    assert len(clients) == 1

    second_id = expect(second.request("appointments.php", {**booking, "time": "10:00"}), 201)["appointmentId"]
    move = {**booking, "action": "reschedule", "appointmentId": appointment_id}
    expect(first.request("appointments.php", {**move, "time": "10:00"}), 409)
    pause_schedule = salon_payload(salon)
    target_pause = next(hour for hour in pause_schedule["hours"] if hour["weekday"] == weekday)
    target_pause.update(pause_starts_at="11:00", pause_ends_at="11:45")
    expect(professional.request("professional-salon.php", pause_schedule), 200)
    expect(first.request("appointments.php", {**move, "time": "11:00"}), 409)
    expect(professional.request("professional-salon.php", salon_payload(salon)), 200)
    mine = expect(first.request("appointments.php"), 200)["appointments"]
    assert mine[0]["starts_at"].endswith("09:00:00")
    assert int(mine[0]["service_count"]) == 1
    expect(first.request("appointments.php", {**move, "time": "09:30"}), 200)
    assert "09:00" in expect(guest.request(available), 200)["slots"]
    notification_counts = expect(admin.request("admin-notifications.php"), 200)["counts"]
    assert notification_counts["queued"] == 7 and notification_counts["cancelled"] == 2
    alternate = expect(professional.request("professional-services.php", {
        **service_payload, "name": "Autre prestation", "duration": 15, "price": 900,
    }), 200)["services"][-1]
    expect(first.request("appointments.php", {
        **move, "time": "09:30", "serviceId": alternate["id"], "expectedPrice": 900, "expectedDuration": 15,
    }), 200)
    changed = expect(first.request("appointments.php"), 200)["appointments"][0]
    assert changed["service_name"] == "Autre prestation" and int(changed["price_dzd"]) == 900
    assert changed["ends_at"].endswith("09:45:00")
    expect(first.request("appointments.php", {**move, "time": "09:30"}), 200)
    expect(professional.request("professional-services.php", {
        **service_payload, "id": alternate["id"], "name": "Autre prestation", "duration": 15, "price": 900, "isActive": False,
    }), 200)
    expect(professional.request("professional-services.php", {**service_payload, "id": service_id, "price": 2500, "duration": 60}), 200)
    mine = expect(first.request("appointments.php"), 200)["appointments"]
    assert int(mine[0]["price_dzd"]) == 1500 and mine[0]["ends_at"].endswith("10:00:00")
    expect(first.request("appointments.php", {**booking, "time": "15:00"}), 409)
    booking.update(expectedPrice=2500, expectedDuration=60)

    # Independent sessions and simultaneous workers must never double-book the same salon.
    barrier = threading.Barrier(2)
    def race(client):
        barrier.wait()
        return client.request("appointments.php", {**booking, "time": "12:00"})
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(race, client) for client in (first, second)]
        results = [future.result() for future in futures]
    assert sorted(status for status, _ in results) == [201, 409], results

    expect(professional.request("professional-salon.php", salon_payload(salon, public=False)), 200)
    expect(first.request("appointments.php", {**booking, "time": "14:00"}), 404)
    expect(first.request("appointments.php", {"action": "cancel", "appointmentId": appointment_id}), 200)
    expect(professional.request("appointments.php", {"action": "cancel", "appointmentId": second_id}), 200)
    notification_counts = expect(admin.request("admin-notifications.php"), 200)["counts"]
    assert notification_counts["queued"] == 10 and notification_counts["cancelled"] == 10
    expect(professional.request("professional-salon.php", salon_payload(salon)), 200)
    assert "09:00" in expect(guest.request(available), 200)["slots"]
    expect(professional.request("professional-services.php", {**service_payload, "id": service_id, "isActive": False}), 200)
    expect(first.request("appointments.php", {**booking, "time": "15:00"}), 422)
    assert not expect(guest.request(f"salons.php?q={SUFFIX}"), 200)["salons"]
    expect(professional.request("professional-services.php", {
        **service_payload, "id": service_id, "price": booking["expectedPrice"], "duration": booking["expectedDuration"],
    }), 200)
    assert expect(guest.request(f"salons.php?id={salon_id}"), 200)["services"]
    assert expect(first.request("appointments.php?filter=past"), 200)["appointments"] == []
    expect(guest.request("admin-notifications.php"), 401)
    expect(first.request("admin-notifications.php"), 403)
    expect_empty_response(guest, "send-notifications.php", 404)

    pause_schedule = salon_payload(salon)
    next(hour for hour in pause_schedule["hours"] if hour["weekday"] == weekday).update(
        pause_starts_at="11:00", pause_ends_at="11:45",
    )
    expect(professional.request("professional-salon.php", pause_schedule), 200)
    staff_a = expect(professional.request("professional-staff.php", {
        "action": "save", "name": "Collaboratrice A", "isActive": True,
    }), 200)["staff"][0]
    assert next(hour for hour in staff_a["hours"] if int(hour["weekday"]) == weekday)["pause_starts_at"] is None
    staff_b = expect(professional.request("professional-staff.php", {
        "action": "save", "name": "Collaboratrice B", "isActive": True,
    }), 200)["staff"][1]
    assert len(staff_a["hours"]) == 7 and len(staff_b["hours"]) == 7
    assert "11:00" not in expect(guest.request(available + f"&staffId={staff_b['id']}"), 200)["slots"]
    expect(professional.request("professional-salon.php", salon_payload(salon)), 200)
    assert "11:00" in expect(guest.request(available + f"&staffId={staff_b['id']}"), 200)["slots"]
    team_slots = expect(guest.request(available), 200)
    assert len(team_slots["staff"]) == 2 and team_slots["slots"] == []
    staff_a_hours = [{
        **hour, "opens_at": hour["opens_at"][:5], "closes_at": hour["closes_at"][:5],
        "pause_starts_at": hour["pause_starts_at"][:5] if hour["pause_starts_at"] else "",
        "pause_ends_at": hour["pause_ends_at"][:5] if hour["pause_ends_at"] else "",
    } for hour in staff_a["hours"]]
    target_hours = next(hour for hour in staff_a_hours if hour["weekday"] == weekday)
    target_hours.update(opens_at="14:00", closes_at="17:00", pause_starts_at="15:00", pause_ends_at="15:30")
    updated_staff = expect(professional.request("professional-staff.php", {
        "action": "save", "staffId": int(staff_a["id"]), "name": "Collaboratrice A",
        "isActive": True, "hours": staff_a_hours,
    }), 200)["staff"]
    staff_a = next(member for member in updated_staff if int(member["id"]) == int(staff_a["id"]))
    agenda_staff = expect(professional.request(f"professional-agenda.php?date={booking_day}"), 200)
    staff_a_agenda = next(member for member in agenda_staff["staff"] if int(member["id"]) == int(staff_a["id"]))
    assert staff_a_agenda["pause_starts_at"].startswith("15:00")
    invalid_hours = [dict(hour) for hour in staff_a_hours]
    invalid_hours[0]["closes_at"] = invalid_hours[0]["opens_at"]
    expect(professional.request("professional-staff.php", {
        "action": "save", "staffId": int(staff_a["id"]), "name": "Collaboratrice A",
        "isActive": True, "hours": invalid_hours,
    }), 422)
    invalid_hours = [dict(hour) for hour in staff_a_hours]
    target_invalid_pause = next(hour for hour in invalid_hours if hour["weekday"] == weekday)
    target_invalid_pause["pause_ends_at"] = ""
    expect(professional.request("professional-staff.php", {
        "action": "save", "staffId": int(staff_a["id"]), "name": "Collaboratrice A",
        "isActive": True, "hours": invalid_hours,
    }), 422)
    staff_a_url = available + f"&staffId={staff_a['id']}"
    staff_b_url = available + f"&staffId={staff_b['id']}"
    assert "13:00" not in expect(guest.request(staff_a_url), 200)["slots"]
    assert "14:00" in expect(guest.request(staff_a_url), 200)["slots"]
    assert "14:30" not in expect(guest.request(staff_a_url), 200)["slots"]
    assert "14:45" not in expect(guest.request(staff_a_url), 200)["slots"]
    assert "15:00" not in expect(guest.request(staff_a_url), 200)["slots"]
    assert "15:30" in expect(guest.request(staff_a_url), 200)["slots"]
    assert "13:00" in expect(guest.request(staff_b_url), 200)["slots"]
    staff_booking = {**booking, "time": "14:00", "staffId": int(staff_a["id"])}
    staff_appointment_a = expect(first.request("appointments.php", staff_booking), 201)["appointmentId"]
    staff_appointment_b = expect(second.request("appointments.php", {
        **staff_booking, "time": "13:00", "staffId": int(staff_b["id"]),
    }), 201)["appointmentId"]
    expect(second.request("appointments.php", {**staff_booking, "time": "14:15"}), 409)
    agenda_a = expect(professional.request(f"appointments.php?date={booking_day}&staffId={staff_a['id']}"), 200)["appointments"]
    assert len(agenda_a) == 1 and agenda_a[0]["staff_name"] == "Collaboratrice A"
    expect(professional.request("professional-staff.php", {
        "action": "save", "staffId": int(staff_a["id"]), "name": "Collaboratrice A", "isActive": False,
    }), 200)
    expect(guest.request(staff_a_url), 422)
    expect(professional.request("appointments.php", {"action": "cancel", "appointmentId": staff_appointment_a}), 200)
    expect(professional.request("appointments.php", {"action": "cancel", "appointmentId": staff_appointment_b}), 200)

    campaigns = expect(admin.request("admin-campaigns.php"), 200)
    assert campaigns["consentingClients"] == 1
    campaign = expect(admin.request("admin-campaigns.php", {
        "action": "create", "subject": f"Test {SUFFIX}", "body": "Message de test",
    }), 201)
    assert campaign["recipients"] == 1
    expect(first.request("admin-campaigns.php"), 403)
    expect(second.request("admin-campaigns.php"), 403)
    profile = expect(first.request("client-profile.php"), 200)["profile"]
    assert int(profile["marketing_consent"]) == 1
    profile = expect(second.request("client-profile.php"), 200)["profile"]
    assert int(profile["marketing_consent"]) == 0
    expect(first.request("client-profile.php", {"marketingConsent": False}), 200)
    campaigns = expect(admin.request("admin-campaigns.php"), 200)
    assert campaigns["consentingClients"] == 0
    expect(admin.request("admin-campaigns.php", {"action": "cancel", "campaignId": campaign["campaignId"]}), 200)

    expect(admin.request("admin-billing.php", {
        "action": "save-plan", "name": f"Essai {SUFFIX}", "monthlyPrice": 12000,
        "annualPrice": 120000, "trialDays": 0, "isActive": True,
    }), 200)
    billing = expect(admin.request("admin-billing.php"), 200)
    selected_plan = next(item for item in billing["plans"] if item["name"] == f"Essai {SUFFIX}")
    other_account = next(person for person in billing["professionals"] if person["email"] == other_pro.email)
    expect(admin.request("admin-billing.php", {
        "action": "assign", "accountId": int(other_account["id"]), "planId": int(selected_plan["id"]), "cycle": "monthly",
    }), 200)
    assert expect(admin.request("admin-billing.php", {
        "action": "assign", "accountId": int(other_account["id"]), "planId": int(selected_plan["id"]), "cycle": "monthly",
    }), 409)
    billing = expect(admin.request("admin-billing.php"), 200)
    subscription = next(item for item in billing["subscriptions"] if item["email"] == other_pro.email)
    today = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=1))).date()
    period_start = today.replace(day=1)
    if period_start.month == 12:
        next_month = period_start.replace(year=period_start.year + 1, month=1)
    else:
        next_month = period_start.replace(month=period_start.month + 1)
    period_end = next_month - datetime.timedelta(days=1)
    payment = {
        "action": "record-payment", "subscriptionId": int(subscription["id"]), "amountDzd": 12000,
        "paymentMethod": "transfer", "reference": f"REF-{SUFFIX}",
        "periodStart": period_start.isoformat(), "periodEnd": period_end.isoformat(),
    }
    expect(admin.request("admin-billing.php", payment), 201)
    expect(admin.request("admin-billing.php", payment), 409)
    accounts = expect(admin.request(f"admin-accounts.php?q={other_pro.email}"), 200)["accounts"]
    target_account = next(item for item in accounts if item["email"] == other_pro.email)
    expect(admin.request("admin-accounts.php", {
        "action": "suspend", "accountId": int(target_account["id"]), "reason": "Test d’intégration",
    }), 200)
    assert other_pro.request("professional-salon.php")[0] == 401
    expect(admin.request("admin-accounts.php", {
        "action": "restore", "accountId": int(target_account["id"]), "reason": "Fin du test",
    }), 200)
    other_pro.token()
    assert other_pro.login(other_account["email"], PASSWORD) == 200
    print("Integration checks passed: reservations, staff scheduling, consent, campaigns, billing and account administration.")


if __name__ == "__main__":
    main()
