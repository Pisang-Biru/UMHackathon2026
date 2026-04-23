from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from langchain_core.messages import HumanMessage
from app.db import SessionLocal, AgentAction, AgentActionStatus
from typing import Optional


router = APIRouter(prefix="/agent", tags=["support"])


class SupportChatRequest(BaseModel):
    business_id: str
    customer_id: str
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
    @router.post("/support/chat", response_model=SupportChatResponse)
    async def support_chat(req: SupportChatRequest):
        try:
            result = await support_graph.ainvoke({
                "messages": [HumanMessage(content=req.message)],
                "business_id": req.business_id,
                "customer_id": req.customer_id,
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
