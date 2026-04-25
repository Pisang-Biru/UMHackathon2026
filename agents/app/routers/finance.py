from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException

from app.db import SessionLocal, Order, FinanceAlert
from app.worker.finance_check import check_order_margin

router = APIRouter(prefix="/finance", tags=["finance"])


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
