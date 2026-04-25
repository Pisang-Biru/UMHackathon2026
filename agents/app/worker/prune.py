import logging
from datetime import datetime, timedelta, timezone
from sqlalchemy import delete

from app.db import SessionLocal, AgentEvent

log = logging.getLogger(__name__)


def prune_agent_events(days: int = 30) -> int:
    """Delete agent_events older than `days`. Returns row count deleted."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    with SessionLocal() as s:
        result = s.execute(delete(AgentEvent).where(AgentEvent.ts < cutoff))
        s.commit()
        rc = result.rowcount or 0
    log.info("prune_agent_events: deleted %d rows older than %s", rc, cutoff.isoformat())
    return rc
