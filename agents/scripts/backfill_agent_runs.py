"""One-shot backfill: AgentAction rows from manager*/customer_support
agents become AgentRun rows. Idempotent via (refTable, refId) unique."""

import logging
import sys
from cuid2 import Cuid as _Cuid
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.db import SessionLocal, AgentAction, AgentActionStatus, AgentRun, AgentRunStatus

log = logging.getLogger(__name__)
_cuid = _Cuid().generate

_LEGACY_AGENT_TYPES = ("manager", "manager_terminal", "support", "customer_support")

_STATUS_FROM_ACTION = {
    AgentActionStatus.AUTO_SENT: AgentRunStatus.OK,
    AgentActionStatus.APPROVED: AgentRunStatus.OK,
    AgentActionStatus.REJECTED: AgentRunStatus.FAILED,
    # PENDING is intentionally skipped (in-flight, not a completed run)
}


def backfill() -> int:
    """Return number of newly inserted rows."""
    inserted = 0
    with SessionLocal() as s:
        actions = s.query(AgentAction).all()
        for a in actions:
            agent_type = a.agentType or "support"
            if agent_type not in _LEGACY_AGENT_TYPES:
                continue
            mapped = _STATUS_FROM_ACTION.get(a.status)
            if mapped is None:
                continue
            stmt = (
                pg_insert(AgentRun.__table__)
                .values(
                    id=_cuid(),
                    businessId=a.businessId,
                    agentType="customer_support" if agent_type in ("support", "customer_support") else agent_type,
                    kind="legacy_action",
                    summary=(a.customerMsg or "")[:200],
                    status=mapped,
                    durationMs=None,
                    inputTokens=a.inputTokens,
                    outputTokens=a.outputTokens,
                    cachedTokens=a.cachedTokens,
                    costUsd=a.costUsd,
                    payload={"confidence": float(a.confidence)},
                    refTable="agent_action",
                    refId=a.id,
                    createdAt=a.createdAt,
                )
                .on_conflict_do_nothing(index_elements=["refTable", "refId"])
            )
            res = s.execute(stmt)
            inserted += int(res.rowcount or 0)
        s.commit()
    return inserted


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    n = backfill()
    print(f"backfill inserted {n} agent_run rows")
    sys.exit(0)
