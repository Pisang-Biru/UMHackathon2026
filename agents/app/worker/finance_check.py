import logging
from cuid2 import Cuid as _Cuid
from sqlalchemy import select
from app.db import (
    SessionLocal, Order, OrderStatus, Product, Business,
    FinanceAlert, FinanceAlertKind, MarginStatus,
)
from app.agents.finance.margin import compute_margin
from app.worker.celery_app import celery

log = logging.getLogger(__name__)
_cuid = _Cuid().generate


@celery.task(name="finance.check_order_margin")
def check_order_margin(order_id: str) -> dict:
    """Compute margin for the given order, persist on Order row,
    and insert FinanceAlert when LOSS or MISSING_DATA. Idempotent.
    Returns a small dict for logging/testing.
    """
    with SessionLocal() as s:
        order = s.get(Order, order_id)
        if order is None:
            log.warning("check_order_margin: order %s not found", order_id)
            return {"ok": False, "reason": "missing_order"}
        product = s.get(Product, order.productId)
        business = s.get(Business, order.businessId)
        if product is None or business is None:
            log.warning("check_order_margin: missing product/business for %s", order_id)
            return {"ok": False, "reason": "missing_relations"}

        outcome = compute_margin(order, product, business)
        order.realMargin = outcome.real_margin
        order.marginStatus = outcome.status

        if outcome.status == MarginStatus.LOSS:
            existing = s.execute(select(FinanceAlert).where(
                FinanceAlert.orderId == order.id,
                FinanceAlert.kind == FinanceAlertKind.LOSS,
                FinanceAlert.resolvedAt.is_(None),
            )).scalar_one_or_none()
            if existing is None:
                short = order.id[:8]
                s.add(FinanceAlert(
                    id=_cuid(),
                    businessId=order.businessId,
                    orderId=order.id,
                    kind=FinanceAlertKind.LOSS,
                    marginValue=outcome.real_margin,
                    message=f"Order {short}: real margin RM{outcome.real_margin} (loss)",
                ))
        elif outcome.status == MarginStatus.MISSING_DATA:
            existing = s.execute(select(FinanceAlert).where(
                FinanceAlert.productId == product.id,
                FinanceAlert.kind == FinanceAlertKind.MISSING_DATA,
                FinanceAlert.resolvedAt.is_(None),
            )).scalar_one_or_none()
            if existing is None:
                fields = ", ".join(outcome.missing_fields)
                s.add(FinanceAlert(
                    id=_cuid(),
                    businessId=order.businessId,
                    productId=product.id,
                    kind=FinanceAlertKind.MISSING_DATA,
                    message=f"Product '{product.name}' missing: {fields}",
                ))

        s.commit()
        return {
            "ok": True,
            "status": outcome.status.value,
            "real_margin": str(outcome.real_margin) if outcome.real_margin is not None else None,
        }


@celery.task(name="finance.recompute_all_paid_margins")
def recompute_all_paid_margins(business_id: str) -> dict:
    """Operator-triggered backfill: run check_order_margin for every PAID
    order belonging to the business. Returns counts."""
    with SessionLocal() as s:
        rows = s.execute(
            select(Order.id).where(
                Order.businessId == business_id,
                Order.status == OrderStatus.PAID,
            )
        ).scalars().all()
    n_ok = n_loss = n_missing = 0
    for oid in rows:
        out = check_order_margin(oid)
        st = out.get("status")
        if st == "OK":
            n_ok += 1
        elif st == "LOSS":
            n_loss += 1
        elif st == "MISSING_DATA":
            n_missing += 1
    return {
        "ok": True,
        "n_total": len(rows),
        "n_ok": n_ok,
        "n_loss": n_loss,
        "n_missing": n_missing,
    }
