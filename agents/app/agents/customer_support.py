import os
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


class StructuredReply(BaseModel):
    reply: str = Field(description="The reply to the buyer. If a payment link was generated, include the URL verbatim.")
    confidence: float = Field(ge=0.0, le=1.0, description="Confidence in this reply")
    reasoning: str = Field(description="One sentence explaining your confidence")


class SupportAgentState(TypedDict):
    messages: Annotated[list[BaseMessage], add_messages]
    business_context: str
    business_id: str
    customer_id: str
    draft_reply: str
    confidence: float
    reasoning: str
    action: Literal["auto_send", "queue_approval"]
    action_id: str


APP_URL = os.environ.get("APP_URL", "http://localhost:3000")


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
        tool_fn = _make_tool(state["business_id"])
        llm_with_tools = llm.bind_tools([tool_fn])
        system_prompt = SYSTEM_TEMPLATE.format(context=state["business_context"])

        history: list[BaseMessage] = [SystemMessage(content=system_prompt)] + list(state["messages"])

        for _ in range(3):
            response = await llm_with_tools.ainvoke(history)
            history.append(response)
            tool_calls = getattr(response, "tool_calls", None) or []
            if not tool_calls:
                break
            for call in tool_calls:
                result = tool_fn.invoke(call["args"])
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
        return {"action_id": action_id}

    graph = StateGraph(SupportAgentState)
    graph.add_node("load_context", load_context)
    graph.add_node("draft_reply", draft_reply)
    graph.add_node("route_decision", route_decision)
    graph.add_node("auto_send", auto_send)
    graph.add_node("queue_approval", queue_approval)

    graph.add_edge(START, "load_context")
    graph.add_edge("load_context", "draft_reply")
    graph.add_edge("draft_reply", "route_decision")
    graph.add_conditional_edges("route_decision", _route_edge, {
        "auto_send": "auto_send",
        "queue_approval": "queue_approval",
    })
    graph.add_edge("auto_send", END)
    graph.add_edge("queue_approval", END)

    return graph.compile()
