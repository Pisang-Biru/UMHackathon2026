import os
import json
import re
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
from sqlalchemy import update
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
from app.schemas.agent_io import StructuredReply, FactRef, ManagerCritique


class SupportAgentState(TypedDict, total=False):
    messages: Annotated[list[BaseMessage], add_messages]
    business_context: str
    business_id: str
    customer_id: str
    customer_phone: str
    memory_block: str
    draft_reply: str
    confidence: float
    reasoning: str
    structured_reply: StructuredReply | None
    revision_mode: Literal["draft", "redraft"]
    previous_draft: StructuredReply | None
    critique: ManagerCritique | None


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


def _create_order(business_id: str, product_id: str, qty: int, buyer_contact: str | None = None) -> tuple[str, str]:
    if qty <= 0:
        raise ValueError("qty must be positive")
    with SessionLocal() as session:
        product = session.query(Product).filter(
            Product.id == product_id,
            Product.businessId == business_id,
        ).first()
        if not product:
            raise ValueError(f"Product {product_id} not found for this business")
        unit_price = Decimal(product.price)

        rows = session.execute(
            update(Product)
            .where(
                Product.id == product_id,
                Product.businessId == business_id,
                Product.stock >= qty,
            )
            .values(stock=Product.stock - qty)
        ).rowcount
        if rows == 0:
            session.rollback()
            raise ValueError(f"Insufficient stock for {product.name}")

        order_id = generate_cuid()
        total = unit_price * Decimal(qty)
        payment_url = f"{APP_URL}/pay/{order_id}"
        order = Order(
            id=order_id,
            businessId=business_id,
            productId=product_id,
            agentType="support",
            qty=qty,
            unitPrice=unit_price,
            totalAmount=total,
            status=OrderStatus.PENDING_PAYMENT,
            buyerContact=buyer_contact or None,
            paymentUrl=payment_url,
        )
        session.add(order)
        session.commit()
        try:
            from app.worker.tasks import embed_product
            embed_product.delay(product_id)
        except Exception:
            pass
        return order_id, payment_url


SYSTEM_TEMPLATE = """\
You are a helpful customer support agent for a seller.

{context}

{memory_block}

Your job:
- Answer buyer questions accurately using ONLY the info above, plus what tools return
- Be friendly and concise
- Reply in the same language the buyer uses (Malay or English)
- If you are unsure about anything, say so honestly — never fabricate stock or prices

Purchase flow:
- If the buyer clearly wants to purchase a specific product and quantity, call the create_payment_link tool with the product id and quantity.
- After the tool returns a URL, include that URL verbatim in your reply.
- Never invent a payment URL.

Order status flow:
- If the buyer asks about past purchases, existing orders, or whether a payment succeeded, call check_order_status (no arguments — it knows the current buyer).
- Report what the tool returns. Do not guess.

After any tool calls, respond with valid JSON only, no other text:
{{
  "reply": "<your reply to the buyer (include payment URL when a link was generated)>",
  "confidence": <float 0.0-1.0>,
  "reasoning": "<one sentence explaining your confidence>",
  "addressed_questions": ["<buyer question you answered>", ...],
  "unaddressed_questions": ["<buyer question you did NOT answer, verbatim>", ...],
  "facts_used": [{{"kind": "product|order|kb|memory", "id": "<id>"}}, ...],
  "needs_human": <true only if refund / complaint / out-of-scope, else false>
}}

Rules for facts_used:
- If you call create_payment_link, add {{"kind":"product","id":"<product_id>"}}.
- If you call check_order_status, add {{"kind":"order","id":"<order_id>"}} for each order you reference.
- If you quote a product price or stock number, add that product's {{"kind":"product","id":"<id>"}}.

Confidence guide (for telemetry only, not routing):
- 0.9+   : Direct factual answer from product data or tool output
- 0.7-0.9: Reasonable inference
- <0.7   : Uncertain / info missing / sensitive topic
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


def _make_order_lookup_tool(business_id: str, customer_phone: str):
    @tool
    def check_order_status() -> str:
        """Look up the current buyer's recent orders and their payment status.

        Call this whenever the buyer asks about past purchases, current orders,
        or whether a payment succeeded. Takes no arguments — it already knows
        the current buyer. Never guess — always call this tool.

        Returns up to 5 orders, newest first, or "no orders found for this phone".
        """
        if not customer_phone:
            return "ERROR: no phone on file for this buyer"
        try:
            with SessionLocal() as session:
                rows = (
                    session.query(Order, Product.name)
                    .outerjoin(Product, Product.id == Order.productId)
                    .filter(
                        Order.businessId == business_id,
                        Order.buyerContact == customer_phone,
                    )
                    .order_by(Order.createdAt.desc())
                    .limit(5)
                    .all()
                )
            if not rows:
                return "no orders found for this phone"
            lines = []
            for order, product_name in rows:
                short_id = order.id[:10]
                created = order.createdAt.date().isoformat() if order.createdAt else "?"
                parts = [
                    f"#{short_id}",
                    f"{order.qty}x {product_name or order.productId}",
                    order.status.value,
                    f"created {created}",
                ]
                if order.status == OrderStatus.PAID and order.paidAt:
                    parts.append(f"paid {order.paidAt.date().isoformat()}")
                if order.status == OrderStatus.PENDING_PAYMENT:
                    pay_url = order.paymentUrl or f"{APP_URL}/pay/{order.id}"
                    parts.append(f"pay: {pay_url}")
                lines.append(" • ".join(parts))
            return "\n".join(lines)
        except Exception as e:
            return f"ERROR: {e}"
    return check_order_status


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


_JSON_FENCE_RE = re.compile(r"^```(?:json)?\s*|\s*```$", re.IGNORECASE)
_JSON_OBJECT_RE = re.compile(r"\{.*\}", re.DOTALL)


def _try_parse_json_reply(text: str):
    """Attempt to extract a StructuredReply from the model's text output.

    Some providers (e.g. Kimi via OpenRouter) emit tool calls as XML markup
    instead of OpenAI-compatible JSON, which breaks `with_structured_output`.
    But the prompt already instructs the model to emit a JSON object, and
    most models comply in the text content. Try that path first.

    Returns a StructuredReply on success, None on failure.
    """
    if not text or not text.strip():
        return None
    s = text.strip()
    # strip ```json ... ``` fences if present
    s = _JSON_FENCE_RE.sub("", s).strip()
    # grab first {...} block (handles stray prose around JSON)
    match = _JSON_OBJECT_RE.search(s)
    if not match:
        return None
    try:
        data = json.loads(match.group(0), strict=False)
        return StructuredReply.model_validate(data)
    except Exception:
        return None



def build_customer_support_agent(llm):
    async def load_context(state: SupportAgentState) -> dict:
        context = _build_context(state["business_id"])
        return {"business_context": context}

    def _make_tool(business_id: str, customer_phone: str):
        @tool
        def create_payment_link(product_id: str, qty: int) -> str:
            """Create a payment link for a buyer who wants to purchase a product.
            Args:
                product_id: the product id from the product list
                qty: quantity the buyer wants (positive integer)
            Returns a URL the buyer can open to pay, or an error message.
            """
            try:
                _order_id, payment_url = _create_order(
                    business_id, product_id, qty, buyer_contact=customer_phone or None
                )
                return payment_url
            except Exception as e:
                return f"ERROR: {e}"
        return create_payment_link

    async def draft_reply(state: SupportAgentState) -> dict:
        payment_tool = _make_tool(state["business_id"], state.get("customer_phone") or "")
        memory_tool = _make_search_memory_tool(state["business_id"])
        order_tool = _make_order_lookup_tool(state["business_id"], state.get("customer_phone") or "")
        llm_with_tools = llm.bind_tools([payment_tool, memory_tool, order_tool])
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
            tool_by_name = {
                payment_tool.name: payment_tool,
                memory_tool.name: memory_tool,
                order_tool.name: order_tool,
            }
            for call in tool_calls:
                chosen = tool_by_name.get(call["name"])
                if chosen is None:
                    history.append(ToolMessage(content=f"ERROR: unknown tool {call['name']}", tool_call_id=call["id"]))
                    continue
                result = chosen.invoke(call["args"])
                history.append(ToolMessage(content=str(result), tool_call_id=call["id"]))

        last = history[-1]
        last_text = last.content if isinstance(last.content, str) else ""

        direct = _try_parse_json_reply(last_text)
        if direct is not None:
            return {
                "structured_reply": direct,
                "draft_reply": direct.reply,
                "confidence": float(direct.confidence),
                "reasoning": direct.reasoning,
            }

        json_retry_instruction = SystemMessage(content=(
            "Produce the final reply as a single JSON object matching this schema:\n"
            '{"reply": "<text>", "confidence": <float>, "reasoning": "<sentence>", '
            '"addressed_questions": [...], "unaddressed_questions": [...], '
            '"facts_used": [{"kind":"product|order|kb|memory","id":"<id>"}], '
            '"needs_human": <bool>}\n'
            "Output ONLY the JSON object. No markdown fences, no prose before or after."
        ))
        try:
            response = await llm.ainvoke(history + [json_retry_instruction])
            retry_text = response.content if isinstance(response.content, str) else ""
            retry_parsed = _try_parse_json_reply(retry_text)
            if retry_parsed is not None:
                return {
                    "structured_reply": retry_parsed,
                    "draft_reply": retry_parsed.reply,
                    "confidence": float(retry_parsed.confidence),
                    "reasoning": retry_parsed.reasoning,
                }
        except Exception as e:
            _log.warning("JSON retry raised: %s", e)

        _log.warning("JSON parse failed twice; synthesizing needs_human draft")
        fallback = StructuredReply(
            reply="Sorry, I need someone to look at this properly. A human will reply shortly.",
            confidence=0.0,
            reasoning="JSON parsing failed twice",
            needs_human=True,
        )
        return {
            "structured_reply": fallback,
            "draft_reply": fallback.reply,
            "confidence": 0.0,
            "reasoning": fallback.reasoning,
        }

    async def redraft_reply(state: SupportAgentState) -> dict:
        prev = state.get("previous_draft")
        critique = state.get("critique")
        if prev is None or critique is None:
            raise ValueError("redraft_reply requires previous_draft and critique in state")

        system_prompt = SYSTEM_TEMPLATE.format(
            context=state.get("business_context", ""),
            memory_block=state.get("memory_block", ""),
        )
        revision_instruction = SystemMessage(content=(
            "You are revising your previous reply based on Manager feedback. "
            "Produce a corrected reply that addresses ALL of the following:\n\n"
            f"Previous reply:\n{prev.reply}\n\n"
            f"Missing facts to add: {critique.missing_facts}\n"
            f"Incorrect claims to remove/correct: {critique.incorrect_claims}\n"
            f"Tone issues to fix: {critique.tone_issues}\n"
            f"Questions still unanswered: {critique.unanswered_questions}\n"
            f"Keep from the previous draft: {critique.keep_from_draft}\n\n"
            "Respond with the same JSON schema as before. Emit JSON only."
        ))
        history = [SystemMessage(content=system_prompt), *state["messages"], revision_instruction]
        response = await llm.with_structured_output(StructuredReply).ainvoke(history)
        return {
            "structured_reply": response,
            "draft_reply": response.reply,
            "confidence": response.confidence,
            "reasoning": response.reasoning,
        }

    def _entry_route(state: SupportAgentState) -> Literal["load_context", "redraft_reply"]:
        return "redraft_reply" if state.get("revision_mode") == "redraft" else "load_context"

    graph = StateGraph(SupportAgentState)
    graph.add_node("load_context", load_context)
    graph.add_node("load_memory", _load_memory_node)
    graph.add_node("draft_reply", draft_reply)
    graph.add_node("redraft_reply", redraft_reply)

    graph.add_conditional_edges(START, _entry_route, {
        "load_context": "load_context",
        "redraft_reply": "redraft_reply",
    })
    graph.add_edge("load_context", "load_memory")
    graph.add_edge("load_memory", "draft_reply")
    graph.add_edge("draft_reply", END)
    graph.add_edge("redraft_reply", END)

    return graph.compile()
