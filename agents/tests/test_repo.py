from datetime import datetime, timezone
from app.memory import repo, models


def _vec(seed: int) -> list[float]:
    import math
    raw = [(i * seed % 97) / 97.0 for i in range(1024)]
    norm = math.sqrt(sum(x * x for x in raw)) or 1.0
    return [x / norm for x in raw]


def test_insert_turn_and_fetch_recent(session):
    repo.insert_turn(session, "biz1", "+60111", "hi", "hello", _vec(1))
    repo.insert_turn(session, "biz1", "+60111", "nak order", "sure", _vec(2))
    session.commit()
    rows = repo.recent_turns(session, "biz1", "+60111", limit=10)
    assert len(rows) == 2
    assert rows[0].buyerMsg == "nak order"  # newest first


def test_recent_turns_isolates_by_phone(session):
    repo.insert_turn(session, "biz1", "+60111", "mine", "a", _vec(3))
    repo.insert_turn(session, "biz1", "+60222", "other", "b", _vec(4))
    session.commit()
    rows = repo.recent_turns(session, "biz1", "+60111", limit=10)
    assert all(r.customerPhone == "+60111" for r in rows)


def test_upsert_product(session):
    repo.upsert_product_embedding(session, "p1", "biz1", "sambal", _vec(5))
    repo.upsert_product_embedding(session, "p1", "biz1", "sambal updated", _vec(6))
    session.commit()
    row = session.query(models.MemoryProductEmbedding).filter_by(productId="p1").one()
    assert row.content == "sambal updated"


def test_upsert_past_action(session):
    repo.upsert_past_action(session, "a1", "biz1", "refund?", "sure", _vec(7))
    repo.upsert_past_action(session, "a1", "biz1", "refund?", "updated", _vec(8))
    session.commit()
    row = session.query(models.MemoryPastAction).filter_by(id="a1").one()
    assert row.finalReply == "updated"


def test_insert_kb_chunk(session):
    repo.insert_kb_chunk(session, "biz1", "src1", 0, "shipping policy", _vec(9))
    session.commit()
    rows = session.query(models.MemoryKbChunk).filter_by(businessId="biz1").all()
    assert len(rows) == 1
    assert rows[0].sourceId == "src1"


def test_insert_summary(session):
    now = datetime.now(timezone.utc)
    repo.insert_summary(session, "biz1", "+60111", "buyer liked sambal", now, now, _vec(10))
    session.commit()
    rows = session.query(models.MemoryConversationSummary).all()
    assert len(rows) == 1
