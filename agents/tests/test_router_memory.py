import pytest
from fastapi.testclient import TestClient
from app.main import app


def test_support_chat_accepts_customer_phone(monkeypatch):
    from app.routers import support as support_router

    captured = {}

    async def fake_ainvoke(state):
        captured.update(state)
        return {
            "action": "auto_send",
            "draft_reply": "hi back",
            "action_id": "act1",
            "confidence": 0.9,
        }

    monkeypatch.setattr(support_router, "_support_graph_ainvoke", fake_ainvoke)

    client = TestClient(app)
    r = client.post("/agent/support/chat", json={
        "business_id": "biz1",
        "customer_id": "c1",
        "customer_phone": "+60123456789",
        "message": "hi",
    })
    assert r.status_code == 200
    assert captured["customer_phone"] == "+60123456789"


def test_support_chat_without_phone_defaults_empty(monkeypatch):
    from app.routers import support as support_router
    captured = {}

    async def fake_ainvoke(state):
        captured.update(state)
        return {"action": "auto_send", "draft_reply": "ok", "action_id": "a", "confidence": 0.9}

    monkeypatch.setattr(support_router, "_support_graph_ainvoke", fake_ainvoke)

    client = TestClient(app)
    r = client.post("/agent/support/chat", json={
        "business_id": "biz1",
        "customer_id": "c1",
        "message": "hi",
    })
    assert r.status_code == 200
    assert captured["customer_phone"] == ""


def test_approve_enqueues_past_action(monkeypatch):
    from app.routers import support as support_router
    from datetime import datetime, timezone
    from app.db import SessionLocal, AgentAction, AgentActionStatus
    import cuid2
    calls = []
    monkeypatch.setattr(support_router, "_enqueue_past_action",
                         lambda action_id: calls.append(action_id))

    aid = cuid2.Cuid().generate()
    with SessionLocal() as s:
        s.add(AgentAction(
            id=aid, businessId="biz1", customerMsg="q", draftReply="d",
            confidence=0.5, reasoning="r", status=AgentActionStatus.PENDING,
            createdAt=datetime.now(timezone.utc),
            updatedAt=datetime.now(timezone.utc),
        ))
        s.commit()

    client = TestClient(app)
    r = client.post(f"/agent/actions/{aid}/approve")
    assert r.status_code == 200
    assert aid in calls
