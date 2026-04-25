from decimal import Decimal
from datetime import datetime, timezone
from cuid2 import Cuid
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.main import app
from app.db import (
    SessionLocal, Business, Product, Order, OrderStatus,
    FinanceAlert, FinanceAlertKind,
)

cuid = Cuid().generate
client = TestClient(app)


def _seed_loss():
    bid, pid, oid = cuid(), cuid(), cuid()
    with SessionLocal() as s:
        s.add(Business(id=bid, name="B", code=bid[:6],
                       userId="test-user",
                       platformFeePct=Decimal("0.05"),
                       defaultTransportCost=Decimal("0")))
        s.flush()
        s.add(Product(id=pid, name="P", price=Decimal("100"), stock=1,
                      businessId=bid, cogs=Decimal("90"),
                      packagingCost=Decimal("2")))
        s.flush()
        s.add(Order(id=oid, businessId=bid, productId=pid, qty=1,
                    unitPrice=Decimal("100"), totalAmount=Decimal("100"),
                    status=OrderStatus.PAID, paidAt=datetime.now(timezone.utc),
                    transportCost=Decimal("20")))
        s.commit()
    return bid, pid, oid


def test_check_endpoint_runs_margin():
    _, _, oid = _seed_loss()
    r = client.post(f"/finance/check/{oid}")
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["status"] == "LOSS"


def test_resolve_alert_sets_resolvedAt():
    _, _, oid = _seed_loss()
    client.post(f"/finance/check/{oid}")
    with SessionLocal() as s:
        alert = s.execute(select(FinanceAlert).where(
            FinanceAlert.orderId == oid,
            FinanceAlert.kind == FinanceAlertKind.LOSS,
        )).scalar_one()
        aid = alert.id
    r = client.post(f"/finance/alerts/{aid}/resolve")
    assert r.status_code == 200
    with SessionLocal() as s:
        alert = s.get(FinanceAlert, aid)
        assert alert.resolvedAt is not None


def test_check_unknown_order_404():
    r = client.post("/finance/check/does-not-exist")
    assert r.status_code == 404


def test_chat_endpoint_returns_reply(monkeypatch):
    from app.routers import finance as fin_mod
    class _FakeGraph:
        async def ainvoke(self, state):
            from langchain_core.messages import AIMessage
            return {"messages": [AIMessage(content="real margin RM10.00")]}
    monkeypatch.setattr(fin_mod, "_finance_graph", _FakeGraph())

    bid, _, _ = _seed_loss()
    r = client.post("/finance/chat", json={"business_id": bid, "message": "untung minggu ni?"})
    assert r.status_code == 200
    body = r.json()
    assert body["agent_id"] == "finance"
    assert "RM10.00" in body["reply"]


def test_is_finance_intent():
    from app.agents.finance.agent import is_finance_intent
    assert is_finance_intent("untung minggu ni?")
    assert is_finance_intent("what's the margin")
    assert is_finance_intent("kos packaging")
    assert not is_finance_intent("hello")
    assert not is_finance_intent("")
    assert not is_finance_intent(None)
