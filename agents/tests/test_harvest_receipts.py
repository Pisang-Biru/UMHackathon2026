# agents/tests/test_harvest_receipts.py
import pytest
from langchain_core.messages import HumanMessage, AIMessage, ToolMessage
from app.schemas.agent_io import OrderReceipt, KbReceipt
from app.agents.manager import _harvest_receipts_impl


def _tm(content, artifact=None, tool_call_id="call_1"):
    msg = ToolMessage(content=content, tool_call_id=tool_call_id)
    if artifact is not None:
        # langchain ToolMessage supports artifact attribute
        msg.artifact = artifact
    return msg


@pytest.mark.asyncio
async def test_harvest_merges_artifact_receipts_into_valid_fact_ids():
    state = {
        "messages": [
            HumanMessage(content="ada order?"),
            AIMessage(content=""),
            _tm("no orders found", artifact=[OrderReceipt(id="none:60123")]),
        ],
        "valid_fact_ids": {"product:p1"},
        "last_harvested_msg_index": 0,
    }
    out = await _harvest_receipts_impl(state)
    assert out["valid_fact_ids"] == {"product:p1", "order:none:60123"}
    assert out["last_harvested_msg_index"] == 3


@pytest.mark.asyncio
async def test_harvest_is_idempotent_across_revise_loop():
    msg = _tm("ok", artifact=[OrderReceipt(id="ord_42")])
    state = {
        "messages": [HumanMessage(content="x"), msg],
        "valid_fact_ids": {"product:p1"},
        "last_harvested_msg_index": 0,
    }
    out1 = await _harvest_receipts_impl(state)
    state.update(out1)
    out2 = await _harvest_receipts_impl(state)
    # Cursor advanced to end; second call adds nothing new
    assert out2["valid_fact_ids"] == {"product:p1", "order:ord_42"}
    assert out2["last_harvested_msg_index"] == 2


@pytest.mark.asyncio
async def test_harvest_skips_plain_string_tool_messages():
    state = {
        "messages": [
            HumanMessage(content="x"),
            _tm("plain string output, no artifact"),
        ],
        "valid_fact_ids": {"product:p1"},
        "last_harvested_msg_index": 0,
    }
    out = await _harvest_receipts_impl(state)
    assert out["valid_fact_ids"] == {"product:p1"}
    assert out["last_harvested_msg_index"] == 2


@pytest.mark.asyncio
async def test_harvest_only_scans_messages_after_cursor():
    state = {
        "messages": [
            HumanMessage(content="x"),
            _tm("first call", artifact=[OrderReceipt(id="ord_1")]),
            _tm("second call", artifact=[OrderReceipt(id="ord_2")]),
        ],
        "valid_fact_ids": {"order:ord_1"},
        "last_harvested_msg_index": 2,  # already harvested first two messages
    }
    out = await _harvest_receipts_impl(state)
    assert out["valid_fact_ids"] == {"order:ord_1", "order:ord_2"}
    assert out["last_harvested_msg_index"] == 3


@pytest.mark.asyncio
async def test_harvest_handles_multiple_receipts_in_single_artifact():
    state = {
        "messages": [
            HumanMessage(content="x"),
            _tm("found 2", artifact=[
                KbReceipt(id="ab12cd34", chunk_id="full1", sim=0.8),
                KbReceipt(id="ef56gh78", chunk_id="full2", sim=0.7),
            ]),
        ],
        "valid_fact_ids": set(),
        "last_harvested_msg_index": 0,
    }
    out = await _harvest_receipts_impl(state)
    assert out["valid_fact_ids"] == {"kb:ab12cd34", "kb:ef56gh78"}


@pytest.mark.asyncio
async def test_dispatch_jual_propagates_tool_messages_to_manager_state(monkeypatch):
    """Regression: harvest_receipts is useless unless dispatch_jual copies the
    subgraph's ToolMessages back into ManagerState.messages."""
    from app.agents.manager import build_manager_graph
    from app.schemas.agent_io import StructuredReply, OrderReceipt

    fake_tool_msg = ToolMessage(content="no orders", tool_call_id="c1")
    fake_tool_msg.artifact = [OrderReceipt(id="none:60123")]
    fake_draft = StructuredReply(reply="ok", confidence=0.9, reasoning="r")

    class _FakeJualGraph:
        async def ainvoke(self, sub_state):
            return {
                "messages": list(sub_state["messages"]) + [fake_tool_msg],
                "draft_reply": fake_draft.reply,
                "structured_reply": fake_draft,
                "confidence": fake_draft.confidence,
                "reasoning": fake_draft.reasoning,
            }

    monkeypatch.setattr(
        "app.agents.manager.build_customer_support_agent",
        lambda llm: _FakeJualGraph(),
    )
    monkeypatch.setattr(
        "app.agents.manager._load_shared_context_impl",
        lambda state: {
            "business_context": "",
            "memory_block": "",
            "valid_fact_ids": {"product:p1"},
            "preloaded_fact_ids": {"product:p1"},
            "last_harvested_msg_index": 0,
        },
    )
    # Stub out DB write in finalize so we don't need a real business row
    class _NopSession:
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def add(self, r): pass
        def commit(self): pass
    monkeypatch.setattr("app.agents.manager_terminal.SessionLocal", _NopSession)
    monkeypatch.setattr("app.agents.manager_terminal._enqueue_memory_write", lambda *a, **k: None)

    class _Nop:
        def with_structured_output(self, *_a, **_k): return self
        async def ainvoke(self, *_a, **_k):
            from app.schemas.agent_io import ManagerVerdict
            return ManagerVerdict(verdict="pass", reason="ok")

    graph = build_manager_graph(jual_llm=_Nop(), manager_llm=_Nop())
    result = await graph.ainvoke({
        "business_id": "biz_1",
        "customer_phone": "60123",
        "messages": [HumanMessage(content="terima kasih")],
        "iterations": [],
    })

    # The tool message must have made it into ManagerState.messages, AND harvest
    # must have folded the receipt id into valid_fact_ids.
    assert any(isinstance(m, ToolMessage) for m in result["messages"]), \
        "ToolMessage did not propagate from jual subgraph to ManagerState"
    assert "order:none:60123" in result["valid_fact_ids"], \
        f"harvest_receipts did not fold OrderReceipt into valid_fact_ids; got {result['valid_fact_ids']}"
