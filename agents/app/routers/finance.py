import os
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from langchain_core.messages import HumanMessage
from langchain_openai import ChatOpenAI

from app.db import SessionLocal, Order, FinanceAlert
from app.worker.finance_check import check_order_margin, recompute_all_paid_margins
from app.agents.finance.agent import build_finance_agent

router = APIRouter(prefix="/finance", tags=["finance"])

_finance_llm = ChatOpenAI(
    model=os.getenv("MODEL", "gpt-4o-mini"),
    openai_api_key=os.getenv("API_KEY", "sk-test"),
    openai_api_base=os.getenv("OPENAI_API_BASE"),
    temperature=0.2,
)
_finance_graph = build_finance_agent(_finance_llm)


class FinanceChatIn(BaseModel):
    business_id: str
    message: str


@router.post("/check/{order_id}")
def trigger_check(order_id: str) -> dict:
    with SessionLocal() as s:
        order = s.get(Order, order_id)
        if order is None:
            raise HTTPException(status_code=404, detail="order not found")
    return check_order_margin(order_id)


@router.post("/alerts/{alert_id}/resolve")
def resolve_alert(alert_id: str) -> dict:
    with SessionLocal() as s:
        alert = s.get(FinanceAlert, alert_id)
        if alert is None:
            raise HTTPException(status_code=404, detail="alert not found")
        alert.resolvedAt = datetime.now(timezone.utc)
        s.commit()
        return {"ok": True, "resolvedAt": alert.resolvedAt.isoformat()}


@router.post("/backfill/{business_id}")
def trigger_backfill(business_id: str) -> dict:
    return recompute_all_paid_margins(business_id)


@router.post("/chat")
async def finance_chat(payload: FinanceChatIn) -> dict:
    state = {
        "business_id": payload.business_id,
        "messages": [HumanMessage(content=payload.message)],
    }
    out = await _finance_graph.ainvoke(state)
    last = out["messages"][-1]
    return {"reply": getattr(last, "content", ""), "agent_id": "finance"}
