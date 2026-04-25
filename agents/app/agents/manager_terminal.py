# agents/app/agents/manager_terminal.py
import logging
import os
from cuid2 import Cuid as _Cuid
from app.db import SessionLocal, AgentAction, AgentActionStatus
from app.utils.messages import last_buyer_text
from app.agents.manager_helpers import (
    resolve_final_reply, pick_best_draft_for_human, build_escalation_summary,
    jual_v1_reply, jual_v1_confidence,
)
from app.agents._runs import record_run

_log = logging.getLogger(__name__)
_gen_cuid = _Cuid().generate


def _enqueue_memory_write(state: dict, action_id: str, final_reply: str):
    """Wrapped so tests can monkeypatch without importing Celery."""
    if os.environ.get("MEMORY_ENABLED", "true").lower() != "true":
        return
    phone = state.get("customer_phone") or ""
    if not phone:
        return
    try:
        from app.worker.tasks import embed_and_store_turn, embed_past_action
        buyer_msg = last_buyer_text(state.get("messages", []))
        embed_and_store_turn.delay(
            business_id=state["business_id"],
            customer_phone=phone,
            buyer_msg=buyer_msg,
            agent_reply=final_reply,
            action_id=action_id,
        )
        embed_past_action.delay(action_id)
    except Exception as e:
        _log.warning("memory enqueue failed: %s", e)


def _iterations_to_jsonb(iterations):
    return [e.model_dump(mode="json") for e in iterations]


def make_finalize_node():
    async def finalize(state: dict) -> dict:
        final_reply = resolve_final_reply(state)
        action_id = _gen_cuid()
        last_verdict = state["iterations"][-1].verdict
        business_id = state["business_id"]
        customer_msg = last_buyer_text(state.get("messages", []))
        confidence = jual_v1_confidence(state)
        with SessionLocal() as session:
            record = AgentAction(
                id=action_id,
                businessId=business_id,
                customerMsg=customer_msg,
                draftReply=jual_v1_reply(state) or final_reply,
                finalReply=final_reply,
                confidence=confidence,
                reasoning=last_verdict.reason if last_verdict else "",
                status=AgentActionStatus.AUTO_SENT,
                iterations=_iterations_to_jsonb(state["iterations"]),
            )
            session.add(record)
            session.commit()
        record_run(
            business_id=business_id,
            agent_type="customer_support",
            kind="handle_message",
            summary=(customer_msg or "")[:200],
            status="OK",
            payload={"confidence": confidence},
            ref=("agent_action", action_id),
        )
        record_run(
            business_id=business_id,
            agent_type="manager",
            kind="evaluate",
            summary=f"manager evaluation ({len(state['iterations'])} iter)",
            status="OK",
            payload={
                "iterations": len(state["iterations"]),
                "final_action": "auto_send",
            },
            ref=("agent_action_manager", action_id),
        )
        _enqueue_memory_write(state, action_id, final_reply)
        _log.info("manager_turn_terminal", extra={
            "action_id": action_id, "final_action": "auto_send",
            "iteration_count": len(state["iterations"]),
        })
        return {"final_action": "auto_send", "action_id": action_id}
    return finalize


def make_queue_for_human_node():
    async def queue_for_human(state: dict) -> dict:
        action_id = _gen_cuid()
        best_draft = pick_best_draft_for_human(state)
        escalation_summary = build_escalation_summary(state)
        business_id = state["business_id"]
        customer_msg = last_buyer_text(state.get("messages", []))
        confidence = jual_v1_confidence(state)
        with SessionLocal() as session:
            record = AgentAction(
                id=action_id,
                businessId=business_id,
                customerMsg=customer_msg,
                draftReply=jual_v1_reply(state) or best_draft,
                finalReply=None,
                confidence=confidence,
                reasoning=escalation_summary,
                status=AgentActionStatus.PENDING,
                iterations=_iterations_to_jsonb(state["iterations"]),
            )
            session.add(record)
            session.commit()
        record_run(
            business_id=business_id,
            agent_type="customer_support",
            kind="handle_message",
            summary=(customer_msg or "")[:200],
            status="OK",
            payload={"confidence": confidence},
            ref=("agent_action", action_id),
        )
        record_run(
            business_id=business_id,
            agent_type="manager",
            kind="evaluate",
            summary=f"manager evaluation ({len(state['iterations'])} iter)",
            status="OK",
            payload={
                "iterations": len(state["iterations"]),
                "final_action": "escalate",
            },
            ref=("agent_action_manager", action_id),
        )
        _log.info("manager_turn_terminal", extra={
            "action_id": action_id, "final_action": "escalate",
            "iteration_count": len(state["iterations"]),
        })
        return {"final_action": "escalate", "action_id": action_id, "best_draft": best_draft}
    return queue_for_human
