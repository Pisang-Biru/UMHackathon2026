from decimal import Decimal
from datetime import datetime, timezone
from cuid2 import Cuid
from sqlalchemy import select

from app.db import (
    SessionLocal, Business, Product, Order, OrderStatus,
    FinanceAlert, FinanceAlertKind, MarginStatus,
)
from app.worker.finance_check import check_order_margin

cuid = Cuid().generate


def _seed_basic(session, *, cogs="40.00", packaging="2.00",
                transport="10.00", fee="0.05",
                qty=2, total="200.00",
                business_id=None):
    bid = business_id or cuid()
    pid = cuid()
    oid = cuid()
    if business_id is None:
        session.add(Business(
            id=bid, name="Biz", code=bid[:6],
            userId="test-user",
            platformFeePct=Decimal(fee),
            defaultTransportCost=Decimal("0"),
        ))
        session.flush()
    session.add(Product(
        id=pid, name="P", price=Decimal("100.00"), stock=10,
        businessId=bid,
        cogs=Decimal(cogs) if cogs else None,
        packagingCost=Decimal(packaging) if packaging else None,
    ))
    session.flush()
    session.add(Order(
        id=oid, businessId=bid, productId=pid, qty=qty,
        unitPrice=Decimal("100.00"), totalAmount=Decimal(total),
        status=OrderStatus.PAID, paidAt=datetime.now(timezone.utc),
        transportCost=Decimal(transport) if transport else None,
    ))
    session.commit()
    return bid, pid, oid


def test_ok_writes_margin_no_alert():
    with SessionLocal() as s:
        bid, pid, oid = _seed_basic(s)
    check_order_margin(oid)
    with SessionLocal() as s:
        order = s.get(Order, oid)
        assert order.marginStatus == MarginStatus.OK
        assert order.realMargin == Decimal("96.00")
        alerts = s.execute(select(FinanceAlert).where(FinanceAlert.orderId == oid)).all()
        assert alerts == []


def test_loss_inserts_alert():
    with SessionLocal() as s:
        bid, pid, oid = _seed_basic(s, cogs="90.00", total="100.00", transport="20.00", qty=1)
    check_order_margin(oid)
    with SessionLocal() as s:
        order = s.get(Order, oid)
        assert order.marginStatus == MarginStatus.LOSS
        rows = s.execute(select(FinanceAlert).where(
            FinanceAlert.orderId == oid,
            FinanceAlert.kind == FinanceAlertKind.LOSS,
        )).scalars().all()
        assert len(rows) == 1
        assert rows[0].marginValue == order.realMargin


def test_missing_data_inserts_alert_dedup_per_product():
    with SessionLocal() as s:
        bid, pid, oid = _seed_basic(s, cogs=None)
    check_order_margin(oid)
    check_order_margin(oid)  # idempotent re-run
    with SessionLocal() as s:
        order = s.get(Order, oid)
        assert order.marginStatus == MarginStatus.MISSING_DATA
        assert order.realMargin is None
        rows = s.execute(select(FinanceAlert).where(
            FinanceAlert.productId == pid,
            FinanceAlert.kind == FinanceAlertKind.MISSING_DATA,
            FinanceAlert.resolvedAt.is_(None),
        )).scalars().all()
        assert len(rows) == 1


def test_loss_alert_dedup_per_order():
    with SessionLocal() as s:
        bid, pid, oid = _seed_basic(s, cogs="90.00", total="100.00", transport="20.00", qty=1)
    check_order_margin(oid)
    check_order_margin(oid)
    with SessionLocal() as s:
        rows = s.execute(select(FinanceAlert).where(
            FinanceAlert.orderId == oid,
            FinanceAlert.resolvedAt.is_(None),
        )).scalars().all()
        assert len(rows) == 1


def test_backfill_processes_all_paid_orders():
    from app.worker.finance_check import recompute_all_paid_margins
    with SessionLocal() as s:
        bid, _, _ = _seed_basic(s)  # OK
        _seed_basic(s, business_id=bid, cogs="90.00", total="100.00",
                    transport="20.00", qty=1)  # LOSS
        _seed_basic(s, business_id=bid, cogs=None)  # MISSING_DATA
    out = recompute_all_paid_margins(bid)
    assert out["ok"] is True
    assert out["n_total"] == 3
    assert out["n_ok"] == 1
    assert out["n_loss"] == 1
    assert out["n_missing"] == 1
