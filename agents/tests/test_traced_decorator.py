from unittest.mock import patch
from app.agents._traced import traced


def test_traced_emits_start_and_end_on_success():
    calls = []

    def fake_emit(agent_id, kind, **kw):
        calls.append((kind, kw))

    with patch("app.agents._traced.emit", side_effect=fake_emit):
        @traced(agent_id="test_agent", node="nodeA")
        def node_fn(state):
            return {"x": 1}

        out = node_fn({"business_id": "b", "conversation_id": "c"})

    assert out == {"x": 1}
    kinds = [k for k, _ in calls]
    assert kinds == ["node.start", "node.end"]
    assert calls[1][1]["status"] == "ok"
    assert calls[1][1]["duration_ms"] is not None
    assert calls[0][1]["node"] == "nodeA"
    assert calls[0][1]["business_id"] == "b"
    assert calls[0][1]["conversation_id"] == "c"


def test_traced_emits_error_on_exception():
    calls = []

    def fake_emit(agent_id, kind, **kw):
        calls.append((kind, kw))

    with patch("app.agents._traced.emit", side_effect=fake_emit):
        @traced(agent_id="test_agent", node="nodeA")
        def node_fn(state):
            raise ValueError("boom")

        try:
            node_fn({"business_id": "b", "conversation_id": "c"})
        except ValueError:
            pass

    assert calls[-1][0] == "node.end"
    assert calls[-1][1]["status"] == "error"
    assert "boom" in (calls[-1][1]["summary"] or "")


def test_traced_uses_customer_id_when_no_conversation_id():
    calls = []

    def fake_emit(agent_id, kind, **kw):
        calls.append((kind, kw))

    with patch("app.agents._traced.emit", side_effect=fake_emit):
        @traced(agent_id="a", node="n")
        def node_fn(state):
            return {}

        node_fn({"business_id": "b", "customer_id": "cust-1"})

    assert calls[0][1]["conversation_id"] == "cust-1"


def test_traced_records_verdict_status_from_result():
    calls = []

    def fake_emit(agent_id, kind, **kw):
        calls.append((kind, kw))

    with patch("app.agents._traced.emit", side_effect=fake_emit):
        @traced(agent_id="manager", node="evaluate")
        def node_fn(state):
            return {"verdict": "revise"}

        node_fn({"business_id": "b", "conversation_id": "c"})

    assert calls[-1][1]["status"] == "revise"
