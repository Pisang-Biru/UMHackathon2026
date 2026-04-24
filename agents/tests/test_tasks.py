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
