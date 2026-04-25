import pytest
from unittest.mock import patch
from app.agents._traced import traced


@pytest.mark.anyio
async def test_traced_wraps_manager_node_fn_async():
    events_log = []

    def fake_emit(agent_id, kind, **kw):
        events_log.append((agent_id, kind, kw.get("node"), kw.get("status")))

    async def fake_evaluate(state):
        return {"verdict": "revise"}

    with patch("app.agents._traced.emit", side_effect=fake_emit):
        wrapped = traced(agent_id="manager", node="evaluate")(fake_evaluate)
        await wrapped({"business_id": "biz1", "customer_id": "c1"})

    kinds = [(a, k, s) for a, k, _, s in events_log]
    assert ("manager", "node.start", None) in kinds
    assert ("manager", "node.end", "revise") in kinds


@pytest.mark.anyio
async def test_build_manager_graph_compiles_with_wrappers():
    """Smoke: manager graph builds when nodes are wrapped; no exception at compile."""
    from app.agents.manager import build_manager_graph

    class _JualLLM:
        def bind_tools(self, tools): return self
        def with_structured_output(self, schema): return self
        async def ainvoke(self, *a, **k): raise RuntimeError("not used")

    class _MgrLLM:
        def with_structured_output(self, schema): return self
        async def ainvoke(self, *a, **k): raise RuntimeError("not used")

    g = build_manager_graph(jual_llm=_JualLLM(), manager_llm=_MgrLLM())
    assert g is not None
