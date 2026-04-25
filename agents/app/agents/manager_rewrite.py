# agents/app/agents/manager_rewrite.py
import logging
import time
from langchain_core.messages import SystemMessage
from app.schemas.agent_io import StructuredReply, IterationEntry
from app.agents._json_utils import structured_or_repair
from app.agents.manager_gates import FACTUAL_Q_RE, _last_human_text

_log = logging.getLogger(__name__)


REWRITE_SYSTEM = (
    "You are Manager. Jual's draft could not be salvaged by a single revision. "
    "Rewrite the reply using ONLY the context below. You have no tools — work from the facts "
    "already established. Preserve any payment URLs verbatim if they appear in Jual's prior draft. "
    "Output the same StructuredReply JSON schema. Mark needs_human=true ONLY if you genuinely "
    "cannot produce a responsible reply from the available context.\n\n"
    "Grounding rule for facts_used: cite ONLY ids from the 'Allowed fact ids' whitelist below. "
    "If no listed id supports a claim, leave facts_used=[] — do NOT invent ids "
    "(e.g. business:<name>, product:<slug>). Conversational replies (greetings, identity "
    "confirmations from business context) need no facts_used entries."
)


def _format_valid_fact_ids(valid_fact_ids: set[str]) -> str:
    if not valid_fact_ids:
        return "(none — leave facts_used empty)"
    return ", ".join(sorted(valid_fact_ids))


def make_manager_rewrite_node(llm):
    async def manager_rewrite(state: dict) -> dict:
        jual_draft = state.get("jual_draft")
        prior_text = jual_draft.reply if jual_draft else ""
        t0 = time.monotonic()
        valid_ids_block = _format_valid_fact_ids(state.get("valid_fact_ids", set()))
        prompt = [
            SystemMessage(content=REWRITE_SYSTEM),
            SystemMessage(content=(
                f"Business context:\n{state.get('business_context','')}\n\n"
                f"Memory:\n{state.get('memory_block','')}\n\n"
                f"Allowed fact ids (whitelist for facts_used):\n{valid_ids_block}\n\n"
                f"Jual's draft (starting point):\n{prior_text}\n"
            )),
            *state.get("messages", []),
        ]
        result = await structured_or_repair(llm, prompt, StructuredReply)
        latency_ms = int((time.monotonic() - t0) * 1000)

        new_entry = IterationEntry(
            stage="manager_rewrite",
            draft=result,
            latency_ms=latency_ms,
        )
        _log.info("manager_rewrite_complete", extra={
            "latency_ms": latency_ms,
            "facts_used_count": len(result.facts_used),
        })
        return {
            "iterations": [*state["iterations"], new_entry],
            "final_reply": result.reply,
        }
    return manager_rewrite


async def gates_only_check(state: dict) -> dict:
    rewrite_entry = state["iterations"][-1]
    rewrite_draft = rewrite_entry.draft
    valid_ids = state.get("valid_fact_ids", set())
    buyer_msg = _last_human_text(state.get("messages", []))
    is_factual_q = bool(FACTUAL_Q_RE.search(buyer_msg))

    ungrounded = []
    for fact in rewrite_draft.facts_used:
        key = f"{fact.kind}:{fact.id}"
        if key in valid_ids:
            continue
        # Honor the negative-receipt wildcard the same way Gate 2 does.
        if (
            fact.id.startswith("none:")
            and f"{fact.kind}:none:*" in valid_ids
        ):
            continue
        ungrounded.append(fact)

    if ungrounded:
        if is_factual_q:
            fact = ungrounded[0]
            _log.info("gates_only_outcome", extra={
                "outcome": "escalate",
                "reason_slug": f"ungrounded_fact:{fact.kind}:{fact.id}",
            })
            return {"final_action_hint": "escalate", "final_reply": rewrite_draft.reply}
        # Conversational message — strip invented ids, keep reply.
        ungrounded_keys = {f"{f.kind}:{f.id}" for f in ungrounded}
        rewrite_draft.facts_used = [
            f for f in rewrite_draft.facts_used
            if f"{f.kind}:{f.id}" not in ungrounded_keys
        ]
        _log.info("gates_only_outcome", extra={
            "outcome": "auto_send",
            "stripped_ungrounded_facts": sorted(ungrounded_keys),
            "reason_slug": "non_factual_msg_strip_ids",
        })

    if rewrite_draft.needs_human:
        _log.info("gates_only_outcome", extra={"outcome": "escalate", "reason_slug": "rewrite_needs_human"})
        return {"final_action_hint": "escalate", "final_reply": rewrite_draft.reply}

    if not ungrounded:
        _log.info("gates_only_outcome", extra={"outcome": "auto_send"})
    return {"final_action_hint": "auto_send", "final_reply": rewrite_draft.reply}
