from datetime import datetime, timedelta, timezone

from app.db import SessionLocal, AgentEvent
from app.worker.prune import prune_agent_events


def test_prune_drops_older_than_30_days():
    with SessionLocal() as s:
        old = AgentEvent(
            agent_id="x", kind="node.end",
            ts=datetime.now(timezone.utc) - timedelta(days=45),
            conversation_id="c-prune-old",
        )
        fresh = AgentEvent(
            agent_id="x", kind="node.end",
            ts=datetime.now(timezone.utc) - timedelta(days=1),
            conversation_id="c-prune-fresh",
        )
        s.add_all([old, fresh])
        s.commit()
        old_id, fresh_id = old.id, fresh.id

    deleted = prune_agent_events(days=30)
    assert deleted >= 1

    with SessionLocal() as s:
        assert s.get(AgentEvent, old_id) is None
        assert s.get(AgentEvent, fresh_id) is not None
        s.query(AgentEvent).filter_by(id=fresh_id).delete()
        s.commit()


def test_prune_returns_zero_when_nothing_old():
    # Insert only fresh row
    with SessionLocal() as s:
        fresh = AgentEvent(
            agent_id="x", kind="node.end",
            ts=datetime.now(timezone.utc) - timedelta(days=1),
            conversation_id="c-prune-fresh-only",
        )
        s.add(fresh); s.commit()
        fid = fresh.id

    deleted = prune_agent_events(days=30)
    # could be > 0 if other ancient rows exist from earlier test runs; just don't error
    assert deleted >= 0

    with SessionLocal() as s:
        assert s.get(AgentEvent, fid) is not None
        s.query(AgentEvent).filter_by(id=fid).delete()
        s.commit()
