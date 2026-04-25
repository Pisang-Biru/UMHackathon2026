import os
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Header, Query
from sqlalchemy import select, func

from app.db import (
    SessionLocal,
    Agent,
    BusinessAgent,
    AgentEvent,
    AgentAction,
    AgentActionStatus,
)

router = APIRouter(prefix="/agent", tags=["events"])


# ---------- helpers ----------

def _derive_status(last: AgentEvent | None) -> str:
    if last is None:
        return "idle"
    if last.kind == "error" or last.status == "error":
        return "error"
    age = (datetime.now(timezone.utc) - last.ts).total_seconds()
    if age < 60:
        return "working"
    return "idle"


def _row_to_dict(r: AgentEvent, include_trace: bool = False) -> dict:
    return {
        "id": r.id,
        "ts": r.ts.isoformat() if r.ts else None,
        "agent_id": r.agent_id,
        "business_id": r.business_id,
        "conversation_id": r.conversation_id,
        "task_id": r.task_id,
        "kind": r.kind,
        "node": r.node,
        "status": r.status,
        "summary": r.summary,
        "reasoning": r.reasoning,
        "trace": r.trace if include_trace else None,
        "duration_ms": r.duration_ms,
        "tokens_in": r.tokens_in,
        "tokens_out": r.tokens_out,
    }


# ---------- registry ----------

@router.get("/registry")
def registry(business_id: str = Query(...)):
    since_24h = datetime.now(timezone.utc) - timedelta(hours=24)
    with SessionLocal() as s:
        rows = (
            s.query(Agent, BusinessAgent.enabled)
            .join(BusinessAgent, BusinessAgent.agent_id == Agent.id)
            .filter(BusinessAgent.business_id == business_id)
            .order_by(Agent.id.asc())
            .all()
        )
        out = []
        for agent, enabled in rows:
            last = (
                s.query(AgentEvent)
                .filter(AgentEvent.agent_id == agent.id,
                        AgentEvent.business_id == business_id)
                .order_by(AgentEvent.id.desc())
                .first()
            )
            stats_24h = s.execute(
                select(func.count(AgentEvent.id))
                .where(AgentEvent.agent_id == agent.id,
                       AgentEvent.business_id == business_id,
                       AgentEvent.ts >= since_24h)
            ).scalar_one()
            out.append({
                "id": agent.id,
                "name": agent.name,
                "role": agent.role,
                "icon": agent.icon,
                "enabled": bool(enabled),
                "status": _derive_status(last),
                "current_task": (last.summary if last else None),
                "stats_24h": {"events": int(stats_24h)},
            })
        return out


# ---------- events list ----------

@router.get("/events")
def events_list(
    business_id: str = Query(...),
    agent_id: Optional[str] = None,
    conversation_id: Optional[str] = None,
    kind: Optional[str] = None,
    before: Optional[int] = None,
    limit: int = Query(50, ge=1, le=200),
):
    with SessionLocal() as s:
        q = s.query(AgentEvent).filter(AgentEvent.business_id == business_id)
        if agent_id:
            q = q.filter(AgentEvent.agent_id == agent_id)
        if conversation_id:
            q = q.filter(AgentEvent.conversation_id == conversation_id)
        if kind:
            q = q.filter(AgentEvent.kind == kind)
        if before is not None:
            q = q.filter(AgentEvent.id < before)
        q = q.order_by(AgentEvent.id.desc()).limit(limit)
        rows = q.all()
        items = [_row_to_dict(r) for r in rows]
        next_cursor = rows[-1].id if len(rows) == limit else None
        return {"items": items, "next_cursor": next_cursor}


# ---------- event detail ----------

@router.get("/events/{event_id}")
def event_detail(
    event_id: int,
    business_id: str = Query(...),
    x_admin: Optional[str] = Header(default=None, alias="X-Admin"),
):
    with SessionLocal() as s:
        r = (
            s.query(AgentEvent)
            .filter(AgentEvent.id == event_id,
                    AgentEvent.business_id == business_id)
            .first()
        )
        if not r:
            raise HTTPException(status_code=404, detail="event not found")
        include_trace = os.getenv("TRACE_LLM", "0") == "1" and x_admin == "1"
        return _row_to_dict(r, include_trace=include_trace)


# ---------- kpis ----------

@router.get("/kpis")
def kpis(business_id: str = Query(...), window: str = "24h"):
    since = datetime.now(timezone.utc) - timedelta(hours=24)
    with SessionLocal() as s:
        active = s.execute(
            select(func.count(func.distinct(AgentEvent.conversation_id)))
            .where(AgentEvent.business_id == business_id,
                   AgentEvent.ts >= since,
                   AgentEvent.conversation_id.is_not(None))
        ).scalar_one() or 0

        pending = s.execute(
            select(func.count(AgentAction.id))
            .where(AgentAction.businessId == business_id,
                   AgentAction.status == AgentActionStatus.PENDING)
        ).scalar_one() or 0

        total_node_end = s.execute(
            select(func.count(AgentEvent.id))
            .where(AgentEvent.business_id == business_id,
                   AgentEvent.ts >= since,
                   AgentEvent.kind == "node.end")
        ).scalar_one() or 0

        escalations = s.execute(
            select(func.count(AgentEvent.id))
            .where(AgentEvent.business_id == business_id,
                   AgentEvent.ts >= since,
                   AgentEvent.status == "escalate")
        ).scalar_one() or 0

        tokens = s.execute(
            select(func.coalesce(
                func.sum(
                    func.coalesce(AgentEvent.tokens_in, 0)
                    + func.coalesce(AgentEvent.tokens_out, 0)
                ),
                0,
            ))
            .where(AgentEvent.business_id == business_id,
                   AgentEvent.ts >= since)
        ).scalar_one() or 0

        rate = (escalations / total_node_end) if total_node_end else 0.0
        return {
            "active_conversations": int(active),
            "pending_approvals": int(pending),
            "escalation_rate": round(float(rate), 4),
            "tokens_spent": int(tokens),
        }
