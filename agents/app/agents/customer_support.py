import os
import logging
from cuid2 import Cuid as _Cuid
generate_cuid = _Cuid().generate
from decimal import Decimal
from typing import Annotated, Literal
from typing_extensions import TypedDict
from pydantic import BaseModel, Field
from langgraph.graph import StateGraph, START, END
from langgraph.graph.message import add_messages
from langchain_core.messages import BaseMessage, SystemMessage, ToolMessage
from langchain_core.tools import tool
from app.db import (
    SessionLocal,
    Business,
    Product,
    AgentAction,
    AgentActionStatus,
    Order,
    OrderStatus,
)
from app.memory import repo as memory_repo
from app.memory.embedder import embed
from app.memory.formatter import memory_block as format_memory_block
from app.memory.formatter import format_search_results
from typing import Literal as _Lit


class StructuredReply(BaseModel):
    reply: str = Field(description="The reply to the buyer. If a payment link was generated, include the URL verbatim.")
    confidence: float = Field(ge=0.0, le=1.0, description="Confidence in this reply")
    reasoning: str = Field(description="One sentence explaining your confidence")


class SupportAgentState(TypedDict):
    messages: Annotated[list[BaseMessage], add_messages]
    business_context: str
    business_id: str
    customer_id: str
    customer_phone: str
    memory_block: str
    draft_reply: str
    confidence: float
    reasoning: str
    action: Literal["auto_send", "queue_approval"]
    action_id: str


APP_URL = os.environ.get("APP_URL", "http://localhost:3000")

_log = logging.getLogger(__name__)


def _enqueue_turn_write(*, business_id, customer_phone, buyer_msg, agent_reply, action_id):
    """Wrapped so tests can monkeypatch without importing Celery."""
    if os.environ.get("MEMORY_ENABLED", "true").lower() != "true":
        return
    try:
        from app.worker.tasks import embed_and_store_turn, embed_past_action
        embed_and_store_turn.delay(
            business_id=business_id,
            customer_phone=customer_phone,
            buyer_msg=buyer_msg,
            agent_reply=agent_reply,
            action_id=action_id,
        )
        embed_past_action.delay(action_id)
    except Exception as e:
        _log.warning("memory enqueue failed: %s", e)


def _enqueue_from_state(state, action_id: str):
    phone = state.get("customer_phone") or ""
    if not phone:
        return
    msg = ""
    if state.get("messages"):
        last = state["messages"][-1]
        if isinstance(last.content, str):
            msg = last.content
    reply = state.get("draft_reply") or ""
    _enqueue_turn_write(
        business_id=state["business_id"],
        customer_phone=phone,
        buyer_msg=msg,
        agent_reply=reply,
        action_id=action_id,
    )


def _build_context(business_id: str) -> str:
    with SessionLocal() as session:
        business = session.query(Business).filter(Business.id == business_id).first()
        if not business:
            raise ValueError(f"Business {business_id} not found")
        products = session.query(Product).filter(Product.businessId == business_id).all()

    lines = [f"Business: {business.name}"]
    if business.mission:
        lines.append(f"About: {business.mission}")

    if products:
        lines.append("\nProducts available (use product id when creating payment links):")
        for p in products:
            stock_note = f"{p.stock} in stock" if p.stock > 0 else "OUT OF STOCK"
            desc = f" — {p.description}" if p.description else ""
            lines.append(f"- [{p.id}] {p.name}: RM{p.price:.2f}, {stock_note}{desc}")
    else:
        lines.append("\nNo products listed yet.")

    return "\n".join(lines)


def _create_order(business_id: str, product_id: str, qty: int) -> str:
    with SessionLocal() as session:
        product = session.query(Product).filter(
            Product.id == product_id,
            Product.businessId == business_id,
        ).first()
        if not product:
            raise ValueError(f"Product {product_id} not found for this business")
        if qty <= 0:
            raise ValueError("qty must be positive")
        if product.stock < qty:
            raise ValueError(f"Only {product.stock} in stock")
        order_id = generate_cuid()
        unit_price = Decimal(product.price)
        total = unit_price * Decimal(qty)
        order = Order(
            id=order_id,
            businessId=business_id,
            productId=product_id,
            agentType="support",
            qty=qty,
            unitPrice=unit_price,
            totalAmount=total,
            status=OrderStatus.PENDING_PAYMENT,
        )
        session.add(order)
        session.commit()
        return order_id


SYSTEM_TEMPLATE = """\
You are a helpful customer support agent for a seller.

{context}

{memory_block}

Your job:
- Answer buyer questions accurately using ONLY the info above
- Be friendly and concise
- Reply in the same language the buyer uses (Malay or English)
- If you are unsure about anything, say so honestly — never fabricate stock or prices

Purchase flow:
- If the buyer clearly wants to purchase a specific product and quantity, call the create_payment_link tool with the product id and quantity.
- After the tool returns a URL, include that URL verbatim in your reply.
- Never invent a payment URL.

After any tool calls, you MUST respond with valid JSON only, no other text:
{{
  "reply": "<your reply to the buyer (include payment URL when a link was generated)>",
  "confidence": <float between 0.0 and 1.0>,
  "reasoning": "<one sentence explaining your confidence>"
}}

Confidence guide:
- 0.9+   : Direct factual answer from product data above, or confirmed payment link
- 0.7-0.9: Reasonable inference from available info
- <0.7   : Uncertain, info missing, or sensitive topic (complaints, refunds, shipping)
"""


async def _load_memory_node(state: SupportAgentState) -> dict:
    if os.environ.get("MEMORY_ENABLED", "true").lower() != "true":
        return {"memory_block": ""}
    phone = state.get("customer_phone") or ""
    business_id = state["business_id"]

    if not phone:
        return {"memory_block": format_memory_block(phone=None, recent_turns=[], summaries=[])}

    latest = ""
    if state["messages"]:
        last = state["messages"][-1]
        if isinstance(last.content, str):
            latest = last.content

    with SessionLocal() as session:
        recent = memory_repo.recent_turns(session, business_id, phone,
                                           limit=int(os.environ.get("MEMORY_RECENT_TURNS", "20")))
        summaries = []
        if latest:
            q_vec = embed([latest])[0]
            summaries = memory_repo.search_summaries(session, business_id, phone, q_vec, k=3, min_sim=0.5)

    block = format_memory_block(phone=phone, recent_turns=recent, summaries=summaries)
    return {"memory_block": block}


def _make_search_memory_tool(business_id: str):
    @tool
    def search_memory(query: str, kind: _Lit["kb", "product", "past_action"]) -> str:
        """Search business memory for context outside of the live conversation.
        Args:
            query: what to search for (buyer's phrasing or a paraphrase)
            kind: "kb" (FAQ/policy docs), "product" (fuzzy product match), or "past_action" (similar past buyer messages)
        Returns a numbered list of top matches with similarity scores, or "No results".
        """
        q_vec = embed([query])[0]
        with SessionLocal() as session:
            if kind == "kb":
                hits = memory_repo.search_kb(session, business_id, q_vec, k=5, min_sim=0.6)
            elif kind == "product":
                hits = memory_repo.search_products(session, business_id, q_vec, k=5, min_sim=0.5)
            else:
                hits = memory_repo.search_past_actions(session, business_id, q_vec, k=3, min_sim=0.7)
        return format_search_results(kind, hits)
    return search_memory


def build_customer_support_agent(llm):
    async def load_context(state: SupportAgentState) -> dict:
        context = _build_context(state["business_id"])
        return {"business_context": context}

    def _make_tool(business_id: str):
        @tool
        def create_payment_link(product_id: str, qty: int) -> str:
            """Create a payment link for a buyer who wants to purchase a product.
            Args:
                product_id: the product id from the product list
                qty: quantity the buyer wants (positive integer)
            Returns a URL the buyer can open to pay, or an error message.
            """
            try:
                order_id = _create_order(business_id, product_id, qty)
                return f"{APP_URL}/pay/{order_id}"
            except Exception as e:
                return f"ERROR: {e}"
        return create_payment_link

    async def draft_reply(state: SupportAgentState) -> dict:
        payment_tool = _make_tool(state["business_id"])
        memory_tool = _make_search_memory_tool(state["business_id"])
        llm_with_tools = llm.bind_tools([payment_tool, memory_tool])
        system_prompt = SYSTEM_TEMPLATE.format(
            context=state["business_context"],
            memory_block=state.get("memory_block", ""),
        )

        history: list[BaseMessage] = [SystemMessage(content=system_prompt)] + list(state["messages"])

        for _ in range(3):
            response = await llm_with_tools.ainvoke(history)
            history.append(response)
            tool_calls = getattr(response, "tool_calls", None) or []
            if not tool_calls:
                break
            tool_by_name = {payment_tool.name: payment_tool, memory_tool.name: memory_tool}
            for call in tool_calls:
                chosen = tool_by_name.get(call["name"])
                if chosen is None:
                    history.append(ToolMessage(content=f"ERROR: unknown tool {call['name']}", tool_call_id=call["id"]))
                    continue
                result = chosen.invoke(call["args"])
                history.append(ToolMessage(content=str(result), tool_call_id=call["id"]))

        structured_llm = llm.with_structured_output(StructuredReply)
        final_instruction = SystemMessage(content=(
            "Now produce the final reply to the buyer as JSON matching the schema. "
            "If a payment link was created above, include the URL verbatim in the reply field."
        ))
        try:
            parsed: StructuredReply = await structured_llm.ainvoke(history + [final_instruction])
            return {
                "draft_reply": parsed.reply,
                "confidence": float(parsed.confidence),
                "reasoning": parsed.reasoning,
            }
        except Exception as e:
            fallback_text = ""
            last = history[-1]
            if isinstance(last.content, str):
                fallback_text = last.content
            return {
                "draft_reply": fallback_text,
                "confidence": 0.5,
                "reasoning": f"Structured output failed: {e}",
            }

    async def route_decision(state: SupportAgentState) -> dict:
        action = "auto_send" if state["confidence"] >= 0.8 else "queue_approval"
        return {"action": action}

    def _route_edge(state: SupportAgentState) -> Literal["auto_send", "queue_approval"]:
        return state["action"]

    async def auto_send(state: SupportAgentState) -> dict:
        customer_msg = state["messages"][-1].content if state["messages"] else ""
        action_id = generate_cuid()
        with SessionLocal() as session:
            record = AgentAction(
                id=action_id,
                businessId=state["business_id"],
                customerMsg=customer_msg,
                draftReply=state["draft_reply"],
                finalReply=state["draft_reply"],
                confidence=state["confidence"],
                reasoning=state["reasoning"],
                status=AgentActionStatus.AUTO_SENT,
            )
            session.add(record)
            session.commit()
        _enqueue_from_state(state, action_id=action_id)
        return {"action_id": action_id}

    async def queue_approval(state: SupportAgentState) -> dict:
        customer_msg = state["messages"][-1].content if state["messages"] else ""
        action_id = generate_cuid()
        with SessionLocal() as session:
            record = AgentAction(
                id=action_id,
                businessId=state["business_id"],
                customerMsg=customer_msg,
                draftReply=state["draft_reply"],
                confidence=state["confidence"],
                reasoning=state["reasoning"],
                status=AgentActionStatus.PENDING,
            )
            session.add(record)
            session.commit()
        _enqueue_from_state(state, action_id=action_id)
        return {"action_id": action_id}

    graph = StateGraph(SupportAgentState)
    graph.add_node("load_context", load_context)
    graph.add_node("draft_reply", draft_reply)
    graph.add_node("route_decision", route_decision)
    graph.add_node("auto_send", auto_send)
    graph.add_node("queue_approval", queue_approval)

    graph.add_node("load_memory", _load_memory_node)
    graph.add_edge(START, "load_context")
    graph.add_edge("load_context", "load_memory")
    graph.add_edge("load_memory", "draft_reply")
    graph.add_edge("draft_reply", "route_decision")
    graph.add_conditional_edges("route_decision", _route_edge, {
        "auto_send": "auto_send",
        "queue_approval": "queue_approval",
    })
    graph.add_edge("auto_send", END)
    graph.add_edge("queue_approval", END)

    return graph.compile()
