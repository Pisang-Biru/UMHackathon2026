import pytest
from unittest.mock import AsyncMock
from langchain_core.messages import HumanMessage
from app.schemas.agent_io import StructuredReply, ManagerCritique, FactRef
from app.agents.customer_support import build_customer_support_agent


class _FakeLLM:
    def __init__(self, structured_response):
        self._structured_response = structured_response

    def bind_tools(self, tools):
        return self

    def with_structured_output(self, schema):
        llm = self
        class _Wrapped:
            async def ainvoke(self, messages):
                return llm._structured_response
        return _Wrapped()

    async def ainvoke(self, messages):
        raise RuntimeError("redraft should use with_structured_output")


@pytest.mark.asyncio
async def test_redraft_mode_skips_context_and_memory_loading(monkeypatch):
    # If load_context or load_memory ran, they'd touch the DB — force them to raise.
    import app.agents.customer_support as cs
    monkeypatch.setattr(cs, "_build_context", lambda bid: (_ for _ in ()).throw(AssertionError("load_context ran")))
    monkeypatch.setattr(cs, "_load_memory_node", AsyncMock(side_effect=AssertionError("load_memory ran")))

    fake = _FakeLLM(StructuredReply(
        reply="revised reply",
        confidence=0.85,
        reasoning="addressed critique",
        addressed_questions=["harga?"],
        facts_used=[FactRef(kind="product", id="p1")],
    ))
    graph = build_customer_support_agent(fake)

    state = {
        "messages": [HumanMessage(content="berapa harga?")],
        "business_id": "biz1",
        "customer_id": "c1",
        "customer_phone": "60123",
        "business_context": "Business: Test\nProducts:\n- [p1] Foo: RM10, 5 in stock",
        "memory_block": "",
        "draft_reply": "",
        "confidence": 0.0,
        "reasoning": "",
        "revision_mode": "redraft",
        "previous_draft": StructuredReply(reply="previous"),
        "critique": ManagerCritique(missing_facts=["mention stock"]),
    }
    result = await graph.ainvoke(state)
    assert result["draft_reply"] == "revised reply"
    assert result["confidence"] == 0.85


@pytest.mark.asyncio
async def test_draft_mode_still_loads_context(monkeypatch):
    import app.agents.customer_support as cs

    loads = {"context": 0}

    def _fake_build_context(bid):
        loads["context"] += 1
        return "Business: Test\nProducts:\n- [p1] Foo: RM10, 5 in stock"

    monkeypatch.setattr(cs, "_build_context", _fake_build_context)

    class _DraftFake:
        def bind_tools(self, tools): return self
        async def ainvoke(self, history):
            from langchain_core.messages import AIMessage
            return AIMessage(content='{"reply":"hi","confidence":0.9,"reasoning":"ok","addressed_questions":[],"unaddressed_questions":[],"facts_used":[],"needs_human":false}')

    graph = build_customer_support_agent(_DraftFake())
    state = {
        "messages": [HumanMessage(content="hi")],
        "business_id": "biz1",
        "customer_id": "c1",
        "customer_phone": "",
        "business_context": "",
        "memory_block": "",
        "draft_reply": "",
        "confidence": 0.0,
        "reasoning": "",
        "revision_mode": "draft",
        "previous_draft": None,
        "critique": None,
    }
    await graph.ainvoke(state)
    assert loads["context"] == 1
