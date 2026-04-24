import pytest
from fastapi.testclient import TestClient
from app.main import app


def test_support_chat_accepts_customer_phone(monkeypatch):
    from app.routers import support as support_router

    captured = {}

    async def fake_ainvoke(state):
        captured.update(state)
        return {
            "draft_reply": "hi back",
            "confidence": 0.9,
            "reasoning": "clear",
            "structured_reply": None,
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
        return {"draft_reply": "ok", "confidence": 0.9, "reasoning": "clear", "structured_reply": None}

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

    # Patch _get_past_action_task to capture apply_async calls (deferred enqueue)
    calls = []
    class _FakeTask:
        def apply_async(self, kwargs=None, countdown=None):
            calls.append(kwargs.get("action_id") if kwargs else None)
            class _Result:
                id = "task-stub"
            return _Result()
    monkeypatch.setattr(support_router, "_get_past_action_task", lambda: _FakeTask())

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


def test_reindex_product_endpoint_enqueues(monkeypatch):
    from app.routers import memory as mem_router
    calls = []
    monkeypatch.setattr(mem_router, "_enqueue_product", lambda pid: calls.append(pid))
    client = TestClient(app)
    r = client.post("/memory/product/abc123/reindex")
    assert r.status_code == 202
    assert calls == ["abc123"]


def test_kb_ingest_chunks_and_enqueues(monkeypatch):
    from app.routers import memory as mem_router
    calls = []
    monkeypatch.setattr(mem_router, "_enqueue_kb_chunk",
                         lambda **kw: calls.append(kw))
    client = TestClient(app)
    r = client.post("/memory/kb", json={
        "business_id": "biz1",
        "source_id": "docX",
        "text": "Hello world. " * 300,
    })
    assert r.status_code == 202
    assert len(calls) >= 1
    assert all(c["business_id"] == "biz1" and c["source_id"] == "docX" for c in calls)
