# agents/tests/test_manager_evaluator.py
import pytest
from langchain_core.messages import HumanMessage, AIMessage
from app.schemas.agent_io import (
    StructuredReply, ManagerCritique, ManagerVerdict, IterationEntry, FactRef,
)
from app.agents.manager_evaluator import build_evaluator_prompt, make_evaluate_node


def _state(**overrides):
    draft = StructuredReply(reply="hi", addressed_questions=["harga?"])
    base = {
        "messages": [HumanMessage(content="berapa harga?")],
        "business_context": "Business: Foo",
        "memory_block": "",
        "valid_fact_ids": {"product:p1"},
        "jual_draft": draft,
        "verdict": None,
        "critique": None,
        "gate_results": None,
        "revision_count": 0,
        "iterations": [IterationEntry(stage="jual_v1", draft=draft)],
    }
    base.update(overrides)
    return base


def test_build_prompt_contains_draft_and_context():
    s = _state()
    p = build_evaluator_prompt(s, s["jual_draft"])
    assert "Business: Foo" in p
    assert "berapa harga?" in p
    assert "hi" in p   # draft text


def test_build_prompt_revision_pass_includes_prior_critique():
    critique_v1 = ManagerCritique(missing_facts=["diabetic mom"])
    v1_entry = IterationEntry(
        stage="jual_v1",
        draft=StructuredReply(reply="v1"),
        verdict=ManagerVerdict(verdict="revise", critique=critique_v1, reason="gap"),
    )
    v2_entry = IterationEntry(stage="jual_v2", draft=StructuredReply(reply="v2"))
    s = _state(revision_count=1, iterations=[v1_entry, v2_entry], jual_draft=v2_entry.draft)
    p = build_evaluator_prompt(s, s["jual_draft"])
    assert "REVISED draft" in p
    assert "diabetic mom" in p
    assert "Do NOT emit 'revise'" in p


@pytest.mark.asyncio
async def test_evaluate_gate_path_skips_llm():
    class _RaisingLLM:
        def with_structured_output(self, schema):
            raise AssertionError("LLM must not be called when a gate fires")
    draft = StructuredReply(reply="hi", needs_human=True)
    s = _state(jual_draft=draft, iterations=[IterationEntry(stage="jual_v1", draft=draft)])
    evaluate = make_evaluate_node(_RaisingLLM())
    out = await evaluate(s)
    assert out["verdict"] == "escalate"
    assert out["iterations"][-1].verdict.verdict == "escalate"


@pytest.mark.asyncio
async def test_evaluate_llm_path_when_gates_pass():
    class _LLM:
        def with_structured_output(self, schema):
            class _W:
                async def ainvoke(self, prompt):
                    return ManagerVerdict(verdict="pass", reason="all good")
            return _W()
    draft = StructuredReply(
        reply="RM15",
        addressed_questions=["harga?"],
        facts_used=[FactRef(kind="product", id="p1")],
    )
    s = _state(jual_draft=draft, iterations=[IterationEntry(stage="jual_v1", draft=draft)])
    evaluate = make_evaluate_node(_LLM())
    out = await evaluate(s)
    assert out["verdict"] == "pass"
    assert out["iterations"][-1].verdict.reason == "all good"


@pytest.mark.asyncio
async def test_evaluate_returns_new_iterations_list_not_mutation():
    class _LLM:
        def with_structured_output(self, schema):
            class _W:
                async def ainvoke(self, prompt):
                    return ManagerVerdict(verdict="pass", reason="ok")
            return _W()
    draft = StructuredReply(
        reply="hi",
        addressed_questions=["q?"],
        facts_used=[FactRef(kind="product", id="p1")],
    )
    original_iter = [IterationEntry(stage="jual_v1", draft=draft)]
    s = _state(jual_draft=draft, iterations=original_iter)
    evaluate = make_evaluate_node(_LLM())
    out = await evaluate(s)
    assert out["iterations"] is not original_iter
    assert original_iter[0].verdict is None   # unmodified
