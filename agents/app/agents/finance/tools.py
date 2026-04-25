from datetime import datetime, timezone, timedelta
from decimal import Decimal
from typing import Optional
from sqlalchemy import select, func
from langchain_core.tools import tool

from app.db import (
    SessionLocal, Product, Order, OrderStatus,
    MarginStatus,
)


def _dec_str(v) -> Optional[str]:
    return str(v) if v is not None else None


@tool
def get_product_costs(product_id: str) -> dict:
    """Return cogs, packagingCost, and which fields are missing for a product."""
    with SessionLocal() as s:
        p = s.get(Product, product_id)
        if p is None:
            return {"error": "product not found"}
        missing = []
        if p.cogs is None:
            missing.append("cogs")
        if p.packagingCost is None:
            missing.append("packagingCost")
        return {
            "id": p.id,
            "name": p.name,
            "cogs": _dec_str(p.cogs),
            "packagingCost": _dec_str(p.packagingCost),
            "missing_fields": missing,
        }


@tool
def get_order_margin(order_id: str) -> dict:
    """Return cached real margin and breakdown for a single order."""
    with SessionLocal() as s:
        o = s.get(Order, order_id)
        if o is None:
            return {"error": "order not found"}
        return {
            "id": o.id,
            "margin_status": o.marginStatus.value if o.marginStatus else None,
            "real_margin": _dec_str(o.realMargin),
            "revenue": _dec_str(o.totalAmount),
            "transport_cost": _dec_str(o.transportCost),
            "qty": o.qty,
            "status": o.status.value,
        }


@tool
def list_loss_orders(business_id: str, days: int = 30, limit: int = 20) -> list[dict]:
    """List PAID orders within `days` for `business_id` whose marginStatus is LOSS."""
    since = datetime.now(timezone.utc) - timedelta(days=days)
    with SessionLocal() as s:
        rows = s.execute(
            select(Order)
            .where(Order.businessId == business_id,
                   Order.marginStatus == MarginStatus.LOSS,
                   Order.paidAt >= since)
            .order_by(Order.realMargin.asc())
            .limit(limit)
        ).scalars().all()
        return [{
            "id": o.id,
            "real_margin": _dec_str(o.realMargin),
            "margin_status": o.marginStatus.value,
            "paid_at": o.paidAt.isoformat() if o.paidAt else None,
            "product_id": o.productId,
        } for o in rows]


@tool
def list_missing_data_products(business_id: str) -> list[dict]:
    """List products with one or more null cost fields."""
    with SessionLocal() as s:
        rows = s.execute(
            select(Product).where(
                Product.businessId == business_id,
                (Product.cogs.is_(None)) | (Product.packagingCost.is_(None)),
            )
        ).scalars().all()
        out = []
        for p in rows:
            missing = []
            if p.cogs is None:
                missing.append("cogs")
            if p.packagingCost is None:
                missing.append("packagingCost")
            out.append({"id": p.id, "name": p.name, "missing_fields": missing})
        return out


@tool
def product_margin_summary(product_id: str, days: int = 30) -> dict:
    """Aggregate revenue, real margin, margin %, n_orders for a product."""
    since = datetime.now(timezone.utc) - timedelta(days=days)
    with SessionLocal() as s:
        rows = s.execute(
            select(Order).where(
                Order.productId == product_id,
                Order.status == OrderStatus.PAID,
                Order.paidAt >= since,
            )
        ).scalars().all()
        revenue = sum((o.totalAmount or Decimal(0) for o in rows), Decimal(0))
        margin = sum((o.realMargin or Decimal(0) for o in rows
                      if o.marginStatus == MarginStatus.OK or o.marginStatus == MarginStatus.LOSS),
                     Decimal(0))
        n = len(rows)
        pct = None
        if revenue > 0:
            pct = str((margin / revenue * Decimal(100)).quantize(Decimal("0.01")))
        return {
            "product_id": product_id,
            "days": days,
            "n_orders": n,
            "revenue_total": str(revenue.quantize(Decimal("0.01"))),
            "real_margin_total": str(margin.quantize(Decimal("0.01"))),
            "margin_pct": pct,
        }


@tool
def top_losers(business_id: str, days: int = 30, limit: int = 5) -> list[dict]:
    """Products ranked by worst aggregate real margin within `days`."""
    since = datetime.now(timezone.utc) - timedelta(days=days)
    with SessionLocal() as s:
        rows = s.execute(
            select(Order.productId, func.sum(Order.realMargin).label("m"))
            .where(Order.businessId == business_id,
                   Order.status == OrderStatus.PAID,
                   Order.paidAt >= since,
                   Order.realMargin.is_not(None))
            .group_by(Order.productId)
            .order_by(func.sum(Order.realMargin).asc())
            .limit(limit)
        ).all()
        return [{"product_id": pid, "real_margin_total": str(m)} for pid, m in rows]
