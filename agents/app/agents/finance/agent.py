import logging
from typing import Annotated, Literal
from typing_extensions import TypedDict

from langgraph.graph import StateGraph, START, END
from langgraph.graph.message import add_messages
from langchain_core.messages import BaseMessage, SystemMessage
from langchain_core.tools import BaseTool

from app.agents.finance.tools import (
    get_product_costs, get_order_margin,
    list_loss_orders, list_missing_data_products,
    product_margin_summary, top_losers,
)

log = logging.getLogger(__name__)

AGENT_META = {
    "id": "finance",
    "name": "Finance Assistant",
    "role": "Margin analysis, loss alerts, sales costs Q&A",
    "icon": "calculator",
}


class FinanceState(TypedDict, total=False):
    messages: Annotated[list[BaseMessage], add_messages]
    business_id: str
    final_reply: str
    confidence: float
    reasoning: str


_SYSTEM = (
    "You are the Finance Assistant for a small business owner. "
    "Answer questions about real margin, losses, and missing cost data. "
    "Always use the provided tools to ground numbers — never guess. "
    "If the user asks to set or update cost values, reply with: "
    "\"Open the product page to edit cogs / packaging, or business settings to "
    "edit platform fee and default shipping.\" Do not attempt writes. "
    "When responding, include a confidence score in [0,1] and short reasoning."
)


def _tools() -> list[BaseTool]:
    return [
        get_product_costs, get_order_margin,
        list_loss_orders, list_missing_data_products,
        product_margin_summary, top_losers,
    ]


def build_finance_agent(llm):
    tools = _tools()
    llm_with_tools = llm.bind_tools(tools)
    tools_by_name = {t.name: t for t in tools}

    def call_model(state: FinanceState) -> dict:
        msgs = [SystemMessage(content=_SYSTEM), *state["messages"]]
        ai = llm_with_tools.invoke(msgs)
        return {"messages": [ai]}

    def call_tool(state: FinanceState) -> dict:
        from langchain_core.messages import ToolMessage
        last = state["messages"][-1]
        out: list[BaseMessage] = []
        for tc in getattr(last, "tool_calls", []) or []:
            t = tools_by_name[tc["name"]]
            try:
                result = t.invoke(tc["args"])
            except Exception as e:
                result = {"error": str(e)}
            out.append(ToolMessage(content=str(result), tool_call_id=tc["id"]))
        return {"messages": out}

    def route(state: FinanceState) -> Literal["tool", "end"]:
        last = state["messages"][-1]
        if getattr(last, "tool_calls", None):
            return "tool"
        return "end"

    g = StateGraph(FinanceState)
    g.add_node("model", call_model)
    g.add_node("tool", call_tool)
    g.add_edge(START, "model")
    g.add_conditional_edges("model", route, {"tool": "tool", "end": END})
    g.add_edge("tool", "model")
    return g.compile()
