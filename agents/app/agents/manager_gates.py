# agents/app/agents/manager_gates.py
import re
from dataclasses import dataclass, field
from typing import Literal
from langchain_core.messages import BaseMessage, HumanMessage
from app.schemas.agent_io import StructuredReply, ManagerCritique


FACTUAL_Q_RE = re.compile(
    r"\b(harga|price|stock|berapa|bila|macam\s+mana|bagaimana|"
    r"how\s+much|available|when|order|cost)\b",
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
) -> GateResult:
    passed = []

    # Gate 1 — needs_human flag
    if draft.needs_human:
        return GateResult(verdict="escalate", gate_num=1, reason_slug="jual_self_flagged", passed_gates=passed)
    passed.append("needs_human_flag")

    # Gate 2 — hallucinated fact
    for fact in draft.facts_used:
        key = f"{fact.kind}:{fact.id}"
        if key not in valid_fact_ids:
            return GateResult(
                verdict="rewrite",
                gate_num=2,
                reason_slug=f"ungrounded_fact:{fact.kind}:{fact.id}",
                passed_gates=passed,
            )
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

    # Gate 5a/5b — ungrounded factual question
    buyer_msg = _last_human_text(messages)
    if FACTUAL_Q_RE.search(buyer_msg) and not draft.facts_used:
        if revision_count == 0:
            return GateResult(
                verdict="revise",
                gate_num=5,
                reason_slug="ungrounded_factual_answer",
                critique=ManagerCritique(
                    missing_facts=[f"grounded data for: {buyer_msg[:80]}"],
                ),
                passed_gates=passed,
            )
        return GateResult(
            verdict="rewrite",
            gate_num=5,
            reason_slug="ungrounded_factual_answer_persists",
            passed_gates=passed,
        )
    passed.append("factual_q_grounded")

    return GateResult(verdict=None, passed_gates=passed)
