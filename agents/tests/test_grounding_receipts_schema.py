# agents/tests/test_grounding_receipts_schema.py
import pytest
from pydantic import TypeAdapter, ValidationError
from app.schemas.agent_io import (
    GroundingReceipt,
    ProductReceipt,
    OrderReceipt,
    KbReceipt,
    PastActionReceipt,
    PaymentLinkReceipt,
)

_ADAPTER = TypeAdapter(GroundingReceipt)


def test_product_receipt_round_trips():
    r = ProductReceipt(id="prod_123")
    data = _ADAPTER.dump_python(r)
    assert data == {"kind": "product", "id": "prod_123"}
    parsed = _ADAPTER.validate_python(data)
    assert isinstance(parsed, ProductReceipt)
    assert parsed.id == "prod_123"


def test_order_receipt_supports_negative_id():
    r = OrderReceipt(id="none:60123456789")
    data = _ADAPTER.dump_python(r)
    parsed = _ADAPTER.validate_python(data)
    assert isinstance(parsed, OrderReceipt)
    assert parsed.id == "none:60123456789"


def test_kb_receipt_round_trips_with_chunk_id_and_sim():
    r = KbReceipt(id="ab12cd34", chunk_id="full-chunk-pk", sim=0.82)
    parsed = _ADAPTER.validate_python(_ADAPTER.dump_python(r))
    assert parsed.chunk_id == "full-chunk-pk"
    assert parsed.sim == pytest.approx(0.82)


def test_past_action_receipt_round_trip():
    r = PastActionReceipt(id="cd56ef78", full_id="action-full", sim=0.71)
    parsed = _ADAPTER.validate_python(_ADAPTER.dump_python(r))
    assert parsed.kind == "memory:past_action"
    assert parsed.id == "cd56ef78"


def test_payment_link_receipt_round_trip():
    r = PaymentLinkReceipt(id="order_xyz")
    parsed = _ADAPTER.validate_python(_ADAPTER.dump_python(r))
    assert parsed.kind == "payment_link"


def test_discriminator_rejects_unknown_kind():
    with pytest.raises(ValidationError):
        _ADAPTER.validate_python({"kind": "weather", "id": "sunny"})


def test_discriminator_routes_by_kind_field():
    parsed = _ADAPTER.validate_python({"kind": "kb", "id": "ab12cd34", "chunk_id": "x", "sim": 0.5})
    assert isinstance(parsed, KbReceipt)
