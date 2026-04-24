import pytest
from unittest.mock import AsyncMock
from langchain_core.messages import HumanMessage, AIMessage
from app.agents.customer_support import build_customer_support_agent


class _UnparseableLLM:
    def bind_tools(self, tools): return self
    async def ainvoke(self, history):
        return AIMessage(content="this is not JSON at all")


@pytest.mark.asyncio
async def test_parse_failure_produces_needs_human_draft(monkeypatch):
    import app.agents.customer_support as cs
    monkeypatch.setattr(cs, "_build_context", lambda bid: "Business: Test")

    graph = build_customer_support_agent(_UnparseableLLM())
    state = {
        "messages": [HumanMessage(content="what?")],
        "business_id": "biz1",
        "customer_id": "c1",
        "customer_phone": "",
        "memory_block": "",
        "business_context": "",
        "draft_reply": "",
        "confidence": 0.0,
        "reasoning": "",
        "revision_mode": "draft",
    }
    result = await graph.ainvoke(state)
    sr = result["structured_reply"]
    assert sr.needs_human is True
    assert "human" in sr.reply.lower()
    assert "JSON parsing failed" in sr.reasoning
