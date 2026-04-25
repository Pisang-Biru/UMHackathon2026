import json
from unittest.mock import MagicMock, patch
from app import events
from app.db import SessionLocal, AgentEvent


def test_emit_writes_row_and_publishes():
    fake_redis = MagicMock()
    with patch.object(events, "_redis", fake_redis):
        events.emit(
            agent_id="customer_support",
            kind="node.end",
            business_id="dev-biz",
            conversation_id="c-emit-1",
            node="draft",
            status="ok",
            summary="drafted reply",
            duration_ms=42,
        )
    with SessionLocal() as s:
        row = (
            s.query(AgentEvent)
            .filter_by(conversation_id="c-emit-1")
            .order_by(AgentEvent.id.desc())
            .first()
        )
        assert row and row.node == "draft" and row.status == "ok"
        s.query(AgentEvent).filter_by(conversation_id="c-emit-1").delete()
        s.commit()
    fake_redis.publish.assert_called_once()
    ch, payload = fake_redis.publish.call_args.args
    assert ch == "agent.events"
    data = json.loads(payload)
    assert data["agent_id"] == "customer_support"
    assert data["node"] == "draft"
    assert data["id"] is not None
    assert data["ts"] is not None


def test_emit_swallows_redis_failure():
    fake_redis = MagicMock()
    fake_redis.publish.side_effect = RuntimeError("redis down")
    with patch.object(events, "_redis", fake_redis):
        events.emit(agent_id="x", kind="node.start", conversation_id="c-redis-fail")
    with SessionLocal() as s:
        row = s.query(AgentEvent).filter_by(conversation_id="c-redis-fail").first()
        assert row is not None
        s.query(AgentEvent).filter_by(conversation_id="c-redis-fail").delete()
        s.commit()


def test_emit_swallows_db_failure(monkeypatch):
    class _BoomSession:
        def __enter__(self):
            raise RuntimeError("db down")
        def __exit__(self, *a):
            return False

    def boom():
        return _BoomSession()

    monkeypatch.setattr(events, "_session_factory", boom)
    # Must not raise
    events.emit(agent_id="x", kind="node.start", conversation_id="c-db-fail")
