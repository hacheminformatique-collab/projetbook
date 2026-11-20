#!/usr/bin/env python3
"""Run against a fresh disposable database and a multi-worker PHP server."""
import concurrent.futures
import datetime
import os
import threading

from bookings import Client, PASSWORD, SUFFIX, expect, new_client, new_professional, salon_payload


def main():
    guest, admin = Client(), Client()
    admin.token()
    expect(admin.request("setup-admin.php", {
        "setupToken": os.environ["BOOKILI_TEST_SETUP_TOKEN"],
        "email": f"closure-admin-{SUFFIX}@example.test", "password": PASSWORD,
    }), 201)
    assert admin.login(f"closure-admin-{SUFFIX}@example.test", PASSWORD) == 200
    professional, salon = new_professional(admin, 1)
    other, _ = new_professional(admin, 2)
    client = new_client(1)
    services = expect(professional.request("professional-services.php", {
        "name": "Coupe", "category": "coiffeur", "duration": 30, "price": 1500, "isActive": True,
    }), 200)["services"]
    service_id = int(services[0]["id"])
    expect(professional.request("professional-salon.php", salon_payload(salon)), 200)
    today = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=1))).date()
    day = (today + datetime.timedelta(days=10)).isoformat()
    next_day = (today + datetime.timedelta(days=11)).isoformat()
    race_day = (today + datetime.timedelta(days=12)).isoformat()
    endpoint = "professional-closures.php"
    availability = f"availability.php?salonId={salon['id']}&serviceId={service_id}&date={day}"
    booking = {"action": "book", "salonId": int(salon["id"]), "serviceId": service_id,
               "date": day, "time": "09:00", "expectedPrice": 1500, "expectedDuration": 30}
    expect(guest.request(endpoint), 401)
    expect(client.request(endpoint), 403)
    expect(professional.request(endpoint, {"action": "add", "date": day}, csrf=False), 403)
    for data in ({"action": "add", "date": "2026-02-30"},
                 {"action": "add", "date": (today - datetime.timedelta(days=1)).isoformat()},
                 {"action": "add", "date": (today + datetime.timedelta(days=366)).isoformat()},
                 {"action": "invalid", "date": day}, {"action": "add", "date": day, "reason": []}):
        expect(professional.request(endpoint, data), 422)
    assert len(expect(guest.request(availability), 200)["slots"]) == 31
    expect(professional.request(endpoint, {"action": "add", "date": day, "reason": "Congé privé"}), 200)
    expect(professional.request(endpoint, {"action": "add", "date": day}), 409)
    assert not expect(guest.request(availability), 200)["slots"]
    expect(client.request("appointments.php", booking), 409)
    assert expect(other.request(endpoint), 200)["closures"] == []
    expect(other.request(endpoint, {"action": "remove", "date": day}), 404)
    assert expect(professional.request(endpoint), 200)["closures"][0]["reason"] == "Congé privé"
    expect(professional.request(endpoint, {"action": "remove", "date": day}), 200)
    assert "09:00" in expect(guest.request(availability), 200)["slots"]
    appointment_id = expect(client.request("appointments.php", booking), 201)["appointmentId"]
    expect(professional.request(endpoint, {"action": "add", "date": day}), 409)
    expect(professional.request(endpoint, {"action": "add", "date": next_day}), 200)
    expect(client.request("appointments.php", {
        **booking, "action": "reschedule", "appointmentId": appointment_id, "expectedVersion": 1, "date": next_day,
    }), 409)
    assert expect(client.request("appointments.php"), 200)["appointments"][0]["starts_at"].startswith(day)
    expect(client.request("appointments.php", {"action": "cancel", "appointmentId": appointment_id, "expectedVersion": 1}), 200)
    expect(professional.request(endpoint, {"action": "add", "date": day}), 200)

    barrier = threading.Barrier(2)
    def close():
        barrier.wait()
        return professional.request(endpoint, {"action": "add", "date": race_day})
    def reserve():
        barrier.wait()
        return client.request("appointments.php", {**booking, "date": race_day})
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(close), pool.submit(reserve)]
        results = [f.result() for f in futures]
    assert (results[0][0], results[1][0]) in ((200, 409), (409, 201)), results
    print("Closure checks passed: access, validation, booking, rescheduling, conflicts and concurrent changes.")


if __name__ == "__main__":
    main()
