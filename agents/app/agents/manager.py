# agents/app/agents/manager.py
import logging
from typing import Literal, Annotated
from typing_extensions import TypedDict
from langgraph.graph import StateGraph, START, END
from langgraph.graph.message import add_messages
from langchain_core.messages import BaseMessage

from app.db import SessionLocal, Business, Product, Order
from app.schemas.agent_io import (
    StructuredReply, ManagerCritique, IterationEntry,
)
from app.agents.customer_support import build_customer_support_agent
from app.agents.manager_evaluator import make_evaluate_node
from app.agents.manager_rewrite import make_manager_rewrite_node, gates_only_check
from app.agents.manager_terminal import make_finalize_node, make_queue_for_human_node
from app.agents._traced import traced
from app.events import emit

_log = logging.getLogger(__name__)

AGENT_META = {
    "id": "manager",
    "name": "Manager",
    "role": "Reviews and refines sales replies",
    "icon": "brain",
}


# NOTE: ManagerState is total=False so node return dicts don't need to
# repeat every key. Callers MUST still seed `business_id`, `messages`, and
# `iterations` when invoking the graph — nodes index them without fallback.
class ManagerState(TypedDict, total=False):
    messages: Annotated[list[BaseMessage], add_messages]
    business_id: str
    customer_id: str
    customer_phone: str
    business_context: str
    memory_block: str
    valid_fact_ids: set[str]
    preloaded_fact_ids: set[str]      # snapshot of pre-tool-call ids; never mutated after load
    last_harvested_msg_index: int     # cursor for harvest_receipts; init 0
    tool_calls_this_turn: int         # ToolMessages observed by last harvest; reset each turn
    jual_draft: StructuredReply | None
    verdict: Literal["pass", "revise", "rewrite", "escalate"] | None
    critique: ManagerCritique | None
    gate_results: dict | None
    revision_count: int
    iterations: list[IterationEntry]
    final_reply: str | None
    final_action: Literal["auto_send", "escalate"] | None
    final_action_hint: Literal["auto_send", "escalate"] | None
    action_id: str | None
    best_draft: str | None


async def _harvest_receipts_impl(state: dict) -> dict:
    """Read ToolMessage.artifact entries appended since last_harvested_msg_index;
    merge their (kind, id) tuples into valid_fact_ids. Idempotent via cursor.

    Plain @tool returns produce ToolMessage with artifact=None — harvest no-ops on
    those, allowing tools to migrate one at a time.

    Also counts ToolMessages in the new slice as `tool_calls_this_turn`. This
    lets Gate 5 distinguish "tool fired, returned empty" (negative answer is
    grounded) from "no tool fired" (truly ungrounded).
    """
    from langchain_core.messages import ToolMessage
    msgs = state.get("messages", []) or []
    start = state.get("last_harvested_msg_index", 0)
    new_ids = set(state.get("valid_fact_ids", set()))
    tool_calls = 0
    for msg in msgs[start:]:
        if not isinstance(msg, ToolMessage):
            continue
        tool_calls += 1
        for r in (getattr(msg, "artifact", None) or []):
            new_ids.add(f"{r.kind}:{r.id}")
    return {
        "valid_fact_ids": new_ids,
        "last_harvested_msg_index": len(msgs),
        "tool_calls_this_turn": tool_calls,
    }


def _load_shared_context_impl(state: dict) -> dict:
    """Loads business context, memory, valid_fact_ids. Module-level so tests can monkeypatch."""
    import os
    from app.memory import repo as memory_repo
    from app.memory.embedder import embed
    from app.memory.formatter import memory_block as format_memory_block

    business_id = state["business_id"]
    phone = state.get("customer_phone") or ""

    with SessionLocal() as session:
        business = session.query(Business).filter(Business.id == business_id).first()
        if not business:
            raise ValueError(f"Business {business_id} not found")
        products = session.query(Product).filter(Product.businessId == business_id).all()

        # Build business_context same shape as customer_support._build_context
        lines = [f"Business: {business.name}"]
        if business.mission:
            lines.append(f"About: {business.mission}")
        if products:
            lines.append("\nProducts available (use product id when creating payment links):")
            for p in products:
                stock_note = f"{p.stock} in stock" if p.stock > 0 else "OUT OF STOCK"
                desc = f" — {p.description}" if p.description else ""
                lines.append(f"- [{p.id}] {p.name}: RM{p.price:.2f}, {stock_note}{desc}")
        business_context = "\n".join(lines)

        memory_enabled = os.environ.get("MEMORY_ENABLED", "true").lower() == "true"
        memory_block = ""
        if memory_enabled and phone:
            recent = memory_repo.recent_turns(session, business_id, phone,
                                              limit=int(os.environ.get("MEMORY_RECENT_TURNS", "20")))
            latest = ""
            if state.get("messages"):
                last = state["messages"][-1]
                if isinstance(last.content, str):
                    latest = last.content
            summaries = []
            if latest:
                q_vec = embed([latest])[0]
                summaries = memory_repo.search_summaries(session, business_id, phone, q_vec, k=3, min_sim=0.5)
            memory_block = format_memory_block(phone=phone, recent_turns=recent, summaries=summaries)

    valid_ids = {f"product:{p.id}" for p in products}

    # Negative-receipt grounding for "no orders found".
    #
    # The Jual prompt teaches the model to cite `order:none:<phone>` on an
    # empty order lookup. Some LLMs answer the negative correctly but
    # either skip the tool call or self-redact phone digits in the output
    # (e.g., emit `none:+601********`). We can't enumerate every variant
    # in advance.
    #
    # Instead: at load time, do an authoritative DB lookup. If the buyer
    # has NO orders with this business, seed the sentinel
    # `order:none:*` — Gate 2 honors that to allow any `order:none:...`
    # citation pattern. If the buyer DOES have orders, we deliberately do
    # NOT seed, so Jual must cite real order ids. This bounds the trust
    # surface to "buyer has nothing to cite" cases.
    if phone:
        with SessionLocal() as session:
            existing = (
                session.query(Order.id)
                .filter(Order.businessId == business_id, Order.buyerContact == phone)
                .first()
            )
        if existing is None:
            valid_ids.add("order:none:*")

    return {
        "business_context": business_context,
        "memory_block": memory_block,
        "valid_fact_ids": valid_ids,
        "preloaded_fact_ids": set(valid_ids),  # frozen snapshot for Gate 5 "had retrieval?" check
        "last_harvested_msg_index": 0,
    }


def build_manager_graph(*, jual_llm, manager_llm):
    jual_graph = build_customer_support_agent(jual_llm)

    async def load_shared_context(state: ManagerState) -> dict:
        _log.info("manager_turn_start", extra={
            "business_id": state.get("business_id"),
            "customer_phone": state.get("customer_phone"),
        })
        loaded = _load_shared_context_impl(state)
        loaded["revision_count"] = state.get("revision_count", 0)
        loaded["iterations"] = state.get("iterations", []) or []
        return loaded

    async def dispatch_jual(state: ManagerState) -> dict:
        sub_state = {
            "messages": state["messages"],
            "business_id": state["business_id"],
            "customer_id": state.get("customer_id", ""),
            "customer_phone": state.get("customer_phone", ""),
            "business_context": state["business_context"],
            "memory_block": state["memory_block"],
            "draft_reply": "",
            "confidence": 0.0,
            "reasoning": "",
            "revision_mode": "draft",
        }
        try:
            emit(
                agent_id="manager",
                kind="handoff",
                business_id=state.get("business_id"),
                conversation_id=state.get("customer_id"),
                summary="manager → customer_support (draft request)",
            )
        except Exception:
            pass
        result = await jual_graph.ainvoke(sub_state)
        try:
            emit(
                agent_id="customer_support",
                kind="handoff",
                business_id=state.get("business_id"),
                conversation_id=state.get("customer_id"),
                summary="customer_support → manager (draft returned)",
            )
        except Exception:
            pass
        draft = result.get("structured_reply") or StructuredReply(
            reply=result.get("draft_reply", ""),
            confidence=result.get("confidence", 0.0),
            reasoning=result.get("reasoning", ""),
        )
        new_entry = IterationEntry(stage="jual_v1", draft=draft)
        _log.info("jual_draft_complete", extra={
            "stage": "jual_v1",
            "unaddressed_count": len(draft.unaddressed_questions),
            "facts_used_count": len(draft.facts_used),
            "needs_human": draft.needs_human,
        })
        sub_msgs = result.get("messages", []) or []
        new_msgs = sub_msgs[len(state["messages"]):]
        return {
            "messages": new_msgs,
            "jual_draft": draft,
            "iterations": [*state["iterations"], new_entry],
        }

    async def dispatch_jual_revise(state: ManagerState) -> dict:
        sub_state = {
            "messages": state["messages"],
            "business_id": state["business_id"],
            "customer_id": state.get("customer_id", ""),
            "customer_phone": state.get("customer_phone", ""),
            "business_context": state["business_context"],
            "memory_block": state["memory_block"],
            "draft_reply": "",
            "confidence": 0.0,
            "reasoning": "",
            "revision_mode": "redraft",
            "previous_draft": state["jual_draft"],
            "critique": state["critique"],
        }
        try:
            emit(
                agent_id="manager",
                kind="handoff",
                business_id=state.get("business_id"),
                conversation_id=state.get("customer_id"),
                summary="manager → customer_support (draft request)",
            )
        except Exception:
            pass
        result = await jual_graph.ainvoke(sub_state)
        try:
            emit(
                agent_id="customer_support",
                kind="handoff",
                business_id=state.get("business_id"),
                conversation_id=state.get("customer_id"),
                summary="customer_support → manager (draft returned)",
            )
        except Exception:
            pass
        draft = result.get("structured_reply") or StructuredReply(
            reply=result.get("draft_reply", ""),
            confidence=result.get("confidence", 0.0),
            reasoning=result.get("reasoning", ""),
        )
        new_entry = IterationEntry(stage="jual_v2", draft=draft)
        _log.info("jual_draft_complete", extra={
            "stage": "jual_v2",
            "unaddressed_count": len(draft.unaddressed_questions),
            "facts_used_count": len(draft.facts_used),
            "needs_human": draft.needs_human,
        })
        sub_msgs = result.get("messages", []) or []
        new_msgs = sub_msgs[len(state["messages"]):]
        return {
            "messages": new_msgs,
            "jual_draft": draft,
            "revision_count": state.get("revision_count", 0) + 1,
            "iterations": [*state["iterations"], new_entry],
        }

    evaluate = make_evaluate_node(manager_llm)
    manager_rewrite = make_manager_rewrite_node(manager_llm)
    finalize = make_finalize_node()
    queue_for_human = make_queue_for_human_node()

    def route_verdict(state: ManagerState) -> Literal[
        "finalize", "dispatch_jual_revise", "manager_rewrite", "queue_for_human",
    ]:
        v = state.get("verdict")
        if v == "pass":
            return "finalize"
        if v == "revise":
            if state.get("revision_count", 0) >= 1:
                return "manager_rewrite"
            return "dispatch_jual_revise"
        if v == "rewrite":
            return "manager_rewrite"
        return "queue_for_human"

    def route_gates_only(state: ManagerState) -> Literal["finalize", "queue_for_human"]:
        return "finalize" if state.get("final_action_hint") == "auto_send" else "queue_for_human"

    async def _finalize_with_emit(state):
        out = await finalize(state)
        try:
            emit(
                agent_id="manager",
                kind="handoff",
                business_id=state.get("business_id"),
                conversation_id=state.get("customer_id"),
                task_id=(out or {}).get("action_id") or state.get("action_id"),
                status="ok",
                summary="auto-sent reply",
            )
        except Exception:
            pass
        return out

    async def _queue_with_emit(state):
        out = await queue_for_human(state)
        try:
            emit(
                agent_id="manager",
                kind="handoff",
                business_id=state.get("business_id"),
                conversation_id=state.get("customer_id"),
                task_id=(out or {}).get("action_id") or state.get("action_id"),
                status="escalate",
                summary="escalated to human inbox",
                reasoning=(out or {}).get("escalation_summary") or state.get("escalation_summary"),
            )
        except Exception:
            pass
        return out

    _t = lambda n: lambda fn: traced(agent_id="manager", node=n)(fn)

    graph = StateGraph(ManagerState)
    graph.add_node("load_shared_context", _t("load_shared_context")(load_shared_context))
    graph.add_node("dispatch_jual", _t("dispatch_jual")(dispatch_jual))
    graph.add_node("dispatch_jual_revise", _t("dispatch_jual_revise")(dispatch_jual_revise))
    graph.add_node("harvest_receipts", _t("harvest_receipts")(_harvest_receipts_impl))
    graph.add_node("evaluate", _t("evaluate")(evaluate))
    graph.add_node("manager_rewrite", _t("manager_rewrite")(manager_rewrite))
    graph.add_node("gates_only_check", _t("gates_only_check")(gates_only_check))
    graph.add_node("finalize", _t("finalize")(_finalize_with_emit))
    graph.add_node("queue_for_human", _t("queue_for_human")(_queue_with_emit))

    graph.add_edge(START, "load_shared_context")
    graph.add_edge("load_shared_context", "dispatch_jual")
    graph.add_edge("dispatch_jual", "harvest_receipts")
    graph.add_edge("harvest_receipts", "evaluate")
    graph.add_conditional_edges("evaluate", route_verdict, {
        "finalize": "finalize",
        "dispatch_jual_revise": "dispatch_jual_revise",
        "manager_rewrite": "manager_rewrite",
        "queue_for_human": "queue_for_human",
    })
    graph.add_edge("dispatch_jual_revise", "harvest_receipts")
    graph.add_edge("manager_rewrite", "gates_only_check")
    graph.add_conditional_edges("gates_only_check", route_gates_only, {
        "finalize": "finalize",
        "queue_for_human": "queue_for_human",
    })
    graph.add_edge("finalize", END)
    graph.add_edge("queue_for_human", END)
    return graph.compile()
