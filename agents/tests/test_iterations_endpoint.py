from fastapi.testclient import TestClient


def test_iterations_endpoint_returns_jsonb(monkeypatch):
    import app.main as main_mod
    import app.routers.support as support_mod

    class _Action:
        id = "a1"
        iterations = [{"stage": "jual_v1", "draft": {"reply": "hi"}}]

    class _Session:
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def query(self, m):
            class _Q:
                def filter(self, *a, **k): return self
                def filter_by(self, **k): return self
                def first(_self): return _Action()
            return _Q()
    monkeypatch.setattr(support_mod, "SessionLocal", _Session)

    client = TestClient(main_mod.app)
    resp = client.get("/agent/actions/a1/iterations")
    assert resp.status_code == 200
    assert resp.json() == {"iterations": [{"stage": "jual_v1", "draft": {"reply": "hi"}}]}
    assert "immutable" in resp.headers.get("cache-control", "")


def test_iterations_404_when_missing(monkeypatch):
    import app.main as main_mod
    import app.routers.support as support_mod

    class _Session:
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def query(self, m):
            class _Q:
                def filter(self, *a, **k): return self
                def filter_by(self, **k): return self
                def first(_self): return None
            return _Q()
    monkeypatch.setattr(support_mod, "SessionLocal", _Session)

    client = TestClient(main_mod.app)
    resp = client.get("/agent/actions/missing/iterations")
    assert resp.status_code == 404
