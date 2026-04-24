import pytest
from fastapi.testclient import TestClient


def test_approve_uses_body_reply_and_delays_memory_enqueue_10s(monkeypatch):
    import app.main as main_mod
    import app.routers.support as support_mod
    from app.db import AgentAction, AgentActionStatus

    # In-memory action
    action = AgentAction(
        id="a1", businessId="biz", customerMsg="hi", draftReply="d",
        finalReply=None, confidence=0.5, reasoning="r",
        status=AgentActionStatus.PENDING,
    )

    committed = {"flag": False}
    class _Session:
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def query(self, m):
            class _Q:
                def filter(self, *a, **k): return self
                def first(_self): return action
            return _Q()
        def commit(self): committed["flag"] = True
        def refresh(self, obj): pass
    monkeypatch.setattr(support_mod, "SessionLocal", _Session)

    # Fake task with apply_async that records countdown
    calls = []
    class _FakeTask:
        def apply_async(self, kwargs=None, countdown=None):
            calls.append({"kwargs": kwargs, "countdown": countdown})
            class _Result:
                id = "task-xyz"
            return _Result()
    monkeypatch.setattr(support_mod, "_get_past_action_task", lambda: _FakeTask())

    client = TestClient(main_mod.app)
    resp = client.post("/agent/actions/a1/approve", json={"reply": "final text"})
    assert resp.status_code == 200
    assert action.finalReply == "final text"
    assert action.status == AgentActionStatus.APPROVED
    assert committed["flag"]
    assert calls[0]["countdown"] == 10
    assert calls[0]["kwargs"] == {"action_id": "a1"}
