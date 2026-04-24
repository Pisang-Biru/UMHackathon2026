import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client_with_manager(monkeypatch):
    monkeypatch.setenv("MANAGER_ENABLED", "true")
    # Force-re-import main to honor env
    import importlib
    import app.main as main_mod
    importlib.reload(main_mod)
    return TestClient(main_mod.app)


def test_auto_sent_response_includes_best_draft_null(client_with_manager, monkeypatch):
    # Stub the graph to return an auto_sent result
    import app.routers.support as support_mod
    async def _fake_invoke(state):
        return {
            "final_action": "auto_send",
            "action_id": "a1",
            "final_reply": "hi",
            "best_draft": None,
        }
    monkeypatch.setattr(support_mod, "_support_graph_ainvoke", _fake_invoke)

    resp = client_with_manager.post("/agent/support/chat", json={
        "business_id": "biz1", "customer_id": "c1", "message": "hi",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "sent"
    assert data["best_draft"] is None
    assert data["escalation_summary"] is None


def test_pending_response_includes_best_draft_and_summary(client_with_manager, monkeypatch):
    import app.routers.support as support_mod
    async def _fake_invoke(state):
        return {
            "final_action": "escalate",
            "action_id": "a2",
            "best_draft": "suggested reply",
        }
    monkeypatch.setattr(support_mod, "_support_graph_ainvoke", _fake_invoke)

    # Also stub the DB read for escalation_summary
    monkeypatch.setattr(support_mod, "_load_escalation_summary", lambda aid: "Needs your review.")

    resp = client_with_manager.post("/agent/support/chat", json={
        "business_id": "biz1", "customer_id": "c1", "message": "refund?",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "pending_approval"
    assert data["best_draft"] == "suggested reply"
    assert data["escalation_summary"] == "Needs your review."
