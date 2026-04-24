"""End-to-end smoke for agent memory.

Assumes: DATABASE_URL set, RabbitMQ running, Celery worker running, FastAPI running on :8000.
Seeds a business + product + KB doc, sends two chat messages from one phone,
prints recovered rows.
"""
import os, time, json
import httpx
import cuid2

BASE = os.environ.get("AGENTS_URL", "http://localhost:8000")
PHONE = "+60123456789"


def main():
    from sqlalchemy import create_engine, text
    eng = create_engine(os.environ["DATABASE_URL"])
    biz_id = cuid2.Cuid().generate()
    prod_id = cuid2.Cuid().generate()
    with eng.begin() as c:
        c.execute(text("INSERT INTO business (id, name, code, \"userId\", \"createdAt\", \"updatedAt\") "
                        "VALUES (:id, :n, :code, :uid, NOW(), NOW()) ON CONFLICT DO NOTHING"),
                   {"id": biz_id, "n": "Smoke Biz", "code": f"SMK{biz_id[:4]}", "uid": "smoke-user"})
        c.execute(text("INSERT INTO product (id, name, price, stock, description, \"businessId\", \"createdAt\", \"updatedAt\") "
                        "VALUES (:id, :n, 10, 5, 'smoke product', :b, NOW(), NOW()) "
                        "ON CONFLICT DO NOTHING"),
                   {"id": prod_id, "n": "Sambal Smoke", "b": biz_id})

    httpx.post(f"{BASE}/memory/kb", json={
        "business_id": biz_id,
        "source_id": "smoke-doc",
        "text": "We ship KL same day before 2pm. Outside KL 2-3 days.",
    }).raise_for_status()

    httpx.post(f"{BASE}/memory/product/{prod_id}/reindex").raise_for_status()

    r1 = httpx.post(f"{BASE}/agent/support/chat", json={
        "business_id": biz_id,
        "customer_id": "smoke-c",
        "customer_phone": PHONE,
        "message": "Boleh ship KL esok?",
    }, timeout=60).json()
    print("msg1:", json.dumps(r1, indent=2))

    time.sleep(5)

    r2 = httpx.post(f"{BASE}/agent/support/chat", json={
        "business_id": biz_id,
        "customer_id": "smoke-c",
        "customer_phone": PHONE,
        "message": "Nak order 2 botol.",
    }, timeout=60).json()
    print("msg2:", json.dumps(r2, indent=2))

    time.sleep(3)
    with eng.begin() as c:
        turns = c.execute(text("SELECT \"buyerMsg\", \"agentReply\" FROM memory_conversation_turn "
                                 "WHERE \"customerPhone\" = :p ORDER BY \"turnAt\" ASC"),
                            {"p": PHONE}).all()
        kb = c.execute(text("SELECT LEFT(content, 60) FROM memory_kb_chunk "
                              "WHERE \"businessId\" = :b"), {"b": biz_id}).all()
        prod = c.execute(text("SELECT content FROM memory_product_embedding "
                                "WHERE \"productId\" = :p"), {"p": prod_id}).all()

    print("turns:", turns)
    print("kb rows:", kb)
    print("product rows:", prod)


if __name__ == "__main__":
    main()
