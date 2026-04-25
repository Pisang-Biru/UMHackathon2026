# agents/tests/test_manager_gates.py
import pytest
from langchain_core.messages import HumanMessage
from app.schemas.agent_io import StructuredReply, FactRef
from app.agents.manager_gates import run_gates


def _draft(**kwargs):
    defaults = dict(reply="ok", confidence=0.8, reasoning="r")
    defaults.update(kwargs)
    return StructuredReply(**defaults)


def _msgs(text): return [HumanMessage(content=text)]


def test_gate1_needs_human_flag_escalates():
    d = _draft(needs_human=True)
    r = run_gates(d, valid_fact_ids=set(), revision_count=0, messages=_msgs("hi"))
    assert r.verdict == "escalate"
    assert r.reason_slug == "jual_self_flagged"


def test_gate2_hallucinated_fact_triggers_rewrite():
    d = _draft(facts_used=[FactRef(kind="product", id="ghost")])
    r = run_gates(d, valid_fact_ids={"product:real"}, revision_count=0, messages=_msgs("harga?"))
    assert r.verdict == "rewrite"
    assert r.reason_slug.startswith("ungrounded_fact:product:ghost")


def test_gate3_unaddressed_first_pass_revises():
    d = _draft(unaddressed_questions=["shipping?"])
    r = run_gates(d, valid_fact_ids=set(), revision_count=0, messages=_msgs("q"))
    assert r.verdict == "revise"


def test_gate4_unaddressed_after_revise_rewrites():
    d = _draft(unaddressed_questions=["shipping?"])
    r = run_gates(d, valid_fact_ids=set(), revision_count=1, messages=_msgs("q"))
    assert r.verdict == "rewrite"


def test_gate5a_ungrounded_factual_revises_v1():
    d = _draft(facts_used=[])
    r = run_gates(d, valid_fact_ids=set(), revision_count=0, messages=_msgs("berapa harga ondeh?"))
    assert r.verdict == "revise"
    assert r.reason_slug == "ungrounded_factual_answer"


def test_gate5b_ungrounded_factual_rewrites_v2():
    d = _draft(facts_used=[])
    r = run_gates(d, valid_fact_ids=set(), revision_count=1, messages=_msgs("how much?"))
    assert r.verdict == "rewrite"


def test_gate5_empty_tool_result_is_grounded_negative_answer():
    """When a tool fired but returned no artifacts, a negative answer
    (no facts cited) must be treated as grounded — not escalated."""
    d = _draft(facts_used=[])
    r = run_gates(
        d,
        valid_fact_ids=set(),
        preloaded_fact_ids=set(),
        revision_count=0,
        messages=_msgs("saya ada beli apa-apa harini?"),
        tool_calls_this_turn=1,
    )
    assert r.verdict is None
    assert "factual_q_grounded_via_empty_lookup" in r.passed_gates


def test_gate2_negative_receipt_wildcard_accepts_any_none_id():
    """When the load step seeds `order:none:*`, any `order:none:<x>` citation
    must pass Gate 2 — the model may self-format the suffix arbitrarily
    (digits-only, +-prefixed, or even self-redacted asterisks)."""
    d = _draft(facts_used=[FactRef(kind="order", id="none:+601********")])
    r = run_gates(
        d,
        valid_fact_ids={"order:none:*"},
        revision_count=0,
        messages=_msgs("ada beli ke?"),
    )
    assert r.verdict is None or r.verdict == "revise"  # Gate 2 must pass; downstream may still revise on other rules.
    assert r.reason_slug != "ungrounded_fact:order:none:+601********"


def test_gate2_wildcard_does_not_admit_other_kinds():
    """The wildcard is per-kind — `order:none:*` must not silently
    admit `product:none:*` or other fabricated negatives."""
    d = _draft(facts_used=[FactRef(kind="product", id="none:fake")])
    r = run_gates(
        d,
        valid_fact_ids={"order:none:*"},
        revision_count=0,
        messages=_msgs("ada barang?"),
    )
    assert r.verdict == "rewrite"
    assert r.reason_slug == "ungrounded_fact:product:none:fake"


def test_gate5_no_tool_no_facts_still_escalates():
    """Sanity: when no tool fires AND no facts cited, behavior unchanged."""
    d = _draft(facts_used=[])
    r = run_gates(
        d,
        valid_fact_ids=set(),
        preloaded_fact_ids=set(),
        revision_count=0,
        messages=_msgs("berapa harga ondeh?"),
        tool_calls_this_turn=0,
    )
    assert r.verdict == "revise"
    assert r.reason_slug == "ungrounded_factual_answer"


def test_precedence_needs_human_beats_hallucinated():
    d = _draft(needs_human=True, facts_used=[FactRef(kind="product", id="ghost")])
    r = run_gates(d, valid_fact_ids=set(), revision_count=0, messages=_msgs("hi"))
    assert r.verdict == "escalate"


def test_all_gates_pass_returns_none_verdict():
    d = _draft(
        facts_used=[FactRef(kind="product", id="real")],
        addressed_questions=["harga?"],
    )
    r = run_gates(d, valid_fact_ids={"product:real"}, revision_count=0, messages=_msgs("harga?"))
    assert r.verdict is None


def test_factual_q_regex_ignores_idioms():
    # "terima kasih ada jumpa lagi" must not match gate 5 via bare "ada"
    d = _draft(facts_used=[])
    r = run_gates(d, valid_fact_ids=set(), revision_count=0, messages=_msgs("terima kasih ada jumpa lagi"))
    assert r.verdict is None   # no factual-Q hit


def test_gate3_critique_populated_on_revise():
    d = _draft(unaddressed_questions=["shipping?"])
    r = run_gates(d, valid_fact_ids=set(), revision_count=0, messages=_msgs("q"))
    assert r.critique is not None
    assert "shipping?" in r.critique.unanswered_questions


# ---- FACTUAL_Q_RE recall envelope ----
# These tests lock in the current set of phrases that trigger gate 5.
# When the regex is tuned, these tests MUST be updated so the recall
# envelope is never silently changed.
@pytest.mark.parametrize("phrase", [
    "berapa harga ondeh?",
    "how much is this",
    "ada stock tak?",          # "stock" keyword
    "cost?",
    "when will it arrive",
    "bila sampai?",
    "bagaimana saya beli?",
    "macam mana nak order?",
])
def test_factual_q_regex_matches_expected_phrases(phrase):
    d = _draft(facts_used=[])
    r = run_gates(d, valid_fact_ids=set(), revision_count=0, messages=_msgs(phrase))
    assert r.verdict == "revise", f"expected gate 5 to trigger on {phrase!r}, got {r.verdict}"


@pytest.mark.parametrize("phrase", [
    "terima kasih ada jumpa lagi",   # idiom, must NOT match via 'ada'
    "apa khabar",                     # greeting, no factual signal
    "ok thanks",
])
def test_factual_q_regex_ignores_non_factual(phrase):
    d = _draft(facts_used=[])
    r = run_gates(d, valid_fact_ids=set(), revision_count=0, messages=_msgs(phrase))
    assert r.verdict is None, f"expected no gate 5 hit on {phrase!r}, got {r.verdict}"


def test_gate5_no_facts_no_retrieval_says_ungrounded():
    d = _draft(facts_used=[])
    r = run_gates(
        d,
        valid_fact_ids={"product:p1"},
        preloaded_fact_ids={"product:p1"},
        revision_count=0,
        messages=_msgs("ada saya beli apa-apa harini?"),
    )
    assert r.verdict == "revise"
    assert r.gate_num == 5
    assert r.reason_slug == "ungrounded_factual_answer"


def test_gate5_no_facts_but_retrieval_happened_says_uncited():
    d = _draft(facts_used=[])
    r = run_gates(
        d,
        valid_fact_ids={"product:p1", "order:none:60123"},
        preloaded_fact_ids={"product:p1"},
        revision_count=0,
        messages=_msgs("ada saya beli apa-apa harini?"),
    )
    assert r.verdict == "revise"
    assert r.gate_num == 5
    assert r.reason_slug == "uncited_tool_result"


def test_gate5_negative_receipt_cited_passes():
    d = _draft(facts_used=[FactRef(kind="order", id="none:60123")])
    r = run_gates(
        d,
        valid_fact_ids={"product:p1", "order:none:60123"},
        preloaded_fact_ids={"product:p1"},
        revision_count=0,
        messages=_msgs("ada saya beli apa-apa harini?"),
    )
    assert r.verdict is None  # all gates passed


def test_gate5_uncited_tool_result_persists_after_revise():
    d = _draft(facts_used=[])
    r = run_gates(
        d,
        valid_fact_ids={"product:p1", "order:ord_42"},
        preloaded_fact_ids={"product:p1"},
        revision_count=1,
        messages=_msgs("ada saya beli apa-apa harini?"),
    )
    assert r.verdict == "rewrite"
    assert r.reason_slug == "uncited_tool_result_persists"
