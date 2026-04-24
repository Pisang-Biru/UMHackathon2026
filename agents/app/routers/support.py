import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from langchain_core.messages import HumanMessage
from app.db import SessionLocal, AgentAction, AgentActionStatus
from app.memory.phone import normalize_phone
from typing import Optional


router = APIRouter(prefix="/agent", tags=["support"])

_log = logging.getLogger(__name__)


def _enqueue_past_action(action_id: str):
    import os
    if os.environ.get("MEMORY_ENABLED", "true").lower() != "true":
        return
    try:
        from app.worker.tasks import embed_past_action
        embed_past_action.delay(action_id)
    except Exception as e:
        _log.warning("enqueue past action failed: %s", e)


async def _support_graph_ainvoke(state):
    """Indirection so tests can monkeypatch."""
    raise NotImplementedError("assigned in make_support_router")


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
    createdAt: str


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
                "memory_block": "",
                "business_context": "",
                "draft_reply": "",
                "confidence": 0.0,
                "reasoning": "",
                "action": "queue_approval",
                "action_id": "",
            })
            if result["action"] == "auto_send":
                return SupportChatResponse(
                    status="sent",
                    reply=result["draft_reply"],
                    action_id=result["action_id"],
                    confidence=result["confidence"],
                )
            else:
                return SupportChatResponse(
                    status="pending_approval",
                    action_id=result["action_id"],
                    confidence=result["confidence"],
                )
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
                    createdAt=a.createdAt.isoformat(),
                )
                for a in actions
            ]

    @router.post("/actions/{action_id}/approve", response_model=AgentActionOut)
    def approve_action(action_id: str):
        with SessionLocal() as session:
            action = session.query(AgentAction).filter(AgentAction.id == action_id).first()
            if not action:
                raise HTTPException(status_code=404, detail="Action not found")
            if action.status != AgentActionStatus.PENDING:
                raise HTTPException(status_code=400, detail=f"Action is {action.status.value}, not PENDING")
            action.status = AgentActionStatus.APPROVED
            action.finalReply = action.draftReply
            session.commit()
            session.refresh(action)
            _enqueue_past_action(action.id)
            return AgentActionOut(
                id=action.id,
                businessId=action.businessId,
                customerMsg=action.customerMsg,
                draftReply=action.draftReply,
                finalReply=action.finalReply,
                confidence=action.confidence,
                reasoning=action.reasoning,
                status=action.status.value,
                createdAt=action.createdAt.isoformat(),
            )

    @router.post("/actions/{action_id}/edit", response_model=AgentActionOut)
    def edit_action(action_id: str, body: EditRequest):
        with SessionLocal() as session:
            action = session.query(AgentAction).filter(AgentAction.id == action_id).first()
            if not action:
                raise HTTPException(status_code=404, detail="Action not found")
            if action.status != AgentActionStatus.PENDING:
                raise HTTPException(status_code=400, detail=f"Action is {action.status.value}, not PENDING")
            action.status = AgentActionStatus.APPROVED
            action.finalReply = body.reply
            session.commit()
            session.refresh(action)
            _enqueue_past_action(action.id)
            return AgentActionOut(
                id=action.id,
                businessId=action.businessId,
                customerMsg=action.customerMsg,
                draftReply=action.draftReply,
                finalReply=action.finalReply,
                confidence=action.confidence,
                reasoning=action.reasoning,
                status=action.status.value,
                createdAt=action.createdAt.isoformat(),
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
                createdAt=action.createdAt.isoformat(),
            )

    return router
