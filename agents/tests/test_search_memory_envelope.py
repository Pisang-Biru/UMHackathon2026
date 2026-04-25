# agents/tests/test_search_memory_envelope.py
import pytest
from unittest.mock import MagicMock, patch
from langchain_core.messages import ToolMessage
from app.schemas.agent_io import KbReceipt, ProductReceipt, PastActionReceipt
from app.agents.customer_support import _make_search_memory_tool, _short_id


def _toolcall(args, name="search_memory", id="call_1"):
    return {"name": name, "args": args, "id": id, "type": "tool_call"}


class _Hit:
    def __init__(self, _id, content, sim, **extra):
        self.id = _id
        self.content = content
        self.similarity = sim
        for k, v in extra.items():
            setattr(self, k, v)


@pytest.fixture
def mock_embed_and_session():
    with patch("app.agents.customer_support.embed", return_value=[[0.1] * 16]) as e, \
         patch("app.agents.customer_support.SessionLocal") as s:
        ctx = MagicMock()
        s.return_value.__enter__.return_value = ctx
        yield e, s, ctx


def test_kb_hits_emit_kb_receipts_with_short_ids(mock_embed_and_session):
    _, _, ctx = mock_embed_and_session
    hits = [
        _Hit("kb-pk-aaaaaaaa", "Return within 7 days.", 0.82),
        _Hit("kb-pk-bbbbbbbb", "Refund 14 days.", 0.71),
    ]
    with patch("app.agents.customer_support.memory_repo") as mrepo:
        mrepo.search_kb.return_value = hits
        tool = _make_search_memory_tool("biz_1")
        msg = tool.invoke(_toolcall({"query": "return policy", "kind": "kb"}))
    assert isinstance(msg, ToolMessage)
    assert "[id=" in msg.content
    assert all(isinstance(r, KbReceipt) for r in msg.artifact)
    assert len(msg.artifact) == 2
    # Receipt id matches what the formatter renders
    assert msg.artifact[0].id == _short_id("kb-pk-aaaaaaaa")
    assert msg.artifact[0].chunk_id == "kb-pk-aaaaaaaa"


def test_kb_empty_emits_single_negative_kb_receipt(mock_embed_and_session):
    with patch("app.agents.customer_support.memory_repo") as mrepo:
        mrepo.search_kb.return_value = []
        tool = _make_search_memory_tool("biz_1")
        msg = tool.invoke(_toolcall({"query": "warranty", "kind": "kb"}))
    assert "No results" in msg.content
    assert len(msg.artifact) == 1
    r = msg.artifact[0]
    assert isinstance(r, KbReceipt)
    assert r.id.startswith("none:")
    assert r.chunk_id == "-"


def test_product_hits_emit_product_receipts(mock_embed_and_session):
    hits = [_Hit("prod_1", "Widget", 0.9, productId="prod_1")]
    with patch("app.agents.customer_support.memory_repo") as mrepo:
        mrepo.search_products.return_value = hits
        tool = _make_search_memory_tool("biz_1")
        msg = tool.invoke(_toolcall({"query": "widget", "kind": "product"}))
    assert all(isinstance(r, ProductReceipt) for r in msg.artifact)
    assert msg.artifact[0].id == "prod_1"


def test_past_action_hits_emit_past_action_receipts(mock_embed_and_session):
    hits = [_Hit("pa-pk-cccccccc", "buyer asked refund", 0.75, customerMsg="buyer asked refund")]
    with patch("app.agents.customer_support.memory_repo") as mrepo:
        mrepo.search_past_actions.return_value = hits
        tool = _make_search_memory_tool("biz_1")
        msg = tool.invoke(_toolcall({"query": "refund", "kind": "past_action"}))
    assert all(isinstance(r, PastActionReceipt) for r in msg.artifact)
    assert msg.artifact[0].full_id == "pa-pk-cccccccc"
    assert msg.artifact[0].id == _short_id("pa-pk-cccccccc")


def test_search_memory_db_error_returns_no_receipts(mock_embed_and_session):
    with patch("app.agents.customer_support.memory_repo") as mrepo:
        mrepo.search_kb.side_effect = RuntimeError("vector index down")
        tool = _make_search_memory_tool("biz_1")
        msg = tool.invoke(_toolcall({"query": "x", "kind": "kb"}))
    assert msg.content.startswith("ERROR")
    assert (msg.artifact or []) == []


def test_product_empty_emits_single_negative_product_receipt(mock_embed_and_session):
    with patch("app.agents.customer_support.memory_repo") as mrepo:
        mrepo.search_products.return_value = []
        tool = _make_search_memory_tool("biz_1")
        msg = tool.invoke(_toolcall({"query": "widget", "kind": "product"}))
    assert "No results" in msg.content
    assert len(msg.artifact) == 1
    r = msg.artifact[0]
    assert isinstance(r, ProductReceipt)
    assert r.id.startswith("none:")


def test_past_action_empty_emits_single_negative_past_action_receipt(mock_embed_and_session):
    with patch("app.agents.customer_support.memory_repo") as mrepo:
        mrepo.search_past_actions.return_value = []
        tool = _make_search_memory_tool("biz_1")
        msg = tool.invoke(_toolcall({"query": "refund", "kind": "past_action"}))
    assert "No results" in msg.content
    assert len(msg.artifact) == 1
    r = msg.artifact[0]
    assert isinstance(r, PastActionReceipt)
    assert r.id.startswith("none:")
    assert r.full_id == "-"
