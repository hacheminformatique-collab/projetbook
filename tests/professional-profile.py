#!/usr/bin/env python3
"""Use only with a fresh disposable database and the BOOKILI test server."""

import os

from bookings import Client, PASSWORD, SUFFIX, expect, new_professional, salon_payload


def main():
    guest, admin = Client(), Client()
    admin.token()
    email = f"profile-admin-{SUFFIX}@example.test"
    expect(admin.request("setup-admin.php", {
        "setupToken": os.environ["BOOKILI_TEST_SETUP_TOKEN"], "email": email, "password": PASSWORD,
    }), 201)
    assert admin.login(email, PASSWORD) == 200
    professional, salon = new_professional(admin, 1)
    other_professional, _ = new_professional(admin, 2)
    salon_id = int(salon["id"])
    service = expect(professional.request("professional-services.php", {
        "name": "Prestation profil", "category": "coiffeur", "duration": 30, "price": 1800, "isActive": True,
    }), 200)["services"][0]
    expect(professional.request("professional-salon.php", salon_payload(salon)), 200)

    expect(guest.request("professional-salon-profile.php"), 401)
    expect(professional.request("admin-profile-reviews.php"), 403)
    expect(guest.request(f"salons.php?id={salon_id}"), 200)

    description = "Un espace accueillant, avec une équipe spécialisée."
    expect(professional.request("professional-salon-profile.php", {
        "action": "save-description", "description": "x" * 2001,
    }), 422)
    profile = expect(professional.request("professional-salon-profile.php", {
        "action": "save-description", "description": description,
    }), 200)
    assert profile["salon"]["profile_description_status"] == "pending"
    public = expect(guest.request(f"salons.php?id={salon_id}"), 200)
    assert public["salon"]["public_description"] == "" and "profile_description" not in public["salon"]

    entry = {
        "action": "add-entry", "category": "access", "title": "En transports en commun",
        "details": "À cinq minutes de la station de bus.",
    }
    entry_id = expect(professional.request("professional-salon-profile.php", entry), 200)["entries"][0]["id"]
    expect(professional.request("professional-salon-profile.php", {**entry, "category": "parking"}), 422)
    expect(other_professional.request("professional-salon-profile.php", {
        "action": "delete-entry", "entryId": int(entry_id),
    }), 404)
    public = expect(guest.request(f"salons.php?id={salon_id}"), 200)
    assert public["profileEntries"] == []

    pending = expect(admin.request("admin-profile-reviews.php"), 200)
    assert any(int(item["id"]) == salon_id for item in pending["descriptions"])
    assert any(int(item["id"]) == int(entry_id) for item in pending["entries"])
    expect(guest.request("admin-profile-reviews.php"), 401)
    expect(admin.request("admin-profile-reviews.php", {
        "action": "approve-description", "id": salon_id,
    }), 200)
    expect(admin.request("admin-profile-reviews.php", {
        "action": "approve-entry", "id": int(entry_id),
    }), 200)
    public = expect(guest.request(f"salons.php?id={salon_id}"), 200)
    assert public["salon"]["public_description"] == description
    assert len(public["profileEntries"]) == 1 and int(public["profileEntries"][0]["id"]) == int(entry_id)

    revised = "Une description à faire vérifier avant publication."
    expect(professional.request("professional-salon-profile.php", {
        "action": "save-description", "description": revised,
    }), 200)
    expect(admin.request("admin-profile-reviews.php", {
        "action": "reject-description", "id": salon_id,
    }), 200)
    public = expect(guest.request(f"salons.php?id={salon_id}"), 200)
    assert public["salon"]["public_description"] == description
    expect(professional.request("professional-salon-profile.php", {
        "action": "save-description", "description": "",
    }), 200)
    expect(admin.request("admin-profile-reviews.php", {
        "action": "approve-description", "id": salon_id,
    }), 200)
    assert expect(guest.request(f"salons.php?id={salon_id}"), 200)["salon"]["public_description"] == ""
    expect(professional.request("professional-salon-profile.php", {
        "action": "delete-entry", "entryId": int(entry_id),
    }), 200)
    assert expect(guest.request(f"salons.php?id={salon_id}"), 200)["profileEntries"] == []
    print("Professional profile checks passed: moderation, public visibility and salon isolation.")


if __name__ == "__main__":
    main()
