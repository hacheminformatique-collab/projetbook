#!/usr/bin/env python3
"""Use a fresh disposable installation, with multiple PHP workers."""
import concurrent.futures
import csv
import io
import os
import threading
import uuid

from bookings import Client, PASSWORD, SUFFIX, account_tests, expect, new_client, new_professional
from inventory import PRODUCTS, history, move, product_payload

ENDPOINT = "professional-cash.php"


def main():
    guest, admin = Client(), Client()
    admin.token()
    email = f"cash-admin-{SUFFIX}@example.test"
    expect(admin.request("setup-admin.php", {
        "setupToken": os.environ["BOOKILI_TEST_SETUP_TOKEN"], "email": email, "password": PASSWORD,
    }), 201)
    assert admin.login(email, PASSWORD) == 200
    professional, _ = new_professional(admin, 1)
    other, _ = new_professional(admin, 2)
    customer = new_client(1)
    expect(guest.request(ENDPOINT), 401)
    expect(customer.request(ENDPOINT + "?view=csv"), 403)
    product = expect(professional.request(PRODUCTS, product_payload(name="Shampooing")), 200)["productId"]
    own_other_product = expect(other.request(PRODUCTS, product_payload(name="Autre salon")), 200)["productId"]
    expect(move(professional, product, 3), 200)
    service_payload = {"name": "Coupe", "category": "coiffeur", "duration": 30, "price": 500, "isActive": True}
    service = int(expect(professional.request("professional-services.php", service_payload), 200)["services"][0]["id"])
    assert [row["id"] for row in expect(professional.request(ENDPOINT + "?view=catalog"), 200)["items"]] == [product]
    assert expect(professional.request(ENDPOINT + "?view=catalog&kind=service&q=Coupe"), 200)["items"][0]["id"] == service
    product_line = {"id": product, "kind": "product", "quantity": 2, "expectedPrice": 1200}
    service_line = {"id": service, "kind": "service", "quantity": 1, "expectedPrice": 500}
    sale = {"action": "record", "paymentMethod": "cash", "requestKey": str(uuid.uuid4()), "lines": [product_line, service_line]}
    expect(professional.request(ENDPOINT, sale, csrf=False), 403)
    expect(professional.request(ENDPOINT, {**sale, "lines": [product_line, product_line]}), 422)
    expect(professional.request(ENDPOINT, {**sale, "lines": [product_line, {**service_line, "expectedPrice": 499}]}), 409)
    expect(professional.request(ENDPOINT, {**sale, "lines": [{**product_line, "id": own_other_product}]}), 404)
    assert history(professional, product)["product"]["quantity"] == 3
    assert expect(professional.request(ENDPOINT), 200)["entries"] == []

    sale_id = expect(professional.request(ENDPOINT, sale), 201)["saleId"]
    replay = expect(professional.request(ENDPOINT, {**sale, "lines": [service_line, product_line]}), 200)
    assert replay == {"saleId": sale_id, "duplicate": True}
    expect(professional.request(ENDPOINT, {**sale, "paymentMethod": "card"}), 409)
    assert history(professional, product)["product"]["quantity"] == 1
    detail = ENDPOINT + f"?view=sale&saleId={sale_id}"
    expect(other.request(detail), 404)
    expect(other.request(ENDPOINT, {"action": "void", "saleId": sale_id, "reason": "Erreur"}), 404)
    expect(professional.request(PRODUCTS, product_payload(id=product, name="Nouveau nom", price=1300, isActive=False)), 200)
    saved = expect(professional.request(detail), 200)
    assert saved["total_dzd"] == 2900 and saved["lines"][0]["item_name"] == "Shampooing"
    assert saved["lines"][0]["unit_price_dzd"] == 1200
    assert expect(professional.request(ENDPOINT), 200)["netDzd"] == 2900
    overview = expect(professional.request(ENDPOINT + "?view=overview"), 200)
    assert overview["summary"] == {
        "gross_dzd": 2900, "void_dzd": 0, "net_dzd": 2900, "received_dzd": 2900,
        "gift_card_dzd": 0, "sale_count": 1, "void_count": 0,
    }
    assert overview["payments"][0]["payment_method"] == "cash" and overview["payments"][0]["received_dzd"] == 2900
    assert overview["days"][0]["day"] == overview["to"] and overview["days"][0]["sale_count"] == 1
    isolated = expect(other.request(ENDPOINT + "?view=overview"), 200)
    assert isolated["summary"]["gross_dzd"] == 0 and isolated["payments"] == [] and isolated["days"] == []
    void = {"action": "void", "saleId": sale_id, "reason": "=Produit rendu"}
    assert expect(professional.request(ENDPOINT, void), 200)["duplicate"] is False
    assert expect(professional.request(ENDPOINT, void), 200)["duplicate"] is True
    assert history(professional, product)["product"]["quantity"] == 3
    assert len(history(professional, product)["movements"]) == 3
    journal = expect(professional.request(ENDPOINT), 200)
    assert sorted(row["amount_dzd"] for row in journal["entries"]) == [-2900, 2900]
    assert journal["netDzd"] == 0
    overview = expect(professional.request(ENDPOINT + "?view=overview"), 200)
    assert overview["summary"]["net_dzd"] == 0 and overview["summary"]["received_dzd"] == 0
    assert overview["summary"]["gross_dzd"] == 2900 and overview["summary"]["void_dzd"] == 2900
    assert overview["days"][0]["net_dzd"] == 0 and overview["days"][0]["void_count"] == 1
    assert expect(other.request(ENDPOINT), 200)["entries"] == []
    expect(professional.request(ENDPOINT + "?from=2025-02-30"), 422)
    with professional.opener.open(f"{account_tests.BASE}/api/{ENDPOINT}?view=csv") as response:
        rows = list(csv.reader(io.StringIO(response.read().decode("utf-8-sig")), delimiter=";"))
    assert len(rows) == 3 and {row[4] for row in rows[1:]} == {"2900", "-2900"}
    assert next(row for row in rows[1:] if row[2] == "Annulation")[7] == "'=Produit rendu"

    expect(professional.request(PRODUCTS, product_payload(id=product)), 200)
    second_session = Client()
    second_session.token()
    assert second_session.login(f"pro-{SUFFIX}-1@example.test", PASSWORD) == 200
    barrier = threading.Barrier(2)

    def buy(session):
        barrier.wait()
        return session.request(ENDPOINT, {**sale, "requestKey": str(uuid.uuid4())})

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(buy, (professional, second_session)))
    assert sorted(status for status, _ in results) == [201, 409], results
    assert history(professional, product)["product"]["quantity"] == 1

    gifts = "professional-gift-cards.php"
    expect(guest.request(gifts), 401)
    expect(customer.request(gifts), 403)
    expect(professional.request(gifts, {"action": "issue", "valueDzd": 2000, "paymentMethod": "cash", "requestKey": str(uuid.uuid4())}, csrf=False), 403)
    for bad_value in (499, 10000001, 1.5, "2000", True):
        expect(professional.request(gifts, {"action": "issue", "valueDzd": bad_value, "paymentMethod": "cash", "requestKey": str(uuid.uuid4())}), 422)
    gift_request = {"action": "issue", "valueDzd": 2000, "paymentMethod": "cash", "requestKey": str(uuid.uuid4())}
    issued = expect(professional.request(gifts, gift_request), 201)
    assert len(issued["code"]) == 32 and issued["valueDzd"] == 2000
    replay = expect(professional.request(gifts, gift_request), 200)
    assert replay["duplicate"] and replay["code"] is None and replay["saleId"] == issued["saleId"]
    card_list = expect(professional.request(ENDPOINT + "?view=cards"), 200)["cards"]
    assert len(card_list) == 1 and "code" not in card_list[0]
    voucher_sale = {
        "action": "record", "requestKey": str(uuid.uuid4()), "paymentMethod": "cash",
        "giftCardCode": f"{issued['code'][:8]} {issued['code'][8:]}",
        "lines": [service_line],
    }
    expect(other.request(ENDPOINT, voucher_sale), 409)
    redeemed = expect(professional.request(ENDPOINT, voucher_sale), 201)
    assert redeemed["totalDzd"] == 500 and redeemed["giftCardAppliedDzd"] == 500
    assert redeemed["collectedDzd"] == 0 and redeemed["giftCardRemainingDzd"] == 1500
    overview = expect(professional.request(ENDPOINT + "?view=overview"), 200)
    assert overview["summary"]["gift_card_dzd"] == 500
    assert overview["summary"]["received_dzd"] == 4900
    remaining = expect(professional.request(ENDPOINT + "?view=cards"), 200)["cards"][0]["balance_dzd"]
    assert remaining == 1500
    expect(professional.request(ENDPOINT, voucher_sale), 200)
    refund = {"action": "void", "saleId": redeemed["saleId"], "reason": "Correction carte cadeau"}
    expect(professional.request(ENDPOINT, refund), 200)
    assert expect(professional.request(ENDPOINT + "?view=cards"), 200)["cards"][0]["balance_dzd"] == 2000
    assert expect(professional.request(ENDPOINT + "?view=overview"), 200)["summary"]["gift_card_dzd"] == 0
    print("Cash checks passed: ownership, price snapshots, journal, CSV, void, replay and concurrent stock.")


if __name__ == "__main__":
    main()
