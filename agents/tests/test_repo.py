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


def test_search_kb_ranks_closer_text_first(session):
    v1 = [1.0] + [0.0] * 1023
    v2 = [0.0, 1.0] + [0.0] * 1022
    repo.insert_kb_chunk(session, "biz2", "src", 0, "shipping KL", v1)
    repo.insert_kb_chunk(session, "biz2", "src", 1, "refund policy", v2)
    session.commit()
    hits = repo.search_kb(session, "biz2", v1, k=2, min_sim=0.0)
    assert hits[0].content == "shipping KL"


def test_search_threshold_filters_noise(session):
    v1 = [1.0] + [0.0] * 1023
    v2 = [0.0, 1.0] + [0.0] * 1022
    repo.insert_kb_chunk(session, "biz3", "src", 0, "unrelated", v2)
    session.commit()
    hits = repo.search_kb(session, "biz3", v1, k=5, min_sim=0.5)
    assert hits == []


def test_search_isolates_by_business(session):
    v1 = [1.0] + [0.0] * 1023
    repo.insert_kb_chunk(session, "bizA", "src", 0, "A doc", v1)
    repo.insert_kb_chunk(session, "bizB", "src", 0, "B doc", v1)
    session.commit()
    hits = repo.search_kb(session, "bizA", v1, k=5, min_sim=0.0)
    assert all(h.businessId == "bizA" for h in hits)


def test_search_summaries_filters_by_phone(session):
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)
    v = [1.0] + [0.0] * 1023
    repo.insert_summary(session, "biz4", "+60111", "mine", now, now, v)
    repo.insert_summary(session, "biz4", "+60222", "other", now, now, v)
    session.commit()
    hits = repo.search_summaries(session, "biz4", "+60111", v, k=5, min_sim=0.0)
    assert all(h.customerPhone == "+60111" for h in hits)


def test_search_products_and_past_actions_work(session):
    v = [1.0] + [0.0] * 1023
    repo.upsert_product_embedding(session, "p2", "biz5", "sambal", v)
    repo.upsert_past_action(session, "a2", "biz5", "refund?", "yes", v)
    session.commit()
    p_hits = repo.search_products(session, "biz5", v, k=5, min_sim=0.0)
    a_hits = repo.search_past_actions(session, "biz5", v, k=5, min_sim=0.0)
    assert len(p_hits) == 1 and p_hits[0].content == "sambal"
    assert len(a_hits) == 1 and a_hits[0].customerMsg == "refund?"
