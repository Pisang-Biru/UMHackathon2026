# agents/tests/test_manager_helpers.py
import pytest
from app.schemas.agent_io import StructuredReply, IterationEntry, ManagerVerdict, FactRef
from app.agents.manager_helpers import (
    pick_best_draft_for_human,
    humanize_reason,
    build_escalation_summary,
    resolve_final_reply,
    jual_v1_reply,
    jual_v1_confidence,
)


def _it(stage, reply="x", facts=None, needs_human=False, confidence=0.5):
    return IterationEntry(
        stage=stage,
        draft=StructuredReply(
            reply=reply,
            facts_used=facts or [],
            needs_human=needs_human,
            confidence=confidence,
        ),
    )


def test_picks_rewrite_when_grounded():
    state = {
        "iterations": [
            _it("jual_v1", "v1"),
            _it("jual_v2", "v2"),
            _it("manager_rewrite", "rewrite", facts=[FactRef(kind="product", id="p1")]),
        ],
        "valid_fact_ids": {"product:p1"},
    }
    assert pick_best_draft_for_human(state) == "rewrite"


def test_skips_rewrite_when_hallucinated():
    state = {
        "iterations": [
            _it("jual_v1", "v1"),
            _it("jual_v2", "v2"),
            _it("manager_rewrite", "bad", facts=[FactRef(kind="product", id="ghost")]),
        ],
        "valid_fact_ids": {"product:p1"},
    }
    assert pick_best_draft_for_human(state) == "v2"


def test_falls_back_to_v1_when_no_v2():
    state = {"iterations": [_it("jual_v1", "v1")], "valid_fact_ids": set()}
    assert pick_best_draft_for_human(state) == "v1"


def test_returns_empty_string_when_no_drafts():
    state = {"iterations": [], "valid_fact_ids": set()}
    assert pick_best_draft_for_human(state) == ""


def test_humanize_known_slugs():
    assert "Refund" in humanize_reason("gate:jual_self_flagged")
    assert "couldn't answer" in humanize_reason("gate:jual_self_reported_gap")
    assert "tried twice" in humanize_reason("gate:revise_failed_to_close_gaps").lower()
    assert "didn't have data" in humanize_reason("gate:ungrounded_factual_answer")
    assert "even after revising" in humanize_reason("gate:ungrounded_factual_answer_persists").lower()
    assert "double-check" in humanize_reason("gate:ungrounded_fact:product:p1")


def test_humanize_llm_reason_passes_through():
    assert humanize_reason("reply covers all points") == "reply covers all points"


def test_humanize_unknown_gate_returns_default(caplog):
    result = humanize_reason("gate:made_up_gate")
    assert result == "Needs your review."


def test_build_escalation_summary_uses_last_verdict():
    v1 = IterationEntry(
        stage="jual_v1",
        verdict=ManagerVerdict(verdict="escalate", reason="gate:jual_self_flagged"),
    )
    state = {"iterations": [v1]}
    assert "Refund" in build_escalation_summary(state)


def test_build_escalation_summary_non_escalate_verdict_gives_rewrite_default():
    v1 = IterationEntry(
        stage="jual_v1",
        verdict=ManagerVerdict(verdict="rewrite", reason="gate:ungrounded_fact:product:ghost"),
    )
    state = {"iterations": [v1]}
    # gates_only_check path — last verdict wasn't "escalate" at evaluate time
    assert "fact" in build_escalation_summary(state).lower()


def test_resolve_final_reply_uses_explicit_final_reply():
    state = {"final_reply": "done", "jual_draft": None, "iterations": []}
    assert resolve_final_reply(state) == "done"


def test_resolve_final_reply_falls_back_to_jual_draft():
    state = {
        "final_reply": None,
        "jual_draft": StructuredReply(reply="fallback"),
        "iterations": [],
    }
    assert resolve_final_reply(state) == "fallback"


def test_resolve_final_reply_raises_when_unresolvable():
    state = {"final_reply": None, "jual_draft": None, "iterations": []}
    with pytest.raises(RuntimeError):
        resolve_final_reply(state)


def test_jual_v1_reply_and_confidence():
    state = {"iterations": [_it("jual_v1", "first", confidence=0.7)]}
    assert jual_v1_reply(state) == "first"
    assert jual_v1_confidence(state) == 0.7
