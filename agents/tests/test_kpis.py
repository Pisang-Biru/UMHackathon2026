from fastapi.testclient import TestClient
from app.main import app
from app.db import SessionLocal, AgentEvent

BIZ = "biz1"


def _cleanup(conv: str):
    with SessionLocal() as s:
        s.query(AgentEvent).filter_by(conversation_id=conv).delete()
        s.commit()


def test_kpis_shape():
    with SessionLocal() as s:
        s.add(AgentEvent(agent_id="manager", business_id=BIZ,
                         conversation_id="c-k1", kind="node.end",
                         tokens_in=10, tokens_out=5))
        s.add(AgentEvent(agent_id="manager", business_id=BIZ,
                         conversation_id="c-k1", kind="handoff",
                         status="escalate"))
        s.commit()
    client = TestClient(app)
    r = client.get("/agent/kpis", params={"business_id": BIZ})
    assert r.status_code == 200
    j = r.json()
    assert set(j.keys()) == {
        "active_conversations", "pending_approvals",
        "escalation_rate", "tokens_spent",
    }
    assert isinstance(j["tokens_spent"], int)
    assert j["tokens_spent"] >= 15
    assert 0.0 <= j["escalation_rate"] <= 1.0
    _cleanup("c-k1")


def test_kpis_active_uses_60s_window_not_24h():
    """Events older than 60s should NOT count as active conversations,
    even though they still count toward 24h-windowed metrics like tokens."""
    from datetime import datetime, timedelta, timezone
    with SessionLocal() as s:
        s.add(AgentEvent(
            agent_id="manager", business_id=BIZ,
            conversation_id="c-stale-1", kind="node.end",
            tokens_in=3, tokens_out=4,
            ts=datetime.now(timezone.utc) - timedelta(minutes=5),
        ))
        s.commit()
    client = TestClient(app)
    r = client.get("/agent/kpis", params={"business_id": BIZ})
    j = r.json()
    # 5-minute-old conversation is NOT active anymore.
    assert j["active_conversations"] == 0
    # But its tokens still count toward the 24h-windowed total.
    assert j["tokens_spent"] >= 7
    _cleanup("c-stale-1")


def test_kpis_zero_when_empty():
    client = TestClient(app)
    r = client.get("/agent/kpis", params={"business_id": "no-such-biz-xyz"})
    assert r.status_code == 200
    j = r.json()
    assert j["active_conversations"] == 0
    assert j["tokens_spent"] == 0
    assert j["escalation_rate"] == 0.0
