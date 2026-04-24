import os
import json
import logging
from datetime import datetime
from typing import Any, Optional

import redis
from sqlalchemy import insert

from app.db import SessionLocal, AgentEvent

log = logging.getLogger(__name__)

REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
_CHANNEL = "agent.events"

_redis: Optional[redis.Redis] = None
_session_factory = SessionLocal


def _get_redis() -> redis.Redis:
    global _redis
    if _redis is None:
        _redis = redis.Redis.from_url(
            REDIS_URL, socket_timeout=2, socket_connect_timeout=2
        )
    return _redis


def _json_default(obj: Any) -> Any:
    if isinstance(obj, datetime):
        return obj.isoformat()
    raise TypeError(f"not serializable: {type(obj)}")


def emit(
    agent_id: str,
    kind: str,
    *,
    conversation_id: Optional[str] = None,
    task_id: Optional[str] = None,
    business_id: Optional[str] = None,
    node: Optional[str] = None,
    status: Optional[str] = None,
    summary: Optional[str] = None,
    reasoning: Optional[str] = None,
    trace: Optional[dict] = None,
    duration_ms: Optional[int] = None,
    tokens_in: Optional[int] = None,
    tokens_out: Optional[int] = None,
) -> None:
    """Dual-write an agent event to Postgres + Redis. Never raises."""
    row: dict[str, Any] = {
        "agent_id": agent_id,
        "kind": kind,
        "conversation_id": conversation_id,
        "task_id": task_id,
        "business_id": business_id,
        "node": node,
        "status": status,
        "summary": summary,
        "reasoning": reasoning,
        "trace": trace,
        "duration_ms": duration_ms,
        "tokens_in": tokens_in,
        "tokens_out": tokens_out,
    }

    row_id: Optional[int] = None
    ts_iso: Optional[str] = None
    try:
        with _session_factory() as s:
            result = s.execute(
                insert(AgentEvent)
                .values(**row)
                .returning(AgentEvent.id, AgentEvent.ts)
            )
            row_id, ts = result.one()
            ts_iso = ts.isoformat() if ts else None
            s.commit()
    except Exception:
        log.exception("emit_event: DB write failed (swallowed)")

    try:
        payload = {"id": row_id, "ts": ts_iso, **row}
        client = _redis if _redis is not None else _get_redis()
        client.publish(_CHANNEL, json.dumps(payload, default=_json_default))
    except Exception:
        log.exception("emit_event: Redis publish failed (swallowed)")
