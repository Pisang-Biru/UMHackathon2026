import json
import cuid2
from typing import Annotated, Literal
from typing_extensions import TypedDict
from langgraph.graph import StateGraph, START, END
from langgraph.graph.message import add_messages
from langchain_core.messages import BaseMessage, SystemMessage
from app.db import SessionLocal, Business, Product, AgentAction, AgentActionStatus


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
        lines.append("\nProducts available:")
        for p in products:
            stock_note = f"{p.stock} in stock" if p.stock > 0 else "OUT OF STOCK"
            desc = f" — {p.description}" if p.description else ""
            lines.append(f"- {p.name}: RM{p.price:.2f}, {stock_note}{desc}")
    else:
        lines.append("\nNo products listed yet.")

    return "\n".join(lines)


SYSTEM_TEMPLATE = """\
You are a helpful customer support agent for a seller.

{context}

Your job:
- Answer buyer questions accurately using ONLY the info above
- Be friendly and concise
- Reply in the same language the buyer uses (Malay or English)
- If you are unsure about anything, say so honestly — never fabricate stock or prices

You MUST respond with valid JSON only, no other text:
{{
  "reply": "<your reply to the buyer>",
  "confidence": <float between 0.0 and 1.0>,
  "reasoning": "<one sentence explaining your confidence>"
}}

Confidence guide:
- 0.9+   : Direct factual answer from product data above
- 0.7-0.9: Reasonable inference from available info
- <0.7   : Uncertain, info missing, or sensitive topic (complaints, refunds, shipping)
"""


def build_customer_support_agent(llm):
    def load_context(state: SupportAgentState) -> dict:
        context = _build_context(state["business_id"])
        return {"business_context": context}

    def draft_reply(state: SupportAgentState) -> dict:
        system_prompt = SYSTEM_TEMPLATE.format(context=state["business_context"])
        messages = [SystemMessage(content=system_prompt)] + list(state["messages"])
        response = llm.invoke(messages)

        content = response.content.strip()
        if content.startswith("```"):
            content = content.split("```")[1]
            if content.startswith("json"):
                content = content[4:]
            content = content.strip()

        try:
            parsed = json.loads(content)
            return {
                "draft_reply": parsed["reply"],
                "confidence": float(parsed["confidence"]),
                "reasoning": parsed.get("reasoning", ""),
            }
        except (json.JSONDecodeError, KeyError):
            return {
                "draft_reply": content,
                "confidence": 0.5,
                "reasoning": "Failed to parse structured output",
            }

    def route_decision(state: SupportAgentState) -> dict:
        action = "auto_send" if state["confidence"] >= 0.8 else "queue_approval"
        return {"action": action}

    def _route_edge(state: SupportAgentState) -> Literal["auto_send", "queue_approval"]:
        return state["action"]

    def auto_send(state: SupportAgentState) -> dict:
        customer_msg = state["messages"][-1].content if state["messages"] else ""
        action_id = cuid2.cuid()
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

    def queue_approval(state: SupportAgentState) -> dict:
        customer_msg = state["messages"][-1].content if state["messages"] else ""
        action_id = cuid2.cuid()
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
