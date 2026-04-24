from langchain_core.messages import BaseMessage, HumanMessage


def last_buyer_text(messages: list[BaseMessage]) -> str:
    if not messages:
        return ""
    for msg in reversed(messages):
        if isinstance(msg, HumanMessage) and isinstance(msg.content, str):
            return msg.content
    return ""
