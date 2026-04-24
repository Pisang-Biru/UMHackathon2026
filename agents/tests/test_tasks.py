import pytest
from app.worker.celery_app import celery
from app.worker import tasks
from app.memory import models


@pytest.fixture(autouse=True)
def eager_celery():
    celery.conf.task_always_eager = True
    celery.conf.task_eager_propagates = True
    yield
    celery.conf.task_always_eager = False


def test_embed_and_store_turn_writes_row(session, engine, monkeypatch):
    from sqlalchemy.orm import sessionmaker
    TestSession = sessionmaker(bind=engine)
    monkeypatch.setattr(tasks, "SessionLocal", TestSession)
    monkeypatch.setattr(tasks, "embed", lambda texts: [[0.1] * 1024 for _ in texts])

    tasks.embed_and_store_turn.delay(
        business_id="biz1",
        customer_phone="+60111",
        buyer_msg="hi",
        agent_reply="hello",
        action_id="act1",
    )

    session.expire_all()
    rows = session.query(models.MemoryConversationTurn).filter_by(businessId="biz1").all()
    assert len(rows) == 1
    assert rows[0].buyerMsg == "hi"
    assert len(rows[0].embedding) == 1024


def test_embed_product_upserts(session, engine, monkeypatch):
    from sqlalchemy.orm import sessionmaker
    from app.db import Product
    TestSession = sessionmaker(bind=engine)
    with TestSession() as s:
        s.add(Product(id="p1", name="Sambal", price=9.9, stock=5,
                       description="spicy", businessId="biz1"))
        s.commit()

    monkeypatch.setattr(tasks, "SessionLocal", TestSession)
    monkeypatch.setattr(tasks, "embed", lambda texts: [[0.2] * 1024 for _ in texts])

    tasks.embed_product.delay("p1")
    tasks.embed_product.delay("p1")  # idempotent

    rows = session.query(models.MemoryProductEmbedding).filter_by(productId="p1").all()
    assert len(rows) == 1
    assert "Sambal" in rows[0].content


def test_embed_kb_chunk_writes_row(session, engine, monkeypatch):
    from sqlalchemy.orm import sessionmaker
    TestSession = sessionmaker(bind=engine)
    monkeypatch.setattr(tasks, "SessionLocal", TestSession)
    monkeypatch.setattr(tasks, "embed", lambda texts: [[0.3] * 1024])

    tasks.embed_kb_chunk.delay(
        business_id="biz1",
        source_id="docA",
        chunk_index=0,
        content="We ship KL same day",
    )

    rows = session.query(models.MemoryKbChunk).filter_by(sourceId="docA").all()
    assert len(rows) == 1
    assert rows[0].content == "We ship KL same day"
