"""Insert a demo user + business + products + KB doc for dev."""
import os
from sqlalchemy import create_engine, text


def main():
    eng = create_engine(os.environ["DATABASE_URL"])
    with eng.begin() as c:
        c.execute(text("""
            INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
            VALUES ('dev-user', 'Dev User', 'dev@example.com', false, NOW(), NOW())
            ON CONFLICT (id) DO NOTHING
        """))
        c.execute(text("""
            INSERT INTO business (id, name, code, mission, "userId", "createdAt", "updatedAt")
            VALUES ('dev-biz', 'Pisang Demo', 'DEMO-001', 'Jual pisang segar', 'dev-user', NOW(), NOW())
            ON CONFLICT (id) DO NOTHING
        """))
        c.execute(text("""
            INSERT INTO product (id, name, price, stock, description, "businessId", "createdAt", "updatedAt")
            VALUES
              ('prod-hijau', 'Pisang Hijau', 1.00, 50, 'Sihat, keras', 'dev-biz', NOW(), NOW()),
              ('prod-masak', 'Pisang Masak', 1.50, 30, 'Manis, lembut', 'dev-biz', NOW(), NOW())
            ON CONFLICT (id) DO NOTHING
        """))
    print("[seed] dev data ready: user=dev-user, business=dev-biz, 2 products")

    from app.worker.tasks import embed_kb_chunk
    embed_kb_chunk.delay(
        business_id="dev-biz",
        source_id="shipping-policy",
        chunk_index=0,
        content="We ship KL same day before 2pm. Outside KL takes 2-3 days via Poslaju.",
    )
    print("[seed] KB enqueued for embedding")


if __name__ == "__main__":
    main()
