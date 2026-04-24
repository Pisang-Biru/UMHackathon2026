# agents/tests/test_manager_graph.py
import pytest
from langchain_core.messages import HumanMessage
from app.schemas.agent_io import StructuredReply, ManagerVerdict, FactRef


class _ScriptedJualLLM:
    """Returns a parseable JSON string imitating Jual's structured JSON output."""
    def __init__(self, payload):
        self._payload = payload
    def bind_tools(self, tools): return self
    def with_structured_output(self, schema):
        pl = self._payload
        class _W:
            async def ainvoke(self, h):
                # Used by redraft_reply; return the next scripted payload
                return StructuredReply.model_validate(pl)
        return _W()
    async def ainvoke(self, history):
        from langchain_core.messages import AIMessage
        import json
        return AIMessage(content=json.dumps(self._payload))


class _ManagerLLM:
    def __init__(self, verdict_obj):
        self._verdict = verdict_obj
    def with_structured_output(self, schema):
        v = self._verdict
        class _W:
            async def ainvoke(self, prompt):
                return v
        return _W()


@pytest.mark.asyncio
async def test_manager_happy_path_auto_sends(monkeypatch):
    """Jual drafts a clean reply, gates pass, Manager LLM says pass, finalize writes row."""
    import app.agents.manager as mgr
    import app.agents.customer_support as cs

    # Stub Jual's DB-dependent helpers
    monkeypatch.setattr(cs, "_build_context", lambda bid: "Business: Test\nProducts:\n- [p1] Foo: RM10, 5 in stock")

    # Stub load_shared_context DB reads
    def _fake_load_shared(state):
        return {
            "business_context": "Business: Test\nProducts:\n- [p1] Foo: RM10, 5 in stock",
            "memory_block": "",
            "valid_fact_ids": {"product:p1"},
        }
    monkeypatch.setattr(mgr, "_load_shared_context_impl", _fake_load_shared)

    # Stub DB write
    writes = []
    class _Session:
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def add(self, r): writes.append(r)
        def commit(self): pass
    monkeypatch.setattr("app.agents.manager_terminal.SessionLocal", _Session)
    monkeypatch.setattr("app.agents.manager_terminal._enqueue_memory_write", lambda *a, **k: None)

    jual_payload = {
        "reply": "RM10 ada 5 stock",
        "confidence": 0.92,
        "reasoning": "direct",
        "addressed_questions": ["harga?"],
        "unaddressed_questions": [],
        "facts_used": [{"kind": "product", "id": "p1"}],
        "needs_human": False,
    }
    jual_llm = _ScriptedJualLLM(jual_payload)
    manager_llm = _ManagerLLM(ManagerVerdict(verdict="pass", reason="grounded, addressed"))

    graph = mgr.build_manager_graph(jual_llm=jual_llm, manager_llm=manager_llm)
    result = await graph.ainvoke({
        "messages": [HumanMessage(content="berapa harga foo?")],
        "business_id": "biz1",
        "customer_id": "c1",
        "customer_phone": "60123",
        "revision_count": 0,
        "iterations": [],
    })
    assert result["final_action"] == "auto_send"
    assert len(writes) == 1
    assert writes[0].status.value == "AUTO_SENT"


@pytest.mark.asyncio
async def test_manager_needs_human_escalates_immediately(monkeypatch):
    """Jual flags needs_human → gate 1 fires → queue_for_human, no Manager LLM call."""
    import app.agents.manager as mgr
    import app.agents.customer_support as cs
    monkeypatch.setattr(cs, "_build_context", lambda bid: "Business: Test")
    monkeypatch.setattr(mgr, "_load_shared_context_impl", lambda s: {
        "business_context": "Business: Test", "memory_block": "", "valid_fact_ids": set(),
    })

    writes = []
    class _Session:
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def add(self, r): writes.append(r)
        def commit(self): pass
    monkeypatch.setattr("app.agents.manager_terminal.SessionLocal", _Session)
    monkeypatch.setattr("app.agents.manager_terminal._enqueue_memory_write", lambda *a, **k: None)

    payload = {
        "reply": "pls help", "confidence": 0.2, "reasoning": "sensitive",
        "addressed_questions": [], "unaddressed_questions": [],
        "facts_used": [], "needs_human": True,
    }
    class _RaisingManagerLLM:
        def with_structured_output(self, schema):
            raise AssertionError("gate escalation must not call Manager LLM")

    graph = mgr.build_manager_graph(
        jual_llm=_ScriptedJualLLM(payload),
        manager_llm=_RaisingManagerLLM(),
    )
    result = await graph.ainvoke({
        "messages": [HumanMessage(content="saya nak refund")],
        "business_id": "biz1",
        "customer_id": "c1",
        "customer_phone": "60123",
        "revision_count": 0,
        "iterations": [],
    })
    assert result["final_action"] == "escalate"
    assert writes[0].status.value == "PENDING"
