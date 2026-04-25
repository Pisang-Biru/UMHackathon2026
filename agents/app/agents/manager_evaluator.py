# agents/app/agents/manager_evaluator.py
import logging
import time
from app.schemas.agent_io import StructuredReply, ManagerVerdict
from app.agents.manager_gates import run_gates

_log = logging.getLogger(__name__)


SYSTEM_PREAMBLE = (
    "You are Manager, evaluating a draft reply your worker Jual produced for a buyer. "
    "Your only job: emit one of four verdicts — pass, revise, rewrite, escalate."
)

VERDICT_CRITERIA_BLOCK = """\
# Verdict criteria
- pass      : reply is accurate, addresses buyer, tone appropriate. DEFAULT when in doubt — lean permissive.
- revise    : specific fixable issues. ONLY if revision_count == 0.
- rewrite   : draft is structurally off but you can do better with same context. No tools available.
- escalate  : genuinely requires human (refund, unknown policy, sensitive complaint).

Target: escalate is RARE (~5-10% of turns). The human operator is a busy student — respect their time.
When uncertain between pass and revise, choose pass. When uncertain between rewrite and escalate, choose rewrite.

If verdict == "revise", populate ManagerCritique with concrete actionable items:
- missing_facts, incorrect_claims, tone_issues, unanswered_questions, keep_from_draft.

Emit ManagerVerdict JSON only.
"""


def _format_recent(messages, n: int = 6) -> str:
    recent = messages[-n:] if len(messages) > n else messages
    lines = []
    for m in recent:
        role = type(m).__name__.replace("Message", "").lower()
        content = m.content if isinstance(m.content, str) else str(m.content)
        lines.append(f"[{role}] {content}")
    return "\n".join(lines)


def _extract_last_buyer_msg(messages) -> str:
    from langchain_core.messages import HumanMessage
    for m in reversed(messages):
        if isinstance(m, HumanMessage) and isinstance(m.content, str):
            return m.content
    return ""


def build_evaluator_prompt(state: dict, draft: StructuredReply) -> str:
    parts = [
        SYSTEM_PREAMBLE,
        f"\n# Context\nBusiness: {state.get('business_context','')}",
        f"\n# Memory\n{state.get('memory_block','')}",
        f"\n# Conversation (last 6 turns)\n{_format_recent(state.get('messages', []))}",
        f'\n# The specific message Jual is replying to\n"{_extract_last_buyer_msg(state.get("messages", []))}"',
        f"\n# Jual's draft",
        f"Reply: {draft.reply}",
        f"Addressed: {draft.addressed_questions}",
        f"Unaddressed: {draft.unaddressed_questions}",
        f"Facts used: {[f.model_dump() for f in draft.facts_used]}",
    ]
    if state.get("revision_count", 0) >= 1:
        # v1 is iterations[-2]; v2 is iterations[-1]
        prior_entry = state["iterations"][-2]
        prior = prior_entry.verdict.critique if prior_entry.verdict else None
        critique_json = prior.model_dump_json(indent=2) if prior else "{}"
        parts.append(
            "\n# This is a REVISED draft (v2).\n"
            f"The original critique was:\n{critique_json}\n"
            "Check: did Jual address each point? If yes → lean pass. "
            "If Jual introduced new problems while fixing old → rewrite. "
            "Do NOT emit 'revise' — already revised once."
        )
    parts.append("\n" + VERDICT_CRITERIA_BLOCK)
    parts.append(
        "Always populate `reason` with a one-sentence justification — "
        "even on pass (e.g., 'all questions addressed with grounded facts')."
    )
    return "\n".join(parts)


def make_evaluate_node(llm):
    async def evaluate(state: dict) -> dict:
        draft = state["jual_draft"]
        gate_result = run_gates(
            draft,
            valid_fact_ids=state.get("valid_fact_ids", set()),
            preloaded_fact_ids=state.get("preloaded_fact_ids", set()),
            revision_count=state.get("revision_count", 0),
            messages=state.get("messages", []),
        )
        t0 = time.monotonic()
        if gate_result.verdict is not None:
            verdict_obj = ManagerVerdict(
                verdict=gate_result.verdict,
                critique=gate_result.critique,
                reason=f"gate:{gate_result.reason_slug}",
            )
            via = f"gate_{gate_result.gate_num}"
        else:
            prompt = build_evaluator_prompt(state, draft)
            verdict_obj = await llm.with_structured_output(ManagerVerdict).ainvoke(prompt)
            via = "llm"
        latency_ms = int((time.monotonic() - t0) * 1000)

        current = state["iterations"][-1]
        updated = current.model_copy(update={
            "verdict": verdict_obj,
            "gate_results": gate_result.as_dict(),
            "latency_ms": (current.latency_ms or 0) + latency_ms,
        })

        _log.info(
            "evaluator_decision",
            extra={
                "verdict": verdict_obj.verdict,
                "via": via,
                "revision_count": state.get("revision_count", 0),
                "stage": current.stage,
                "reason": verdict_obj.reason,
            },
        )
        return {
            "iterations": [*state["iterations"][:-1], updated],
            "verdict": verdict_obj.verdict,
            "critique": verdict_obj.critique,
        }
    return evaluate
