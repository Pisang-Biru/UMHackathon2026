# agents/app/agents/manager.py
import logging
from typing import Literal, Annotated
from typing_extensions import TypedDict
from langgraph.graph import StateGraph, START, END
from langgraph.graph.message import add_messages
from langchain_core.messages import BaseMessage

from app.db import SessionLocal, Business, Product
from app.schemas.agent_io import (
    StructuredReply, ManagerCritique, IterationEntry,
)
from app.agents.customer_support import build_customer_support_agent
from app.agents.manager_evaluator import make_evaluate_node
from app.agents.manager_rewrite import make_manager_rewrite_node, gates_only_check
from app.agents.manager_terminal import make_finalize_node, make_queue_for_human_node

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
    return {
        "business_context": business_context,
        "memory_block": memory_block,
        "valid_fact_ids": valid_ids,
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
        result = await jual_graph.ainvoke(sub_state)
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
        return {
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
        result = await jual_graph.ainvoke(sub_state)
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
        return {
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

    graph = StateGraph(ManagerState)
    graph.add_node("load_shared_context", load_shared_context)
    graph.add_node("dispatch_jual", dispatch_jual)
    graph.add_node("dispatch_jual_revise", dispatch_jual_revise)
    graph.add_node("evaluate", evaluate)
    graph.add_node("manager_rewrite", manager_rewrite)
    graph.add_node("gates_only_check", gates_only_check)
    graph.add_node("finalize", finalize)
    graph.add_node("queue_for_human", queue_for_human)

    graph.add_edge(START, "load_shared_context")
    graph.add_edge("load_shared_context", "dispatch_jual")
    graph.add_edge("dispatch_jual", "evaluate")
    graph.add_conditional_edges("evaluate", route_verdict, {
        "finalize": "finalize",
        "dispatch_jual_revise": "dispatch_jual_revise",
        "manager_rewrite": "manager_rewrite",
        "queue_for_human": "queue_for_human",
    })
    graph.add_edge("dispatch_jual_revise", "evaluate")
    graph.add_edge("manager_rewrite", "gates_only_check")
    graph.add_conditional_edges("gates_only_check", route_gates_only, {
        "finalize": "finalize",
        "queue_for_human": "queue_for_human",
    })
    graph.add_edge("finalize", END)
    graph.add_edge("queue_for_human", END)
    return graph.compile()
