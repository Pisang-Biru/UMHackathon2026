from decimal import Decimal
from datetime import datetime, timedelta, timezone
from app.db import Product, Order, OrderStatus
from app.agents.customer_support import _create_order, _make_order_lookup_tool


def _seed_product(session, product_id="p1", stock=100, price=Decimal("5.00")):
    session.add(Product(
        id=product_id,
        businessId="biz1",
        name="Pisang",
        price=price,
        stock=stock,
    ))
    session.commit()


def test_create_order_persists_buyer_contact(session):
    _seed_product(session)
    order_id, payment_url = _create_order("biz1", "p1", 3, buyer_contact="+60123456789")
    row = session.query(Order).filter(Order.id == order_id).one()
    assert row.buyerContact == "+60123456789"
    assert row.qty == 3
    assert row.businessId == "biz1"
    assert payment_url.endswith(f"/pay/{order_id}")
    assert row.paymentUrl == payment_url


def _seed_order(session, order_id, phone, status=OrderStatus.PENDING_PAYMENT,
                business_id="biz1", product_id="p1", qty=1, paid_at=None,
                created_at=None):
    session.add(Order(
        id=order_id,
        businessId=business_id,
        productId=product_id,
        agentType="support",
        qty=qty,
        unitPrice=Decimal("5.00"),
        totalAmount=Decimal("5.00") * qty,
        status=status,
        buyerContact=phone,
        paidAt=paid_at,
        createdAt=created_at or datetime.now(timezone.utc),
    ))
    session.commit()


def test_lookup_returns_no_orders_when_empty(session):
    _seed_product(session)
    tool = _make_order_lookup_tool("biz1", "+60123456789")
    result = tool.invoke({})
    assert result == "no orders found for this phone"


def test_lookup_returns_pending_order_with_pay_url(session):
    _seed_product(session)
    _seed_order(session, "order-aaaaaaaabbbbbbbb", "+60123456789",
                status=OrderStatus.PENDING_PAYMENT, qty=20)
    tool = _make_order_lookup_tool("biz1", "+60123456789")
    result = tool.invoke({})
    assert "order-aa" in result
    assert "20x Pisang" in result
    assert "PENDING_PAYMENT" in result
    assert "/pay/order-aaaaaaaabbbbbbbb" in result


def test_lookup_returns_paid_order_without_pay_url(session):
    _seed_product(session)
    paid = datetime.now(timezone.utc)
    _seed_order(session, "order-paid1111111111111", "+60123456789",
                status=OrderStatus.PAID, paid_at=paid)
    tool = _make_order_lookup_tool("biz1", "+60123456789")
    result = tool.invoke({})
    assert "PAID" in result
    assert "/pay/" not in result
    assert "paid " in result


def test_lookup_orders_newest_first_limit_5(session):
    _seed_product(session, stock=100)
    base = datetime.now(timezone.utc)
    for i in range(7):
        _seed_order(session, f"order-{i:016d}", "+60123456789",
                    created_at=base - timedelta(days=7 - i))
    tool = _make_order_lookup_tool("biz1", "+60123456789")
    result = tool.invoke({})
    lines = [line for line in result.splitlines() if line.strip()]
    assert len(lines) == 5
    assert "order-00" in lines[0]
    assert "order-00000000000000006"[:10] in lines[0]


def test_lookup_scopes_by_business_id(session):
    from sqlalchemy import text
    _seed_product(session)
    session.execute(text(
        "INSERT INTO business (id, name, code, \"userId\", \"createdAt\", \"updatedAt\") "
        "VALUES ('biz2', 'Other Biz', 'TEST-BIZ-002', 'test-user', NOW(), NOW()) "
        "ON CONFLICT (id) DO NOTHING"
    ))
    session.add(Product(
        id="p2", businessId="biz2", name="Other", price=Decimal("5.00"), stock=100,
    ))
    session.commit()
    _seed_order(session, "order-other-biz-11111", "+60123456789",
                business_id="biz2", product_id="p2")
    tool = _make_order_lookup_tool("biz1", "+60123456789")
    result = tool.invoke({})
    assert result == "no orders found for this phone"


def test_lookup_missing_phone_returns_error_string(session):
    _seed_product(session)
    tool = _make_order_lookup_tool("biz1", "")
    result = tool.invoke({})
    assert result.startswith("ERROR:")
