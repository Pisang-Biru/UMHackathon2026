from decimal import Decimal
from datetime import datetime, timezone
from cuid2 import Cuid

from app.db import (
    SessionLocal, Business, Product, Order, OrderStatus,
    MarginStatus, FinanceAlert, FinanceAlertKind,
)
from app.agents.finance.tools import (
    get_product_costs, get_order_margin,
    list_loss_orders, list_missing_data_products,
    product_margin_summary, top_losers,
)

cuid = Cuid().generate


def _seed():
    bid = cuid()
    p_full = cuid()
    p_missing = cuid()
    o_loss = cuid()
    o_ok = cuid()
    with SessionLocal() as s:
        s.add(Business(id=bid, name="B", code=bid[:6],
                       userId="test-user",
                       platformFeePct=Decimal("0.05"),
                       defaultTransportCost=Decimal("0")))
        s.flush()
        s.add(Product(id=p_full, name="Full", price=Decimal("100"), stock=10,
                      businessId=bid, cogs=Decimal("40"), packagingCost=Decimal("2")))
        s.add(Product(id=p_missing, name="Missing", price=Decimal("50"), stock=10,
                      businessId=bid, cogs=None, packagingCost=Decimal("1")))
        s.flush()
        now = datetime.now(timezone.utc)
        s.add(Order(id=o_loss, businessId=bid, productId=p_full, qty=1,
                    unitPrice=Decimal("20"), totalAmount=Decimal("20"),
                    status=OrderStatus.PAID, paidAt=now,
                    transportCost=Decimal("15"),
                    realMargin=Decimal("-38.00"),
                    marginStatus=MarginStatus.LOSS))
        s.add(Order(id=o_ok, businessId=bid, productId=p_full, qty=2,
                    unitPrice=Decimal("100"), totalAmount=Decimal("200"),
                    status=OrderStatus.PAID, paidAt=now,
                    transportCost=Decimal("10"),
                    realMargin=Decimal("96.00"),
                    marginStatus=MarginStatus.OK))
        s.commit()
    return bid, p_full, p_missing, o_loss, o_ok


def test_get_product_costs_full():
    bid, p_full, *_ = _seed()
    out = get_product_costs.invoke({"product_id": p_full})
    assert out["cogs"] == "40.00"
    assert out["missing_fields"] == []


def test_get_product_costs_missing():
    bid, _, p_missing, *_ = _seed()
    out = get_product_costs.invoke({"product_id": p_missing})
    assert "cogs" in out["missing_fields"]


def test_get_order_margin():
    bid, _, _, o_loss, _ = _seed()
    out = get_order_margin.invoke({"order_id": o_loss})
    assert out["margin_status"] == "LOSS"
    assert out["real_margin"] == "-38.00"


def test_list_loss_orders():
    bid, *_ = _seed()
    out = list_loss_orders.invoke({"business_id": bid, "days": 30, "limit": 10})
    assert len(out) == 1
    assert out[0]["margin_status"] == "LOSS"


def test_list_missing_data_products():
    bid, _, p_missing, *_ = _seed()
    out = list_missing_data_products.invoke({"business_id": bid})
    ids = [p["id"] for p in out]
    assert p_missing in ids


def test_product_margin_summary():
    bid, p_full, *_ = _seed()
    out = product_margin_summary.invoke({"product_id": p_full, "days": 30})
    assert out["n_orders"] == 2
    assert Decimal(out["real_margin_total"]) == Decimal("58.00")


def test_top_losers():
    bid, *_ = _seed()
    out = top_losers.invoke({"business_id": bid, "days": 30, "limit": 5})
    assert len(out) >= 1


def test_build_finance_agent_smoke():
    import os
    from langchain_openai import ChatOpenAI
    from app.agents.finance.agent import build_finance_agent
    llm = ChatOpenAI(model=os.getenv("MODEL", "gpt-4o-mini"),
                     openai_api_key=os.getenv("API_KEY", "sk-test"),
                     openai_api_base=os.getenv("OPENAI_API_BASE"),
                     temperature=0)
    graph = build_finance_agent(llm)
    assert graph is not None
