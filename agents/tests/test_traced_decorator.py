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


def test_traced_extracts_reasoning_from_critique():
    calls = []

    def fake_emit(agent_id, kind, **kw):
        calls.append((kind, kw))

    class _FakeCritique:
        def model_dump(self):
            return {
                "missing_facts": ["price"],
                "incorrect_claims": [],
                "tone_issues": ["too curt"],
                "unanswered_questions": [],
                "keep_from_draft": [],
            }

    with patch("app.agents._traced.emit", side_effect=fake_emit):
        @traced(agent_id="manager", node="evaluate")
        def node_fn(state):
            return {"verdict": "revise", "critique": _FakeCritique()}

        node_fn({"business_id": "b", "conversation_id": "c"})

    assert calls[-1][1]["status"] == "revise"
    reasoning = calls[-1][1]["reasoning"]
    assert reasoning is not None
    assert "missing_facts" in reasoning
    assert "price" in reasoning
    assert "tone_issues" in reasoning
    assert "too curt" in reasoning


import asyncio


def test_traced_wraps_async_fn_preserving_coroutine():
    calls = []

    def fake_emit(agent_id, kind, **kw):
        calls.append((kind, kw))

    with patch("app.agents._traced.emit", side_effect=fake_emit):
        @traced(agent_id="a", node="async_node")
        async def node_fn(state):
            await asyncio.sleep(0)
            return {"verdict": "revise"}

        out = asyncio.get_event_loop().run_until_complete(
            node_fn({"business_id": "b", "conversation_id": "c"})
        ) if False else asyncio.new_event_loop().run_until_complete(
            node_fn({"business_id": "b", "conversation_id": "c"})
        )

    assert out == {"verdict": "revise"}
    kinds = [k for k, _ in calls]
    assert kinds == ["node.start", "node.end"]
    assert calls[-1][1]["status"] == "revise"


def test_traced_async_fn_reraises_on_exception():
    calls = []

    def fake_emit(agent_id, kind, **kw):
        calls.append((kind, kw))

    with patch("app.agents._traced.emit", side_effect=fake_emit):
        @traced(agent_id="a", node="async_node")
        async def node_fn(state):
            raise RuntimeError("async boom")

        loop = asyncio.new_event_loop()
        try:
            loop.run_until_complete(node_fn({"business_id": "b", "conversation_id": "c"}))
            assert False, "should have raised"
        except RuntimeError as e:
            assert str(e) == "async boom"
        finally:
            loop.close()

    assert calls[-1][1]["status"] == "error"
    assert "async boom" in (calls[-1][1]["summary"] or "")
