#!/usr/bin/env python3
"""Exercise homepage-image APIs against a disposable BOOKILI database."""

import base64
import http.cookiejar
import json
import os
import secrets
import struct
import urllib.error
import urllib.request
import zlib

BASE = os.environ["BOOKILI_TEST_URL"].rstrip("/")
TOKEN = os.environ["BOOKILI_TEST_SETUP_TOKEN"]
JPEG = base64.b64decode(
    "/9j/4AAQSkZJRgABAQEAYABgAAD//gA7Q1JFQVRPUjogZ2QtanBlZyB2MS4wICh1c2luZyBJSkcg"
    "SlBFRyB2NjIpLCBxdWFsaXR5ID0gODAK/9sAQwAGBAUGBQQGBgUGBwcGCAoQCgoJCQoUDg8MEBcU"
    "GBgXFBYWGh0lHxobIxwWFiAsICMmJykqKRkfLTAtKDAlKCko/9sAQwEHBwcKCAoTCgoTKBoWGigo"
    "KCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgo/8AAEQgA"
    "AwACAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMC"
    "BAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYn"
    "KCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeY"
    "mZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5"
    "+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwAB"
    "AgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpD"
    "REVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ip"
    "qrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/aAAwDAQACEQMR"
    "AD8A5Ciiiv0U+EP/2Q=="
)
WEBP = base64.b64decode("UklGRjoAAABXRUJQVlA4IC4AAAAQAgCdASoCAAMAAUAmJaACdLoB+AH4AAPIAP7vvVf+rPpoRf3r//owb/KL5YwA")


def png(width, height):
    def chunk(name, data):
        return struct.pack(">I", len(data)) + name + data + struct.pack(">I", zlib.crc32(name + data))
    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    pixels = (b"\x00" + b"\x7f\x20\x10" * width) * height
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(pixels)) + chunk(b"IEND", b"")


def jpeg_with_orientation():
    tiff = b"II*\x00\x08\x00\x00\x00" + struct.pack("<H", 1)
    tiff += struct.pack("<HHIH", 0x0112, 3, 1, 6) + b"\x00\x00" + struct.pack("<I", 0)
    exif = b"Exif\x00\x00" + tiff
    return JPEG[:2] + b"\xff\xe1" + struct.pack(">H", len(exif) + 2) + exif + JPEG[2:]


def jpeg_size(data):
    offset = 2
    while offset < len(data):
        assert data[offset] == 0xFF
        marker = data[offset + 1]
        size = struct.unpack_from(">H", data, offset + 2)[0]
        if marker in (0xC0, 0xC1, 0xC2):
            height, width = struct.unpack_from(">HH", data, offset + 5)
            return width, height
        offset += size + 2
    raise AssertionError("JPEG dimensions not found")


class Client:
    def __init__(self):
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar())
        )
        self.csrf = ""

    def request(self, path, data=None, headers=None):
        request = urllib.request.Request(BASE + "/api/" + path, data=data, headers=headers or {})
        try:
            response = self.opener.open(request)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.status, response.headers, response.read()

    def json(self, path, data=None):
        body = json.dumps(data).encode() if data is not None else None
        headers = {"Content-Type": "application/json", "X-CSRF-Token": self.csrf} if body else {}
        status, _, result = self.request(path, body, headers)
        return status, json.loads(result)

    def token(self):
        status, result = self.json("csrf.php")
        assert status == 200
        self.csrf = result["csrfToken"]

    def login(self, email, password):
        status, result = self.json("login.php", {"email": email, "password": password})
        assert status == 200, (status, result)
        self.csrf = result["csrfToken"]

    def form(self, action, image=None, csrf=True):
        boundary = "bookili-" + secrets.token_hex(16)
        parts = [
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"action\"\r\n\r\n{action}\r\n".encode()
        ]
        if image is not None:
            parts.append(
                f"--{boundary}\r\nContent-Disposition: form-data; name=\"image\"; filename=\"test.png\"\r\nContent-Type: image/png\r\n\r\n".encode()
                + image + b"\r\n"
            )
        parts.append(f"--{boundary}--\r\n".encode())
        headers = {"Content-Type": f"multipart/form-data; boundary={boundary}"}
        if csrf:
            headers["X-CSRF-Token"] = self.csrf
        status, _, body = self.request("admin-homepage-image.php", b"".join(parts), headers)
        return status, json.loads(body)


def main():
    admin, client, guest = Client(), Client(), Client()
    assert guest.request("homepage-image.php")[0] == 204
    assert guest.json("admin-homepage-image.php")[0] == 401
    admin.token()
    suffix = secrets.token_hex(8)
    password = "Mot-de-passe-test-123"
    admin_email = f"admin-{suffix}@example.test"
    status, result = admin.json("setup-admin.php", {
        "setupToken": TOKEN, "email": admin_email, "password": password,
    })
    assert status == 201, (status, result)
    admin.login(admin_email, password)
    assert admin.json("admin-homepage-image.php")[1]["hasImage"] is False
    image = png(3, 2)
    assert admin.form("upload", image, csrf=False)[0] == 403
    assert admin.form("upload", b"not an image")[0] == 422
    assert admin.form("upload", png(6001, 1))[0] == 422
    assert admin.form("upload", b"x" * (2 * 1024 * 1024 + 1))[0] == 422
    assert guest.request("homepage-image.php")[0] == 204
    status, result = admin.form("upload", image)
    assert status == 200 and result["hasImage"] is True, (status, result)
    status, headers, image_bytes = guest.request("homepage-image.php")
    assert status == 200 and headers["Content-Type"] == "image/png"
    assert image_bytes.startswith(b"\x89PNG\r\n\x1a\n")
    assert admin.form("upload", jpeg_with_orientation())[0] == 200
    status, headers, image_bytes = guest.request("homepage-image.php")
    assert status == 200 and headers["Content-Type"] == "image/jpeg"
    assert jpeg_size(image_bytes) == (3, 2) and b"Exif\x00\x00" not in image_bytes
    assert admin.form("upload", WEBP)[0] == 200
    status, headers, image_bytes = guest.request("homepage-image.php")
    assert status == 200 and headers["Content-Type"] == "image/webp"
    assert image_bytes.startswith(b"RIFF") and image_bytes[8:12] == b"WEBP"
    assert admin.form("upload", b"invalid replacement")[0] == 422
    assert guest.request("homepage-image.php")[2] == image_bytes

    client.token()
    email = f"client-{suffix}@example.test"
    status, result = client.json("register-client.php", {
        "firstName": "Test", "lastName": "Client", "email": email,
        "phone": "0550123456", "dateOfBirth": "1990-01-01", "password": password,
    })
    assert status == 201, (status, result)
    client.login(email, password)
    assert client.json("admin-homepage-image.php")[0] == 403
    assert client.form("remove")[0] == 403
    assert guest.request("homepage-image.php")[0] == 200
    status, result = admin.form("remove")
    assert status == 200 and result["hasImage"] is False
    assert guest.request("homepage-image.php")[0] == 204
    print("Homepage image integration checks passed.")


if __name__ == "__main__":
    main()
