# agents/tests/test_manager_e2e.py
"""Full graph integration test — all nodes wired, mocked LLMs, in-memory DB stub."""
import pytest
from langchain_core.messages import HumanMessage
from app.schemas.agent_io import StructuredReply, ManagerVerdict, ManagerCritique, FactRef


class _SequentialJualLLM:
    """Returns different payloads on successive calls (v1 draft, v2 redraft)."""
    def __init__(self, payloads):
        self._payloads = list(payloads)
        self._idx = 0
    def bind_tools(self, tools): return self
    def with_structured_output(self, schema):
        outer = self
        class _W:
            async def ainvoke(self, h):
                pl = outer._payloads[outer._idx]
                outer._idx += 1
                return StructuredReply.model_validate(pl)
        return _W()
    async def ainvoke(self, history):
        import json
        from langchain_core.messages import AIMessage
        pl = self._payloads[self._idx]
        self._idx += 1
        return AIMessage(content=json.dumps(pl))


class _SequentialManagerLLM:
    def __init__(self, verdicts):
        self._verdicts = list(verdicts)
        self._idx = 0
    def with_structured_output(self, schema):
        outer = self
        class _W:
            async def ainvoke(self, prompt):
                if schema.__name__ == "ManagerVerdict":
                    v = outer._verdicts[outer._idx]
                    outer._idx += 1
                    return v
                # Manager rewrite uses StructuredReply schema
                return StructuredReply(
                    reply="manager rewrite",
                    facts_used=[FactRef(kind="product", id="p1")],
                )
        return _W()


@pytest.mark.asyncio
async def test_revise_then_pass_ends_auto_sent(monkeypatch):
    import app.agents.manager as mgr

    monkeypatch.setattr(mgr, "_load_shared_context_impl", lambda s: {
        "business_context": "Business: Test",
        "memory_block": "",
        "valid_fact_ids": {"product:p1"},
    })
    writes = []
    class _Session:
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def add(self, r): writes.append(r)
        def commit(self): pass
    monkeypatch.setattr("app.agents.manager_terminal.SessionLocal", _Session)
    monkeypatch.setattr("app.agents.manager_terminal._enqueue_memory_write", lambda *a, **k: None)

    # v1 has unaddressed Q → gate 3 forces revise
    v1 = {"reply": "RM10", "confidence": 0.8, "reasoning": "r",
          "addressed_questions": [], "unaddressed_questions": ["stock?"],
          "facts_used": [{"kind": "product", "id": "p1"}], "needs_human": False}
    # v2 resolves unaddressed
    v2 = {"reply": "RM10, 5 in stock", "confidence": 0.9, "reasoning": "r",
          "addressed_questions": ["harga?", "stock?"], "unaddressed_questions": [],
          "facts_used": [{"kind": "product", "id": "p1"}], "needs_human": False}

    jual_llm = _SequentialJualLLM([v1, v2])
    manager_llm = _SequentialManagerLLM([
        # First evaluate (on v1): gate 3 fires BEFORE LLM — LLM is NOT called.
        # Second evaluate (on v2): gates all pass, LLM is called → pass
        ManagerVerdict(verdict="pass", reason="all addressed"),
    ])

    graph = mgr.build_manager_graph(jual_llm=jual_llm, manager_llm=manager_llm)
    result = await graph.ainvoke({
        "messages": [HumanMessage(content="harga ondeh? ada stock?")],
        "business_id": "biz1",
        "customer_id": "c1",
        "customer_phone": "60123",
        "revision_count": 0,
        "iterations": [],
    })
    assert result["final_action"] == "auto_send"
    row = writes[0]
    assert row.status.value == "AUTO_SENT"
    # Two iteration entries: jual_v1 + jual_v2
    assert len(row.iterations) == 2
    assert row.iterations[0]["stage"] == "jual_v1"
    assert row.iterations[1]["stage"] == "jual_v2"

    # ---- agent_events end-to-end check ----
    from app.db import SessionLocal, AgentEvent

    try:
        with SessionLocal() as s:
            evs = (
                s.query(AgentEvent)
                .filter(AgentEvent.conversation_id == "c1")
                .order_by(AgentEvent.id)
                .all()
            )
            agents_seen = {e.agent_id for e in evs}
            kinds_seen = {e.kind for e in evs}
            revise_evals = [
                e for e in evs if e.node == "evaluate" and e.status == "revise"
            ]

        assert {"manager", "customer_support"}.issubset(agents_seen), (
            f"missing agent in events: {agents_seen}"
        )
        assert "handoff" in kinds_seen, f"no handoff event recorded: {kinds_seen}"
        assert len(revise_evals) >= 1, (
            "expected at least one evaluate node.end with status=revise"
        )
    finally:
        # cleanup so subsequent test runs start clean
        with SessionLocal() as s:
            s.query(AgentEvent).filter(
                AgentEvent.conversation_id == "c1"
            ).delete()
            s.commit()


@pytest.mark.asyncio
async def test_rewrite_then_escalate_when_rewrite_hallucinates(monkeypatch):
    import app.agents.manager as mgr
    import app.agents.manager_rewrite as mrw

    monkeypatch.setattr(mgr, "_load_shared_context_impl", lambda s: {
        "business_context": "Business: Test",
        "memory_block": "",
        "valid_fact_ids": {"product:p1"},
    })
    writes = []
    class _Session:
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def add(self, r): writes.append(r)
        def commit(self): pass
    monkeypatch.setattr("app.agents.manager_terminal.SessionLocal", _Session)
    monkeypatch.setattr("app.agents.manager_terminal._enqueue_memory_write", lambda *a, **k: None)

    # v1 has a hallucinated fact → gate 2 says rewrite
    v1 = {"reply": "RM5 for ghost", "confidence": 0.9, "reasoning": "r",
          "addressed_questions": ["harga?"], "unaddressed_questions": [],
          "facts_used": [{"kind": "product", "id": "ghost"}], "needs_human": False}

    jual_llm = _SequentialJualLLM([v1])

    # Manager rewrite ALSO hallucinates — gates_only_check must escalate
    class _RewriteHallucinateLLM:
        def __init__(self): self._call = 0
        def with_structured_output(self, schema):
            parent = self
            class _W:
                async def ainvoke(self, prompt):
                    parent._call += 1
                    if schema.__name__ == "ManagerVerdict":
                        return ManagerVerdict(verdict="rewrite", reason="gate:ungrounded_fact:product:ghost")
                    # Rewrite: still hallucinates
                    return StructuredReply(
                        reply="rewrite text",
                        facts_used=[FactRef(kind="product", id="phantom")],
                    )
            return _W()

    graph = mgr.build_manager_graph(jual_llm=jual_llm, manager_llm=_RewriteHallucinateLLM())
    result = await graph.ainvoke({
        "messages": [HumanMessage(content="harga?")],
        "business_id": "biz1",
        "customer_id": "c1",
        "customer_phone": "60123",
        "revision_count": 0,
        "iterations": [],
    })
    assert result["final_action"] == "escalate"
    row = writes[0]
    assert row.status.value == "PENDING"


@pytest.mark.asyncio
async def test_negative_order_lookup_does_not_escalate(monkeypatch):
    """Screenshot reproduction: buyer asks 'ada saya beli barang ke harini?',
    order tool returns no rows, Jual cites the citable negative,
    manager auto-sends instead of escalating."""
    from app.agents.manager import build_manager_graph, _load_shared_context_impl
    from app.schemas.agent_io import StructuredReply, FactRef, OrderReceipt
    from langchain_core.messages import AIMessage, ToolMessage

    # Stub shared-context loader: just one product, plus the snapshot fields.
    def _fake_load(state):
        valid_ids = {"product:p1"}
        return {
            "business_context": "Business: Test",
            "memory_block": "",
            "valid_fact_ids": valid_ids,
            "preloaded_fact_ids": set(valid_ids),
            "last_harvested_msg_index": 0,
        }
    monkeypatch.setattr(
        "app.agents.manager._load_shared_context_impl",
        _fake_load,
    )

    # Stub jual_graph.ainvoke: simulate a tool call landing in messages and a
    # draft that cites the negative receipt id.
    phone_key = "60123456789"
    fake_tool_msg = ToolMessage(
        content="no orders found for this phone",
        tool_call_id="call_x",
    )
    fake_tool_msg.artifact = [OrderReceipt(id=f"none:{phone_key}")]
    fake_draft = StructuredReply(
        reply="Tiada, saya tidak jumpa sebarang pesanan untuk nombor anda.",
        confidence=0.9,
        reasoning="Order lookup returned empty; cited negative.",
        facts_used=[FactRef(kind="order", id=f"none:{phone_key}")],
    )

    class _FakeJualGraph:
        async def ainvoke(self, sub_state):
            new_msgs = list(sub_state["messages"]) + [
                AIMessage(content="(tool call)"),
                fake_tool_msg,
            ]
            return {
                "messages": new_msgs,
                "draft_reply": fake_draft.reply,
                "structured_reply": fake_draft,
                "confidence": fake_draft.confidence,
                "reasoning": fake_draft.reasoning,
            }

    monkeypatch.setattr(
        "app.agents.manager.build_customer_support_agent",
        lambda llm: _FakeJualGraph(),
    )

    # Stub DB writes in finalize so we don't need a real business row.
    class _NopSession:
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def add(self, r): pass
        def commit(self): pass
    monkeypatch.setattr("app.agents.manager_terminal.SessionLocal", _NopSession)
    monkeypatch.setattr("app.agents.manager_terminal._enqueue_memory_write", lambda *a, **k: None)

    # Stub manager_llm — gates all pass (receipt cited correctly), so the LLM
    # evaluator runs and must return "pass" to reach auto_send.
    class _NopLLM:
        def with_structured_output(self, *_a, **_k):
            return self
        async def ainvoke(self, *_a, **_k):
            from app.schemas.agent_io import ManagerVerdict
            return ManagerVerdict(verdict="pass", reason="all facts cited and grounded")

    graph = build_manager_graph(jual_llm=_NopLLM(), manager_llm=_NopLLM())
    result = await graph.ainvoke({
        "business_id": "biz_1",
        "customer_phone": "+60 12-345 6789",
        "messages": [HumanMessage(content="ada saya beli barang ke harini?")],
        "iterations": [],
    })

    assert result.get("final_action") == "auto_send", \
        f"expected auto_send, got {result.get('final_action')} reason={result.get('verdict')}"
