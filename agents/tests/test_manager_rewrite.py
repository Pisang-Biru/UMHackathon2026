# agents/tests/test_manager_rewrite.py
import pytest
from langchain_core.messages import HumanMessage
from app.schemas.agent_io import StructuredReply, IterationEntry, FactRef
from app.agents.manager_rewrite import make_manager_rewrite_node, gates_only_check


class _LLM:
    def __init__(self, output):
        self._output = output

    def with_structured_output(self, schema):
        out = self._output
        class _W:
            async def ainvoke(self, prompt):
                return out
        return _W()


@pytest.mark.asyncio
async def test_rewrite_appends_manager_rewrite_iteration():
    rewritten = StructuredReply(
        reply="corrected",
        facts_used=[FactRef(kind="product", id="p1")],
    )
    state = {
        "messages": [HumanMessage(content="q")],
        "business_context": "biz",
        "memory_block": "",
        "jual_draft": StructuredReply(reply="bad draft"),
        "valid_fact_ids": {"product:p1"},
        "iterations": [IterationEntry(stage="jual_v1", draft=StructuredReply(reply="bad draft"))],
    }
    node = make_manager_rewrite_node(_LLM(rewritten))
    out = await node(state)
    assert out["iterations"][-1].stage == "manager_rewrite"
    assert out["iterations"][-1].draft.reply == "corrected"
    assert out["final_reply"] == "corrected"


@pytest.mark.asyncio
async def test_gates_only_check_passes_on_clean_rewrite():
    draft = StructuredReply(reply="ok", facts_used=[FactRef(kind="product", id="p1")])
    state = {
        "valid_fact_ids": {"product:p1"},
        "iterations": [IterationEntry(stage="manager_rewrite", draft=draft)],
    }
    out = await gates_only_check(state)
    assert out["final_action_hint"] == "auto_send"
    assert out["final_reply"] == "ok"


@pytest.mark.asyncio
async def test_gates_only_check_escalates_on_hallucinated_rewrite():
    draft = StructuredReply(reply="ok", facts_used=[FactRef(kind="product", id="ghost")])
    state = {
        "valid_fact_ids": {"product:p1"},
        "iterations": [IterationEntry(stage="manager_rewrite", draft=draft)],
    }
    out = await gates_only_check(state)
    assert out["final_action_hint"] == "escalate"


@pytest.mark.asyncio
async def test_gates_only_check_escalates_on_needs_human():
    draft = StructuredReply(reply="pls help", needs_human=True)
    state = {
        "valid_fact_ids": set(),
        "iterations": [IterationEntry(stage="manager_rewrite", draft=draft)],
    }
    out = await gates_only_check(state)
    assert out["final_action_hint"] == "escalate"
