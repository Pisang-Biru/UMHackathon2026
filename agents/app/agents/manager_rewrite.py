# agents/app/agents/manager_rewrite.py
import logging
import time
from langchain_core.messages import SystemMessage
from app.schemas.agent_io import StructuredReply, IterationEntry

_log = logging.getLogger(__name__)


REWRITE_SYSTEM = (
    "You are Manager. Jual's draft could not be salvaged by a single revision. "
    "Rewrite the reply using ONLY the context below. You have no tools — work from the facts "
    "already established. Preserve any payment URLs verbatim if they appear in Jual's prior draft. "
    "Output the same StructuredReply JSON schema. Mark needs_human=true ONLY if you genuinely "
    "cannot produce a responsible reply from the available context."
)


def make_manager_rewrite_node(llm):
    async def manager_rewrite(state: dict) -> dict:
        jual_draft = state.get("jual_draft")
        prior_text = jual_draft.reply if jual_draft else ""
        t0 = time.monotonic()
        prompt = [
            SystemMessage(content=REWRITE_SYSTEM),
            SystemMessage(content=(
                f"Business context:\n{state.get('business_context','')}\n\n"
                f"Memory:\n{state.get('memory_block','')}\n\n"
                f"Jual's draft (starting point):\n{prior_text}\n"
            )),
            *state.get("messages", []),
        ]
        result = await llm.with_structured_output(StructuredReply).ainvoke(prompt)
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

    for fact in rewrite_draft.facts_used:
        key = f"{fact.kind}:{fact.id}"
        if key not in valid_ids:
            _log.info("gates_only_outcome", extra={
                "outcome": "escalate",
                "reason_slug": f"ungrounded_fact:{fact.kind}:{fact.id}",
            })
            return {"final_action_hint": "escalate", "final_reply": rewrite_draft.reply}

    if rewrite_draft.needs_human:
        _log.info("gates_only_outcome", extra={"outcome": "escalate", "reason_slug": "rewrite_needs_human"})
        return {"final_action_hint": "escalate", "final_reply": rewrite_draft.reply}

    _log.info("gates_only_outcome", extra={"outcome": "auto_send"})
    return {"final_action_hint": "auto_send", "final_reply": rewrite_draft.reply}
