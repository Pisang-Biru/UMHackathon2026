from app.schemas.agent_io import (
    FactRef, StructuredReply, ManagerCritique, ManagerVerdict, IterationEntry,
)


def test_fact_ref_requires_kind_and_id():
    f = FactRef(kind="product", id="p_123")
    assert f.kind == "product" and f.id == "p_123"


def test_structured_reply_defaults():
    r = StructuredReply(reply="hi")
    assert r.confidence == 0.5
    assert r.reasoning == ""
    assert r.addressed_questions == []
    assert r.unaddressed_questions == []
    assert r.facts_used == []
    assert r.needs_human is False


def test_structured_reply_full_payload():
    r = StructuredReply(
        reply="ok",
        confidence=0.9,
        reasoning="direct",
        addressed_questions=["price?"],
        unaddressed_questions=[],
        facts_used=[{"kind": "product", "id": "p1"}],
        needs_human=False,
    )
    assert r.facts_used[0].kind == "product"


def test_manager_verdict_critique_optional():
    v = ManagerVerdict(verdict="pass", reason="all good")
    assert v.critique is None

    v2 = ManagerVerdict(
        verdict="revise",
        critique=ManagerCritique(missing_facts=["diabetic mom"]),
        reason="missing context",
    )
    assert v2.critique.missing_facts == ["diabetic mom"]


def test_iteration_entry_json_round_trip():
    e = IterationEntry(
        stage="jual_v1",
        draft=StructuredReply(reply="hi"),
        verdict=ManagerVerdict(verdict="pass", reason="ok"),
        gate_results={"passed": True},
        latency_ms=120,
    )
    payload = e.model_dump(mode="json")
    assert payload["stage"] == "jual_v1"
    restored = IterationEntry.model_validate(payload)
    assert restored.draft.reply == "hi"
    assert restored.verdict.verdict == "pass"


def test_manager_critique_fields_all_default_empty():
    c = ManagerCritique()
    assert c.missing_facts == [] and c.incorrect_claims == []
    assert c.tone_issues == [] and c.unanswered_questions == []
    assert c.keep_from_draft == []
