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
