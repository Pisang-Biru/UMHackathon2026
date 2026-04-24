import logging
import os
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from langchain_core.messages import HumanMessage
from app.db import SessionLocal, AgentAction, AgentActionStatus
from app.memory.phone import normalize_phone
from typing import Optional


router = APIRouter(prefix="/agent", tags=["support"])

_log = logging.getLogger(__name__)

# Module-level dict mapping action_id -> Celery task_id for pending memory tasks.
# Used by /unsend to revoke the embed task before it fires.
_PENDING_MEMORY_TASKS: dict[str, Optional[str]] = {}

UNSEND_WINDOW_SECONDS = 10


def _get_past_action_task():
    """Indirection so tests can monkeypatch without importing Celery."""
    from app.worker.tasks import embed_past_action
    return embed_past_action


def _enqueue_past_action_deferred(action_id: str, countdown_s: int = 10) -> Optional[str]:
    if os.environ.get("MEMORY_ENABLED", "true").lower() != "true":
        return None
    try:
        task = _get_past_action_task()
        result = task.apply_async(kwargs={"action_id": action_id}, countdown=countdown_s)
        return result.id
    except Exception as e:
        _log.warning("deferred past-action enqueue failed: %s", e)
        return None


def _revoke_memory_task(action_id: str):
    task_id = _PENDING_MEMORY_TASKS.pop(action_id, None)
    if not task_id:
        return
    try:
        from app.worker.celery_app import celery_app
        celery_app.control.revoke(task_id, terminate=False)
    except Exception as e:
        _log.warning("revoke memory task failed: %s", e)


async def _support_graph_ainvoke(state):
    """Indirection so tests can monkeypatch."""
    raise NotImplementedError("assigned in make_support_router")


def _load_escalation_summary(action_id: str) -> Optional[str]:
    with SessionLocal() as session:
        action = session.query(AgentAction).filter(AgentAction.id == action_id).first()
        if not action:
            return None
        return action.reasoning


class SupportChatRequest(BaseModel):
    business_id: str
    customer_id: str
    customer_phone: Optional[str] = None
    message: str


class SupportChatResponse(BaseModel):
    status: str
    reply: Optional[str] = None
    action_id: Optional[str] = None
    confidence: Optional[float] = None
    best_draft: Optional[str] = None
    escalation_summary: Optional[str] = None


class EditRequest(BaseModel):
    reply: str


class AgentActionOut(BaseModel):
    id: str
    businessId: str
    customerMsg: str
    draftReply: str
    finalReply: Optional[str]
    confidence: float
    reasoning: str
    status: str
    createdAt: Optional[str] = None


def make_support_router(support_graph):
    global _support_graph_ainvoke

    async def _real_invoke(state):
        return await support_graph.ainvoke(state)

    _support_graph_ainvoke = _real_invoke

    @router.post("/support/chat", response_model=SupportChatResponse)
    async def support_chat(req: SupportChatRequest):
        try:
            result = await _support_graph_ainvoke({
                "messages": [HumanMessage(content=req.message)],
                "business_id": req.business_id,
                "customer_id": req.customer_id,
                "customer_phone": normalize_phone(req.customer_phone) if req.customer_phone else "",
                "revision_count": 0,
                "iterations": [],
            })

            # Manager graph shape
            if "final_action" in result:
                action_id = result.get("action_id")
                if result["final_action"] == "auto_send":
                    # Re-read the finalReply from DB for consistency, avoid state bleed
                    with SessionLocal() as session:
                        row = session.query(AgentAction).filter_by(id=action_id).first()
                        reply = row.finalReply if row else None
                        confidence = row.confidence if row else 0.0
                    return SupportChatResponse(
                        status="sent",
                        reply=reply,
                        action_id=action_id,
                        confidence=confidence,
                    )
                # escalate
                return SupportChatResponse(
                    status="pending_approval",
                    action_id=action_id,
                    best_draft=result.get("best_draft"),
                    escalation_summary=_load_escalation_summary(action_id),
                )

            # Legacy support_graph path (MANAGER_ENABLED=false)
            action_id = result.get("action_id", "")
            confidence = result.get("confidence", 0.0)
            draft = result.get("draft_reply", "")
            should_auto = confidence >= 0.8
            if should_auto:
                return SupportChatResponse(status="sent", reply=draft, action_id=action_id, confidence=confidence)
            return SupportChatResponse(status="pending_approval", action_id=action_id, confidence=confidence)

        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @router.get("/actions", response_model=list[AgentActionOut])
    def list_actions(business_id: str, status: Optional[str] = None):
        with SessionLocal() as session:
            query = session.query(AgentAction).filter(AgentAction.businessId == business_id)
            if status:
                try:
                    status_enum = AgentActionStatus[status]
                    query = query.filter(AgentAction.status == status_enum)
                except KeyError:
                    raise HTTPException(status_code=400, detail=f"Invalid status: {status}. Must be PENDING, APPROVED, REJECTED, or AUTO_SENT")
            actions = query.order_by(AgentAction.createdAt.desc()).all()
            return [
                AgentActionOut(
                    id=a.id,
                    businessId=a.businessId,
                    customerMsg=a.customerMsg,
                    draftReply=a.draftReply,
                    finalReply=a.finalReply,
                    confidence=a.confidence,
                    reasoning=a.reasoning,
                    status=a.status.value,
                    createdAt=a.createdAt.isoformat() if a.createdAt else None,
                )
                for a in actions
            ]

    @router.post("/actions/{action_id}/approve", response_model=AgentActionOut)
    def approve_action(action_id: str, body: Optional[EditRequest] = None):
        with SessionLocal() as session:
            action = session.query(AgentAction).filter(AgentAction.id == action_id).first()
            if not action:
                raise HTTPException(status_code=404, detail="Action not found")
            if action.status != AgentActionStatus.PENDING:
                raise HTTPException(status_code=400, detail=f"Action is {action.status.value}, not PENDING")

            final_text = body.reply if body and body.reply else action.draftReply
            action.status = AgentActionStatus.APPROVED
            action.finalReply = final_text
            session.commit()
            session.refresh(action)

            task_id = _enqueue_past_action_deferred(action.id, countdown_s=10)
            # Store task id so unsend can revoke it before it fires.
            _PENDING_MEMORY_TASKS[action.id] = task_id

            return AgentActionOut(
                id=action.id,
                businessId=action.businessId,
                customerMsg=action.customerMsg,
                draftReply=action.draftReply,
                finalReply=action.finalReply,
                confidence=action.confidence,
                reasoning=action.reasoning,
                status=action.status.value,
                createdAt=action.createdAt.isoformat() if action.createdAt else None,
            )

    @router.post("/actions/{action_id}/reject", response_model=AgentActionOut)
    def reject_action(action_id: str):
        with SessionLocal() as session:
            action = session.query(AgentAction).filter(AgentAction.id == action_id).first()
            if not action:
                raise HTTPException(status_code=404, detail="Action not found")
            if action.status != AgentActionStatus.PENDING:
                raise HTTPException(status_code=400, detail=f"Action is {action.status.value}, not PENDING")
            action.status = AgentActionStatus.REJECTED
            session.commit()
            session.refresh(action)
            return AgentActionOut(
                id=action.id,
                businessId=action.businessId,
                customerMsg=action.customerMsg,
                draftReply=action.draftReply,
                finalReply=action.finalReply,
                confidence=action.confidence,
                reasoning=action.reasoning,
                status=action.status.value,
                createdAt=action.createdAt.isoformat() if action.createdAt else None,
            )

    from fastapi import Response

    @router.get("/actions/{action_id}/iterations")
    def get_iterations(action_id: str, response: Response):
        response.headers["Cache-Control"] = "private, max-age=3600, immutable"
        with SessionLocal() as session:
            action = session.query(AgentAction).filter(AgentAction.id == action_id).first()
            if not action:
                raise HTTPException(status_code=404, detail="Action not found")
            return {"iterations": action.iterations or []}

    @router.post("/actions/{action_id}/unsend", response_model=AgentActionOut)
    def unsend_action(action_id: str):
        with SessionLocal() as session:
            action = session.query(AgentAction).filter(AgentAction.id == action_id).first()
            if not action:
                raise HTTPException(status_code=404, detail="Action not found")
            if action.status != AgentActionStatus.APPROVED:
                raise HTTPException(status_code=400, detail="Only APPROVED actions can be unsent")
            # action.updatedAt may be naive UTC; compare as UTC
            updated = action.updatedAt
            if updated.tzinfo is None:
                updated = updated.replace(tzinfo=timezone.utc)
            if datetime.now(timezone.utc) - updated > timedelta(seconds=UNSEND_WINDOW_SECONDS):
                raise HTTPException(status_code=409, detail="Unsend window expired")
            action.status = AgentActionStatus.PENDING
            action.finalReply = None
            session.commit()
            session.refresh(action)
        _revoke_memory_task(action_id)
        return AgentActionOut(
            id=action.id, businessId=action.businessId, customerMsg=action.customerMsg,
            draftReply=action.draftReply, finalReply=action.finalReply,
            confidence=action.confidence, reasoning=action.reasoning,
            status=action.status.value, createdAt=action.createdAt.isoformat() if action.createdAt else None,
        )

    return router
