import pytest
from types import SimpleNamespace
from app.agents import customer_support as cs


class FakeLLM:
    def bind_tools(self, tools): return self
    async def ainvoke(self, messages): return SimpleNamespace(content="ok", tool_calls=[])
    def with_structured_output(self, schema):
        class _Parser:
            async def ainvoke(self_inner, history):
                return schema(reply="ok", confidence=0.95, reasoning="clear")
        return _Parser()


@pytest.mark.asyncio
async def test_load_memory_handles_missing_phone(session, engine, monkeypatch):
    from sqlalchemy.orm import sessionmaker
    TestSession = sessionmaker(bind=engine)
    monkeypatch.setattr(cs, "SessionLocal", TestSession)
    monkeypatch.setattr(cs, "embed", lambda texts: [[0.1] * 1024 for _ in texts])

    state = {
        "messages": [],
        "business_id": "biz1",
        "customer_phone": "",
    }
    result = await cs._load_memory_node(state)
    assert "No prior history" in result["memory_block"]


@pytest.mark.asyncio
async def test_load_memory_fetches_recent_turns(session, engine, monkeypatch):
    from sqlalchemy.orm import sessionmaker
    from app.memory import repo
    from langchain_core.messages import HumanMessage
    TestSession = sessionmaker(bind=engine)
    with TestSession() as s:
        repo.insert_turn(s, "bizM", "+60999", "earlier q", "earlier a", [0.1] * 1024)
        s.commit()

    monkeypatch.setattr(cs, "SessionLocal", TestSession)
    monkeypatch.setattr(cs, "embed", lambda texts: [[0.1] * 1024 for _ in texts])

    state = {
        "messages": [HumanMessage(content="next q")],
        "business_id": "bizM",
        "customer_phone": "+60999",
    }
    result = await cs._load_memory_node(state)
    assert "earlier q" in result["memory_block"]
