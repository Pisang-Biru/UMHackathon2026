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


@pytest.mark.asyncio
async def test_search_memory_tool_returns_kb_hits(session, engine, monkeypatch):
    from sqlalchemy.orm import sessionmaker
    from app.memory import repo
    TestSession = sessionmaker(bind=engine)
    v = [1.0] + [0.0] * 1023
    with TestSession() as s:
        repo.insert_kb_chunk(s, "bizT", "src", 0, "We ship KL same day", v)
        s.commit()

    monkeypatch.setattr(cs, "SessionLocal", TestSession)
    monkeypatch.setattr(cs, "embed", lambda texts: [v for _ in texts])

    tool = cs._make_search_memory_tool("bizT")
    out = tool.invoke({"query": "shipping KL", "kind": "kb"})
    assert "ship KL" in out
    assert "kind=kb" in out


@pytest.mark.asyncio
async def test_search_memory_tool_empty_result(session, engine, monkeypatch):
    from sqlalchemy.orm import sessionmaker
    TestSession = sessionmaker(bind=engine)
    monkeypatch.setattr(cs, "SessionLocal", TestSession)
    monkeypatch.setattr(cs, "embed", lambda texts: [[0.0] * 1024 for _ in texts])

    tool = cs._make_search_memory_tool("biz_empty")
    out = tool.invoke({"query": "anything", "kind": "kb"})
    assert "No results" in out


@pytest.mark.asyncio
async def test_auto_send_enqueues_memory_write(monkeypatch):
    enqueued = []
    monkeypatch.setattr(cs, "_enqueue_turn_write", lambda **kw: enqueued.append(kw))

    state = {
        "messages": [SimpleNamespace(content="hi there")],
        "business_id": "bizE",
        "customer_phone": "+60999",
        "draft_reply": "hello!",
        "confidence": 0.95,
        "reasoning": "",
    }
    cs._enqueue_from_state(state, action_id="actX")
    assert len(enqueued) == 1
    assert enqueued[0]["business_id"] == "bizE"
    assert enqueued[0]["customer_phone"] == "+60999"
    assert enqueued[0]["buyer_msg"] == "hi there"
    assert enqueued[0]["agent_reply"] == "hello!"


@pytest.mark.asyncio
async def test_enqueue_skipped_when_phone_missing(monkeypatch):
    enqueued = []
    monkeypatch.setattr(cs, "_enqueue_turn_write", lambda **kw: enqueued.append(kw))
    state = {
        "messages": [SimpleNamespace(content="hi")],
        "business_id": "bizE",
        "customer_phone": "",
        "draft_reply": "hello!",
    }
    cs._enqueue_from_state(state, action_id="actX")
    assert enqueued == []


@pytest.mark.asyncio
async def test_memory_disabled_skips_load(monkeypatch):
    monkeypatch.setenv("MEMORY_ENABLED", "false")
    state = {
        "messages": [],
        "business_id": "biz1",
        "customer_phone": "+60111",
    }
    result = await cs._load_memory_node(state)
    assert result["memory_block"] == ""
