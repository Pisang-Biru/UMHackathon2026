import logging
from decimal import Decimal
from typing import Optional, Tuple

from cuid2 import Cuid as _Cuid

from app.db import SessionLocal, AgentRun, AgentRunStatus

log = logging.getLogger(__name__)
_cuid = _Cuid().generate

_STATUS_MAP = {
    "OK": AgentRunStatus.OK,
    "FAILED": AgentRunStatus.FAILED,
    "SKIPPED": AgentRunStatus.SKIPPED,
}


def record_run(
    *,
    business_id: str,
    agent_type: str,
    kind: str,
    summary: str,
    status: str = "OK",
    duration_ms: Optional[int] = None,
    tokens: Optional[Tuple[int, int, int]] = None,
    cost_usd: Optional[Decimal] = None,
    payload: Optional[dict] = None,
    ref: Optional[Tuple[str, str]] = None,
) -> None:
    """Insert one agent_run row. Never raise — telemetry must not break agents."""
    try:
        in_t, out_t, cached_t = tokens if tokens is not None else (None, None, None)
        ref_table, ref_id = ref if ref is not None else (None, None)
        with SessionLocal() as s:
            row = AgentRun(
                id=_cuid(),
                businessId=business_id,
                agentType=agent_type,
                kind=kind,
                summary=summary[:500],
                status=_STATUS_MAP.get(status, AgentRunStatus.OK),
                durationMs=duration_ms,
                inputTokens=in_t,
                outputTokens=out_t,
                cachedTokens=cached_t,
                costUsd=cost_usd,
                payload=payload or {},
                refTable=ref_table,
                refId=ref_id,
            )
            s.add(row)
            s.commit()
    except Exception:
        log.exception("record_run: failed for agent_type=%s kind=%s", agent_type, kind)
