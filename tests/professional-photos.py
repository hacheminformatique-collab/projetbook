#!/usr/bin/env python3
"""Use only with a fresh disposable database and the BOOKILI test server."""

import os
import secrets
import struct
import urllib.error
import urllib.request
import zlib
import json

from bookings import Client, PASSWORD, SUFFIX, expect, new_professional, salon_payload


BASE = os.environ["BOOKILI_TEST_URL"].rstrip("/")


def png(width=3, height=2):
    def chunk(name, data):
        return struct.pack(">I", len(data)) + name + data + struct.pack(">I", zlib.crc32(name + data))
    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    pixels = (b"\x00" + b"\x7f\x20\x10" * width) * height
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(pixels)) + chunk(b"IEND", b"")


def multipart(client, content, csrf=True):
    boundary = "bookili-" + secrets.token_hex(16)
    body = (
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"action\"\r\n\r\nupload\r\n"
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"photo\"; filename=\"salon.png\"\r\n"
        "Content-Type: image/png\r\n\r\n"
    ).encode() + content + f"\r\n--{boundary}--\r\n".encode()
    headers = {"Content-Type": f"multipart/form-data; boundary={boundary}"}
    if csrf:
        headers["X-CSRF-Token"] = client.csrf
    request = urllib.request.Request(BASE + "/api/professional-salon-photos.php", data=body, headers=headers)
    try:
        response = client.opener.open(request)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        return response.status, json.loads(response.read())


def raw(client, path):
    request = urllib.request.Request(BASE + "/api/" + path)
    try:
        response = client.opener.open(request)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        return response.status, response.headers, response.read()


def main():
    guest, admin = Client(), Client()
    admin.token()
    email = f"photos-admin-{SUFFIX}@example.test"
    expect(admin.request("setup-admin.php", {
        "setupToken": os.environ["BOOKILI_TEST_SETUP_TOKEN"], "email": email, "password": PASSWORD,
    }), 201)
    assert admin.login(email, PASSWORD) == 200
    professional, salon = new_professional(admin, 1)
    other_professional, _ = new_professional(admin, 2)
    salon_id = int(salon["id"])
    expect(professional.request("professional-services.php", {
        "name": "Prestation photos", "category": "coiffeur", "duration": 30, "price": 1800, "isActive": True,
    }), 200)
    expect(professional.request("professional-salon.php", salon_payload(salon)), 200)

    expect(guest.request("professional-salon-photos.php"), 401)
    assert expect(professional.request("professional-salon-photos.php"), 200)["photos"] == []
    image = png()
    assert multipart(professional, image, csrf=False)[0] == 403
    assert multipart(professional, b"not an image")[0] == 422
    ids = []
    for _ in range(4):
        result = expect(multipart(professional, image), 200)
        ids.append(int(result["photos"][-1]["id"]))
    assert len(expect(professional.request("professional-salon-photos.php"), 200)["photos"]) == 4
    assert multipart(professional, image)[0] == 422
    assert expect(other_professional.request("professional-salon-photos.php"), 200)["photos"] == []
    expect(other_professional.request("professional-salon-photos.php", {
        "action": "delete", "photoId": ids[0],
    }), 404)

    public = expect(guest.request(f"salons.php?id={salon_id}"), 200)
    assert public["photos"] == []
    assert raw(guest, f"salon-photo.php?id={ids[0]}")[0] == 404
    assert raw(other_professional, f"salon-photo.php?id={ids[0]}")[0] == 404
    status, headers, image_bytes = raw(admin, f"salon-photo.php?id={ids[0]}")
    assert status == 200 and headers["Content-Type"] == "image/png" and image_bytes.startswith(b"\x89PNG\r\n\x1a\n")

    pending = expect(admin.request("admin-profile-reviews.php"), 200)
    assert {int(photo["id"]) for photo in pending["photos"]} == set(ids)
    expect(admin.request("admin-profile-reviews.php", {
        "action": "approve-photo", "id": ids[0],
    }), 200)
    expect(admin.request("admin-profile-reviews.php", {
        "action": "approve-photo", "id": ids[1],
    }), 200)
    expect(admin.request("admin-profile-reviews.php", {
        "action": "reject-photo", "id": ids[2],
    }), 200)
    assert raw(guest, f"salon-photo.php?id={ids[0]}")[0] == 200
    assert raw(guest, f"salon-photo.php?id={ids[2]}")[0] == 404
    assert multipart(professional, image)[0] == 422
    assert [int(photo["id"]) for photo in expect(guest.request(f"salons.php?id={salon_id}"), 200)["photos"]] == ids[:2]
    expect(professional.request("professional-salon.php", salon_payload(salon, public=False)), 200)
    assert raw(guest, f"salon-photo.php?id={ids[0]}")[0] == 404
    assert raw(professional, f"salon-photo.php?id={ids[0]}")[0] == 200
    expect(professional.request("professional-salon.php", salon_payload(salon)), 200)

    reordered = expect(professional.request("professional-salon-photos.php", {
        "action": "reorder", "photoIds": [ids[1], ids[0], ids[3]],
    }), 200)["photos"]
    assert [int(photo["id"]) for photo in reordered if photo["status"] != "rejected"] == [ids[1], ids[0], ids[3]]
    assert [int(photo["id"]) for photo in expect(guest.request(f"salons.php?id={salon_id}"), 200)["photos"]] == [ids[1], ids[0]]
    expect(professional.request("professional-salon-photos.php", {
        "action": "delete", "photoId": ids[2],
    }), 200)
    remaining = expect(professional.request("professional-salon-photos.php"), 200)["photos"]
    assert len(remaining) == 3
    added = expect(multipart(professional, image), 200)["photos"]
    assert len(added) == 4 and added[-1]["status"] == "pending"
    print("Professional photo checks passed: upload limits, salon isolation, moderation and public gallery.")


if __name__ == "__main__":
    main()
