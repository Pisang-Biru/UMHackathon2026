# agents/tests/test_check_order_status_envelope.py
import pytest
from unittest.mock import MagicMock, patch
from langchain_core.messages import ToolMessage
from app.schemas.agent_io import OrderReceipt
from app.agents.customer_support import _make_order_lookup_tool, _phone_key


def _toolcall(args=None, name="check_order_status", id="call_1"):
    return {"name": name, "args": args or {}, "id": id, "type": "tool_call"}


def test_phone_key_strips_non_digits():
    assert _phone_key("+60 12-345 6789") == "60123456789"
    assert _phone_key("60123456789") == "60123456789"
    assert _phone_key("") == ""
    assert _phone_key(None) == ""


def test_phone_key_round_trip_with_spaces_and_dashes():
    a = _phone_key("+60 12-345 6789")
    b = _phone_key("60-123-456-789")
    assert a == b == "60123456789"


def test_check_order_status_no_phone_returns_error_no_receipts():
    tool = _make_order_lookup_tool("biz_1", "")
    msg = tool.invoke(_toolcall())
    assert isinstance(msg, ToolMessage)
    assert "ERROR" in msg.content
    assert (msg.artifact or []) == []


def test_check_order_status_empty_emits_negative_receipt():
    tool = _make_order_lookup_tool("biz_1", "+60 12-345 6789")
    with patch("app.agents.customer_support.SessionLocal") as mock_session:
        ctx = MagicMock()
        mock_session.return_value.__enter__.return_value = ctx
        ctx.query.return_value.outerjoin.return_value.filter.return_value.order_by.return_value.limit.return_value.all.return_value = []
        msg = tool.invoke(_toolcall())
    assert msg.content == "no orders found for this phone"
    assert len(msg.artifact) == 1
    r = msg.artifact[0]
    assert isinstance(r, OrderReceipt)
    assert r.id == "none:60123456789"


def test_check_order_status_db_error_returns_no_receipts():
    tool = _make_order_lookup_tool("biz_1", "60123")
    with patch("app.agents.customer_support.SessionLocal") as mock_session:
        mock_session.side_effect = RuntimeError("db down")
        msg = tool.invoke(_toolcall())
    assert msg.content.startswith("ERROR")
    assert (msg.artifact or []) == []


def test_check_order_status_orders_emit_one_receipt_per_row():
    from datetime import datetime
    from app.db import OrderStatus
    tool = _make_order_lookup_tool("biz_1", "60123456789")
    fake_order_a = MagicMock(
        id="ord_aaaaaaaaaa", productId="prod_1", qty=2,
        status=OrderStatus.PAID, createdAt=datetime(2026, 4, 25),
        paidAt=datetime(2026, 4, 25), paymentUrl=None,
    )
    fake_order_b = MagicMock(
        id="ord_bbbbbbbbbb", productId="prod_2", qty=1,
        status=OrderStatus.PENDING_PAYMENT, createdAt=datetime(2026, 4, 24),
        paidAt=None, paymentUrl="https://pay/x",
    )
    rows = [(fake_order_a, "Widget"), (fake_order_b, "Gadget")]
    with patch("app.agents.customer_support.SessionLocal") as mock_session:
        ctx = MagicMock()
        mock_session.return_value.__enter__.return_value = ctx
        ctx.query.return_value.outerjoin.return_value.filter.return_value.order_by.return_value.limit.return_value.all.return_value = rows
        msg = tool.invoke(_toolcall())
    ids = sorted(r.id for r in msg.artifact)
    assert ids == ["ord_aaaaaaaaaa", "ord_bbbbbbbbbb"]
    assert all(isinstance(r, OrderReceipt) for r in msg.artifact)
