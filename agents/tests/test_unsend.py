from datetime import datetime, timezone, timedelta
from fastapi.testclient import TestClient


def _make_action_stub(status, approvedAt):
    from app.db import AgentAction, AgentActionStatus
    a = AgentAction(
        id="a1", businessId="b", customerMsg="m", draftReply="d",
        finalReply="sent", confidence=0.5, reasoning="r",
        status=getattr(AgentActionStatus, status),
        createdAt=datetime.now(timezone.utc),
    )
    a.approvedAt = approvedAt
    return a


def test_unsend_within_window_restores_pending(monkeypatch):
    import app.main as main_mod
    import app.routers.support as support_mod

    action = _make_action_stub("APPROVED", datetime.now(timezone.utc) - timedelta(seconds=3))

    committed = {"flag": False}
    class _Session:
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def query(self, m):
            class _Q:
                def filter(_q, *a, **k): return _q
                def first(_q): return action
            return _Q()
        def commit(self): committed["flag"] = True
        def refresh(self, obj): pass
    monkeypatch.setattr(support_mod, "SessionLocal", _Session)

    revoked = []
    monkeypatch.setattr(support_mod, "_revoke_memory_task", lambda aid: revoked.append(aid))

    client = TestClient(main_mod.app)
    resp = client.post("/agent/actions/a1/unsend")
    assert resp.status_code == 200
    from app.db import AgentActionStatus
    assert action.status == AgentActionStatus.PENDING
    assert action.finalReply is None
    assert revoked == ["a1"]


def test_unsend_after_window_returns_409(monkeypatch):
    import app.main as main_mod
    import app.routers.support as support_mod

    action = _make_action_stub("APPROVED", datetime.now(timezone.utc) - timedelta(seconds=30))
    class _Session:
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def query(self, m):
            class _Q:
                def filter(_q, *a, **k): return _q
                def first(_q): return action
            return _Q()
        def commit(self): pass
    monkeypatch.setattr(support_mod, "SessionLocal", _Session)

    client = TestClient(main_mod.app)
    resp = client.post("/agent/actions/a1/unsend")
    assert resp.status_code == 409


def test_unsend_rejects_non_approved(monkeypatch):
    import app.main as main_mod
    import app.routers.support as support_mod

    action = _make_action_stub("PENDING", datetime.now(timezone.utc))
    class _Session:
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def query(self, m):
            class _Q:
                def filter(_q, *a, **k): return _q
                def first(_q): return action
            return _Q()
        def commit(self): pass
    monkeypatch.setattr(support_mod, "SessionLocal", _Session)

    client = TestClient(main_mod.app)
    resp = client.post("/agent/actions/a1/unsend")
    assert resp.status_code == 400
