# agents/app/agents/manager_gates.py
import re
from dataclasses import dataclass, field
from typing import Literal
from langchain_core.messages import BaseMessage, HumanMessage
from app.schemas.agent_io import StructuredReply, ManagerCritique


FACTUAL_Q_RE = re.compile(
    r"\b(harga|price|stock|berapa|bila|macam\s+mana|bagaimana|"
    r"how\s+much|available|when|order|cost|beli)\b",
    re.IGNORECASE,
)


def _last_human_text(messages: list[BaseMessage]) -> str:
    for msg in reversed(messages):
        if isinstance(msg, HumanMessage) and isinstance(msg.content, str):
            return msg.content
    return ""


@dataclass
class GateResult:
    verdict: Literal["pass", "revise", "rewrite", "escalate"] | None
    gate_num: int | None = None
    reason_slug: str | None = None
    critique: ManagerCritique | None = None
    passed_gates: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "verdict": self.verdict,
            "gate_num": self.gate_num,
            "reason_slug": self.reason_slug,
            "passed_gates": self.passed_gates,
        }


def run_gates(
    draft: StructuredReply,
    *,
    valid_fact_ids: set[str],
    revision_count: int,
    messages: list[BaseMessage],
    preloaded_fact_ids: set[str] | None = None,
    tool_calls_this_turn: int = 0,
) -> GateResult:
    """Run gates against a draft.

    `preloaded_fact_ids` is the snapshot of valid_fact_ids before any tools fired
    this turn. Used by Gate 5 to distinguish "no tool fired" (ungrounded answer)
    from "tool fired but draft did not cite the result" (uncited tool result).
    Defaults to empty for callers that don't track it (legacy tests).

    kb / memory:past_action grounding verifies a specific retrieved chunk was
    cited as basis. Relevance of claim to chunk content is NOT checked
    automatically — that's delegated to manager_evaluator's content judgment.
    A future LLM-judged relevance gate (claim-vs-content) would close this gap.
    See docs/superpowers/specs/2026-04-25-grounding-receipts-envelope-design.md §8.
    """
    if preloaded_fact_ids is None:
        preloaded_fact_ids = set()
    passed = []

    # Gate 1 — needs_human flag
    if draft.needs_human:
        return GateResult(verdict="escalate", gate_num=1, reason_slug="jual_self_flagged", passed_gates=passed)
    passed.append("needs_human_flag")

    # Gate 2 — hallucinated fact.
    #
    # `<kind>:none:*` is a wildcard sentinel: pre-seeded by load_shared_context
    # only when an authoritative DB lookup confirms the buyer has no records
    # of that kind. If present, accept any `<kind>:none:...` citation —
    # the model may self-format the empty-receipt id with phone digits,
    # masked digits, or any deterministic suffix; the negative is grounded
    # by the (business, buyer, kind) tuple being verifiably empty.
    #
    # For non-factual buyer messages (greetings, identity confirmations) we
    # strip invented ids in place rather than triggering a costly rewrite —
    # the reply text doesn't depend on a citation in those cases.
    buyer_msg_for_gate = _last_human_text(messages)
    is_factual_q_for_gate = bool(FACTUAL_Q_RE.search(buyer_msg_for_gate))

    ungrounded: list = []
    for fact in draft.facts_used:
        key = f"{fact.kind}:{fact.id}"
        if key in valid_fact_ids:
            continue
        if (
            fact.id.startswith("none:")
            and f"{fact.kind}:none:*" in valid_fact_ids
        ):
            continue
        ungrounded.append(fact)

    if ungrounded:
        if is_factual_q_for_gate:
            fact = ungrounded[0]
            return GateResult(
                verdict="rewrite",
                gate_num=2,
                reason_slug=f"ungrounded_fact:{fact.kind}:{fact.id}",
                passed_gates=passed,
            )
        ungrounded_keys = {f"{f.kind}:{f.id}" for f in ungrounded}
        draft.facts_used = [
            f for f in draft.facts_used
            if f"{f.kind}:{f.id}" not in ungrounded_keys
        ]
        passed.append("hallucinated_fact_stripped_non_factual")
    else:
        passed.append("hallucinated_fact")

    # Gate 3 / 4 — unaddressed questions
    if draft.unaddressed_questions:
        if revision_count == 0:
            return GateResult(
                verdict="revise",
                gate_num=3,
                reason_slug="jual_self_reported_gap",
                critique=ManagerCritique(unanswered_questions=list(draft.unaddressed_questions)),
                passed_gates=passed,
            )
        return GateResult(
            verdict="rewrite",
            gate_num=4,
            reason_slug="revise_failed_to_close_gaps",
            passed_gates=passed,
        )
    passed.append("unaddressed")

    # Gate 5 — factual question without grounding.
    #
    # A tool firing this turn IS the grounding act, even if it returned no
    # artifacts. "I queried orders and you have none" is a grounded
    # negative answer — `facts_used == []` is correct in that case. We
    # distinguish three sub-cases by combining `tool_calls_this_turn`
    # (any tool fired) and `added_this_turn` (any new fact id harvested):
    #   tool_calls=0, added=0 -> truly ungrounded (revise/rewrite).
    #   tool_calls>0, added>0 -> tool produced data but draft didn't cite
    #                            it (uncited_tool_result; revise/rewrite).
    #   tool_calls>0, added=0 -> tool fired but returned empty; pass.
    buyer_msg = _last_human_text(messages)
    if FACTUAL_Q_RE.search(buyer_msg) and not draft.facts_used:
        added_this_turn = valid_fact_ids - preloaded_fact_ids
        if tool_calls_this_turn > 0 and not added_this_turn:
            # Tool ran, returned empty — negative answer is grounded.
            passed.append("factual_q_grounded_via_empty_lookup")
        else:
            had_retrieval = bool(added_this_turn)
            base = "uncited_tool_result" if had_retrieval else "ungrounded_factual_answer"
            if revision_count == 0:
                return GateResult(
                    verdict="revise",
                    gate_num=5,
                    reason_slug=base,
                    critique=ManagerCritique(
                        missing_facts=[f"grounded data for: {buyer_msg[:80]}"],
                    ),
                    passed_gates=passed,
                )
            return GateResult(
                verdict="rewrite",
                gate_num=5,
                reason_slug=f"{base}_persists",
                passed_gates=passed,
            )
    passed.append("factual_q_grounded")

    # Fast-path: non-factual buyer message + draft has no unresolved questions
    # is auto-pass. Skips the ~20s LLM evaluator call for greetings, identity
    # confirmations, thanks, etc. Factual messages still get LLM judgment.
    if not is_factual_q_for_gate and not draft.unaddressed_questions:
        return GateResult(verdict="pass", reason_slug="non_factual_clean_draft", passed_gates=passed)

    return GateResult(verdict=None, passed_gates=passed)
