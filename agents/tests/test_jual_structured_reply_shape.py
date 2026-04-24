from app.schemas.agent_io import StructuredReply, FactRef


def test_customer_support_reexports_structured_reply_from_schemas():
    # Jual must use the shared schema, not a local one.
    from app.agents import customer_support as cs
    assert cs.StructuredReply is StructuredReply


def test_structured_reply_accepts_new_fields_from_jual():
    # Simulates what Jual's prompt will produce.
    raw = {
        "reply": "RM15 ada stock",
        "confidence": 0.92,
        "reasoning": "from product list",
        "addressed_questions": ["harga?"],
        "unaddressed_questions": [],
        "facts_used": [{"kind": "product", "id": "p_001"}],
        "needs_human": False,
    }
    sr = StructuredReply.model_validate(raw)
    assert sr.facts_used[0] == FactRef(kind="product", id="p_001")
