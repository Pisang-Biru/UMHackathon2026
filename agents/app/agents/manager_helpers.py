# agents/app/agents/manager_helpers.py
import logging
from app.schemas.agent_io import IterationEntry

_log = logging.getLogger(__name__)


def _by_stage(state: dict) -> dict[str, IterationEntry]:
    return {e.stage: e for e in state.get("iterations", [])}


def pick_best_draft_for_human(state: dict) -> str:
    """
    Preference:
      1. manager_rewrite if all its facts are grounded
      2. jual_v2
      3. jual_v1
    """
    by_stage = _by_stage(state)
    valid_ids = state.get("valid_fact_ids", set())

    rewrite = by_stage.get("manager_rewrite")
    if rewrite and rewrite.draft:
        all_grounded = all(
            f"{f.kind}:{f.id}" in valid_ids for f in rewrite.draft.facts_used
        )
        if all_grounded:
            return rewrite.draft.reply

    for stage in ("jual_v2", "jual_v1", "marketing_v1"):
        entry = by_stage.get(stage)
        if entry and entry.draft:
            return entry.draft.reply

    _log.warning(
        "no_draft_for_escalation",
        extra={"iterations": [e.stage for e in state.get("iterations", [])]},
    )
    return ""


_SLUG_MAP = {
    "jual_self_flagged": "Refund, complaint, or sensitive issue — needs your call.",
    "jual_self_reported_gap": "Buyer asked something I couldn't answer.",
    "revise_failed_to_close_gaps": "Tried twice but couldn't cover everything the buyer asked.",
    "ungrounded_factual_answer": "Factual question I didn't have data to answer.",
    "ungrounded_factual_answer_persists": "Couldn't find data for this even after revising.",
    "rewrite_needs_human": "Needed help answering — please take a look.",
}


def humanize_reason(reason: str) -> str:
    if not reason.startswith("gate:"):
        return reason
    slug = reason[len("gate:"):]
    if slug in _SLUG_MAP:
        return _SLUG_MAP[slug]
    if slug.startswith("ungrounded_fact:"):
        return "Referenced something I couldn't verify — please double-check."
    _log.warning("unknown_gate_slug", extra={"slug": slug})
    return "Needs your review."


def build_escalation_summary(state: dict) -> str:
    iters = state.get("iterations", [])
    if not iters:
        return "Needs your review."
    last_entry = iters[-1]
    if last_entry.stage == "marketing_v1" and last_entry.draft and last_entry.draft.needs_human:
        return last_entry.draft.reply
    last_verdict = last_entry.verdict
    if last_verdict and last_verdict.verdict == "escalate":
        return humanize_reason(last_verdict.reason)
    # gates_only_check path after rewrite hallucinated
    return "Rewrite referenced a fact I couldn't verify — please review."


def resolve_final_reply(state: dict) -> str:
    resolved = state.get("final_reply")
    if not resolved:
        jd = state.get("jual_draft")
        if jd is not None:
            resolved = jd.reply
    if not resolved:
        iters = state.get("iterations", [])
        if iters and iters[-1].draft is not None:
            resolved = iters[-1].draft.reply
    if not resolved:
        _log.error(
            "finalize_no_reply",
            extra={"iterations": [e.stage for e in state.get("iterations", [])]},
        )
        raise RuntimeError("finalize reached without a resolvable reply")
    return resolved


def jual_v1_reply(state: dict) -> str:
    entry = _by_stage(state).get("jual_v1")
    return entry.draft.reply if entry and entry.draft else ""


def jual_v1_confidence(state: dict) -> float:
    entry = _by_stage(state).get("jual_v1")
    if entry and entry.draft:
        return entry.draft.confidence
    mkt = _by_stage(state).get("marketing_v1")
    if mkt and mkt.draft:
        return mkt.draft.confidence
    return 0.0
