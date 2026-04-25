import os
from fastapi.testclient import TestClient
from unittest.mock import patch

from app.main import app
from app.db import SessionLocal, Agent, BusinessAgent, AgentEvent


BIZ = "biz1"


def _cleanup_events(conv_ids: list[str]):
    with SessionLocal() as s:
        for c in conv_ids:
            s.query(AgentEvent).filter_by(conversation_id=c).delete()
        s.commit()


def test_registry_lists_enabled_agents():
    # relies on boot-time upsert having written manager + customer_support for biz1.
    client = TestClient(app)
    r = client.get("/agent/registry", params={"business_id": BIZ})
    assert r.status_code == 200
    data = r.json()
    ids = {a["id"] for a in data}
    assert {"manager", "customer_support"}.issubset(ids)
    mgr = next(a for a in data if a["id"] == "manager")
    assert mgr["name"] == "Manager"
    assert mgr["status"] in {"idle", "working", "error"}
    assert "stats_24h" in mgr


def test_events_list_keyset_pagination():
    # seed 5 events
    with SessionLocal() as s:
        for i in range(5):
            s.add(AgentEvent(agent_id="manager", business_id=BIZ,
                             conversation_id="c-page", kind="node.end",
                             summary=f"e{i}"))
        s.commit()

    client = TestClient(app)
    r = client.get("/agent/events", params={
        "business_id": BIZ, "conversation_id": "c-page", "limit": 2
    })
    assert r.status_code == 200
    page1 = r.json()
    assert len(page1["items"]) == 2
    assert page1["next_cursor"] is not None

    r2 = client.get("/agent/events", params={
        "business_id": BIZ, "conversation_id": "c-page",
        "limit": 2, "before": page1["next_cursor"],
    })
    page2 = r2.json()
    assert len(page2["items"]) == 2
    assert page1["items"][0]["id"] > page2["items"][0]["id"]

    _cleanup_events(["c-page"])


def test_events_list_filter_by_agent_and_kind():
    with SessionLocal() as s:
        s.add(AgentEvent(agent_id="manager", business_id=BIZ,
                         conversation_id="c-flt", kind="handoff", summary="h1"))
        s.add(AgentEvent(agent_id="customer_support", business_id=BIZ,
                         conversation_id="c-flt", kind="node.end", summary="n1"))
        s.commit()
    client = TestClient(app)
    r = client.get("/agent/events", params={
        "business_id": BIZ, "agent_id": "manager", "kind": "handoff"
    })
    items = r.json()["items"]
    assert all(i["agent_id"] == "manager" and i["kind"] == "handoff" for i in items)
    _cleanup_events(["c-flt"])


def test_event_detail_hides_trace_by_default():
    with SessionLocal() as s:
        e = AgentEvent(agent_id="manager", business_id=BIZ,
                       conversation_id="c-detail-1",
                       kind="node.end", summary="x",
                       trace={"prompt": "secret"})
        s.add(e); s.commit(); eid = e.id
    client = TestClient(app)
    r = client.get(f"/agent/events/{eid}", params={"business_id": BIZ})
    assert r.status_code == 200
    assert r.json().get("trace") is None
    _cleanup_events(["c-detail-1"])


def test_event_detail_shows_trace_when_enabled_and_admin():
    with SessionLocal() as s:
        e = AgentEvent(agent_id="manager", business_id=BIZ,
                       conversation_id="c-detail-2",
                       kind="node.end", summary="x",
                       trace={"prompt": "visible"})
        s.add(e); s.commit(); eid = e.id

    client = TestClient(app)
    with patch.dict(os.environ, {"TRACE_LLM": "1"}):
        r = client.get(f"/agent/events/{eid}",
                       params={"business_id": BIZ},
                       headers={"X-Admin": "1"})
    assert r.json()["trace"] == {"prompt": "visible"}
    _cleanup_events(["c-detail-2"])


def test_event_detail_404_on_wrong_business():
    with SessionLocal() as s:
        e = AgentEvent(agent_id="manager", business_id=BIZ,
                       conversation_id="c-detail-3",
                       kind="node.end", summary="x")
        s.add(e); s.commit(); eid = e.id
    client = TestClient(app)
    r = client.get(f"/agent/events/{eid}", params={"business_id": "nope"})
    assert r.status_code == 404
    _cleanup_events(["c-detail-3"])
