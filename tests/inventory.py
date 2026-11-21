#!/usr/bin/env python3
"""Run only against a fresh disposable database and a multi-worker PHP server."""

import concurrent.futures
import csv
import io
import os
import threading
import urllib.parse
import urllib.request
import uuid

from bookings import Client, PASSWORD, SUFFIX, account_tests, expect, new_client, new_professional


PRODUCTS = "professional-products.php"
MOVEMENTS = "professional-stock-movements.php"


def product_payload(**changes):
    return {
        "name": 'Lotion; "Douce"\nTest', "reference": "LOT-1",
        "price": 1200, "threshold": 2, "isActive": True, **changes,
    }


def move(client, product_id, quantity, direction="in", **changes):
    return client.request(MOVEMENTS, {
        "productId": product_id, "quantity": quantity, "direction": direction,
        "reason": "Livraison de test", "requestKey": str(uuid.uuid4()), **changes,
    })


def history(client, product_id, page=1):
    return expect(client.request(f"{MOVEMENTS}?productId={product_id}&page={page}"), 200)


def export(client, **filters):
    request = urllib.request.Request(
        account_tests.BASE + "/api/" + PRODUCTS + "?" + urllib.parse.urlencode({"format": "csv", **filters})
    )
    with client.opener.open(request) as response:
        assert response.headers["Content-Type"] == "text/csv; charset=utf-8"
        assert "attachment" in response.headers["Content-Disposition"]
        assert response.headers["Cache-Control"] == "no-store"
        return list(csv.reader(io.StringIO(response.read().decode("utf-8-sig")), delimiter=";"))


def main():
    guest, admin = Client(), Client()
    admin.token()
    admin_email = f"inventory-admin-{SUFFIX}@example.test"
    expect(admin.request("setup-admin.php", {
        "setupToken": os.environ["BOOKILI_TEST_SETUP_TOKEN"], "email": admin_email, "password": PASSWORD,
    }), 201)
    assert admin.login(admin_email, PASSWORD) == 200
    professional, _ = new_professional(admin, 1)
    other, _ = new_professional(admin, 2)
    client = new_client(1)

    expect(guest.request(PRODUCTS), 401)
    expect(client.request(PRODUCTS), 403)
    expect(admin.request(PRODUCTS), 403)
    expect(guest.request(PRODUCTS + "?format=csv"), 401)
    expect(client.request(PRODUCTS + "?format=csv"), 403)
    expect(professional.request(PRODUCTS, product_payload(), csrf=False), 403)
    for changes in ({"price": -1}, {"price": 1.5}, {"price": "12"}, {"threshold": True},
                    {"threshold": 1000001}, {"name": ""}, {"reference": []}, {"isActive": 1},
                    {"category": []}, {"maximum": 1}, {"maximum": 1000001}, {"maximum": "5"}):
        expect(professional.request(PRODUCTS, product_payload(**changes)), 422)
    for query in ("page=0", "page=10001", "q[]=bad", "stock=invalid", "format=invalid", "includeArchived=yes"):
        expect(professional.request(f"{PRODUCTS}?{query}"), 422)

    product_id = expect(professional.request(PRODUCTS, product_payload(quantity=999, category=" Soins ", maximum=5)), 200)["productId"]
    initial = expect(professional.request(PRODUCTS), 200)
    assert len(initial["products"]) == 1 and initial["lowStockCount"] == 1
    assert initial["products"][0]["quantity"] == 0
    assert initial["products"][0]["category"] == "Soins" and initial["products"][0]["max_stock_quantity"] == 5
    assert initial["overStockCount"] == 0
    assert expect(other.request(PRODUCTS), 200)["products"] == []
    expect(other.request(PRODUCTS, product_payload(id=product_id)), 404)
    expect(other.request(f"{MOVEMENTS}?productId={product_id}"), 404)
    expect(move(other, product_id, 10), 404)
    expect(client.request(f"{MOVEMENTS}?productId={product_id}"), 403)
    expect(guest.request(f"{MOVEMENTS}?productId={product_id}"), 401)
    expect(professional.request(f"{MOVEMENTS}?productId={product_id}&page=0"), 422)

    key = str(uuid.uuid4())
    expect(professional.request(MOVEMENTS, {
        "productId": product_id, "quantity": 10, "direction": "in",
        "reason": "Livraison de test", "requestKey": key,
    }, csrf=False), 403)
    for quantity in (0, -1, 1.5, True, "2", 1000001):
        expect(move(professional, product_id, quantity), 422)
    expect(move(professional, product_id, 1, reason=" "), 422)
    expect(move(professional, product_id, 1, requestKey="invalid"), 422)
    expect(move(professional, product_id, 1, direction="unknown"), 422)
    assert history(professional, product_id)["movements"] == []
    assert expect(move(professional, product_id, 10, requestKey=key), 200)["duplicate"] is False
    assert expect(move(professional, product_id, 10, requestKey=key), 200)["duplicate"] is True
    expect(move(professional, product_id, 11, requestKey=key), 409)
    received = history(professional, product_id)
    assert len(received["movements"]) == 1 and received["product"]["quantity"] == 10
    assert received["movements"][0]["quantity_after"] == 10
    assert expect(professional.request(PRODUCTS), 200)["lowStockCount"] == 0
    over = expect(professional.request(PRODUCTS + "?stock=over&category=soins"), 200)
    assert over["overStockCount"] == 1 and [int(row["id"]) for row in over["products"]] == [product_id]
    assert expect(professional.request(PRODUCTS + "?stock=over&category=Autres"), 200)["products"] == []
    assert export(professional, stock="over", category="Soins")[1][-3:] == ["Soins", "5", "Actif"]
    assert expect(other.request(PRODUCTS + "?stock=over&category=Soins"), 200)["overStockCount"] == 0
    expect(move(professional, product_id, 11, direction="out"), 409)
    expect(move(professional, product_id, 1000000), 409)
    assert len(history(professional, product_id)["movements"]) == 1
    expect(move(professional, product_id, 8, direction="out"), 200)
    low = expect(professional.request(PRODUCTS + "?stock=low"), 200)
    assert len(low["products"]) == 1 and low["lowStockCount"] == 1

    # Separate sessions and PHP workers exercise the row lock, not the PHP session lock.
    second_session = Client()
    second_session.token()
    assert second_session.login(f"pro-{SUFFIX}-1@example.test", PASSWORD) == 200
    barrier = threading.Barrier(2)

    def race(session, **changes):
        barrier.wait()
        return move(session, product_id, 2, direction="out", **changes)

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(race, (professional, second_session)))
    assert sorted(status for status, _ in results) == [200, 409], results
    assert history(professional, product_id)["product"]["quantity"] == 0
    barrier = threading.Barrier(2)
    replay_key = str(uuid.uuid4())

    def replay(session):
        barrier.wait()
        return move(session, product_id, 5, requestKey=replay_key)

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(replay, (professional, second_session)))
    assert all(status == 200 for status, _ in results), results
    assert sorted(result["duplicate"] for _, result in results) == [False, True]
    assert history(professional, product_id)["product"]["quantity"] == 5
    assert expect(professional.request(PRODUCTS + "?stock=over"), 200)["products"] == []

    expect(professional.request(PRODUCTS, product_payload(id=product_id, isActive=False, quantity=99)), 200)
    assert expect(professional.request(PRODUCTS), 200)["products"] == []
    assert history(professional, product_id)["product"]["quantity"] == 5
    expect(move(professional, product_id, 1), 409)
    assert len(expect(professional.request(PRODUCTS + "?includeArchived=1"), 200)["products"]) == 1
    assert len(export(professional)) == 1
    archived = export(professional, includeArchived="1")
    assert archived[1][0] == product_payload()["name"] and archived[1][-1] == "Archivé"
    assert archived[1][-3:-1] == ["Soins", "5"]
    expect(professional.request(PRODUCTS, product_payload(id=product_id, maximum=None, category="")), 200)
    assert history(professional, product_id)["product"]["max_stock_quantity"] is None
    expect(move(professional, product_id, 999995), 200)
    expect(move(professional, product_id, 1), 409)
    assert history(professional, product_id)["product"]["quantity"] == 1000000

    # Full-page boundaries and an export must not silently truncate the inventory.
    for index in range(51):
        expect(professional.request(PRODUCTS, product_payload(name=f"Page {index:02}", reference="PAGE")), 200)
    listed = expect(professional.request(PRODUCTS + "?q=PAGE"), 200)
    assert len(listed["products"]) == 50 and listed["hasMore"] is True
    last = expect(professional.request(PRODUCTS + "?q=PAGE&page=2"), 200)
    assert len(last["products"]) == 1 and last["hasMore"] is False
    assert len(export(professional, q="PAGE")) == 52
    assert len(export(other)) == 1
    formula_id = expect(professional.request(PRODUCTS, product_payload(name="=1+1", reference="@stock")), 200)["productId"]
    formula = export(professional, q="@stock")
    assert len(formula) == 2 and formula[1][:2] == ["'=1+1", "'@stock"]
    assert expect(professional.request(PRODUCTS + "?q=%25"), 200)["products"] == []
    for _ in range(51):
        expect(move(professional, formula_id, 1), 200)
    first_page = history(professional, formula_id)
    second_page = history(professional, formula_id, 2)
    assert len(first_page["movements"]) == 50 and first_page["hasMore"] is True
    assert len(second_page["movements"]) == 1 and second_page["hasMore"] is False
    assert first_page["movements"][0]["quantity_after"] == 51
    assert second_page["movements"][0]["quantity_after"] == 1

    def count(version, quantity, **changes):
        return {"productId": formula_id, "direction": "count", "quantity": quantity,
                "stockVersion": version, "reason": "=Inventaire", "requestKey": str(uuid.uuid4()), **changes}

    # Even a round trip back to the same quantity invalidates a count in progress.
    expect(move(professional, formula_id, 1), 200)
    expect(move(professional, formula_id, 1, direction="out"), 200)
    expect(professional.request(MOVEMENTS, count(first_page["stockVersion"], 0)), 409)
    current = history(professional, formula_id)
    assert current["product"]["quantity"] == 51
    counted = count(current["stockVersion"], 0)
    expect(other.request(MOVEMENTS, counted), 404)
    assert expect(professional.request(MOVEMENTS, counted), 200)["duplicate"] is False
    assert expect(professional.request(MOVEMENTS, counted), 200)["duplicate"] is True
    expect(professional.request(MOVEMENTS, {**counted, "quantity": 1}), 409)
    expect(professional.request(MOVEMENTS, count(history(professional, formula_id)["stockVersion"], 0)), 200)
    counts_url = f"{MOVEMENTS}?productId={formula_id}&filter=counts"
    counts = expect(professional.request(counts_url), 200)["movements"]
    assert [(row["quantity_delta"], row["quantity_after"], row["is_count"]) for row in counts] == [(0, 0, 1), (-51, 0, 1)]
    expect(other.request(counts_url + "&format=csv"), 404)
    with professional.opener.open(f"{account_tests.BASE}/api/{counts_url}&format=csv") as response:
        rows = list(csv.reader(io.StringIO(response.read().decode("utf-8-sig")), delimiter=";"))
    assert len(rows) == 3 and rows[2][0] == "'=1+1"
    assert rows[2][2:] == ["Comptage physique", "51", "-51", "0", "'=Inventaire"]

    suppliers = "professional-stock-suppliers.php"
    details = {"name": "=Fournisseur test", "phone": "0550123456", "email": "stock@example.test", "isActive": True}
    expect(client.request(suppliers), 403)
    expect(professional.request(suppliers, details, csrf=False), 403)
    supplier_id = expect(professional.request(suppliers, details), 200)["supplierId"]
    assert expect(other.request(suppliers), 200)["suppliers"] == []
    expect(other.request(suppliers, {**details, "id": supplier_id}), 404)
    expect(other.request(PRODUCTS, product_payload(supplierId=supplier_id)), 422)
    expect(professional.request(PRODUCTS, product_payload(id=product_id, supplierId=str(supplier_id))), 200)
    filtered = expect(professional.request(f"{PRODUCTS}?supplier={supplier_id}"), 200)["products"]
    assert len(filtered) == 1 and filtered[0]["supplier_name"] == details["name"]
    assert export(professional, supplier=supplier_id)[1][5] == "'=Fournisseur test"
    expect(professional.request(suppliers, {**details, "id": supplier_id, "isActive": False}), 200)
    expect(professional.request(PRODUCTS, product_payload(supplierId=supplier_id)), 422)
    expect(professional.request(PRODUCTS, product_payload(id=product_id)), 200)
    assert int(history(professional, product_id)["product"]["supplier_id"]) == supplier_id
    expect(professional.request(PRODUCTS, product_payload(id=product_id, supplierId=None)), 200)
    assert expect(professional.request(f"{PRODUCTS}?supplier={supplier_id}"), 200)["products"] == []
    print("Inventory checks passed: ownership, validation, stock limits, history, alerts, archiving, CSV, pagination, idempotency and concurrency.")


if __name__ == "__main__":
    main()
