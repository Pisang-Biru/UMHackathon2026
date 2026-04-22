"""
Example: multi-step research agent with tool use.

Shows how to extend base.py with tools and conditional routing.
"""
from typing import Annotated, Literal
from typing_extensions import TypedDict
from langgraph.graph import StateGraph, START, END
from langgraph.graph.message import add_messages
from langgraph.prebuilt import ToolNode
from langchain_core.messages import BaseMessage
from langchain_core.tools import tool


@tool
def search(query: str) -> str:
    """Search for information. Replace with a real search implementation."""
    return f"[stub] Results for: {query}"


TOOLS = [search]


class ResearchState(TypedDict):
    messages: Annotated[list[BaseMessage], add_messages]


def _should_continue(state: ResearchState) -> Literal["tools", "__end__"]:
    last = state["messages"][-1]
    if hasattr(last, "tool_calls") and last.tool_calls:
        return "tools"
    return "__end__"


def build_research_agent(llm):
    """Agent that can call tools and loop until it has an answer."""
    llm_with_tools = llm.bind_tools(TOOLS)
    tool_node = ToolNode(TOOLS)

    def call_model(state: ResearchState) -> dict:
        return {"messages": [llm_with_tools.invoke(state["messages"])]}

    graph = StateGraph(ResearchState)
    graph.add_node("model", call_model)
    graph.add_node("tools", tool_node)

    graph.add_edge(START, "model")
    graph.add_conditional_edges("model", _should_continue)
    graph.add_edge("tools", "model")

    return graph.compile()
