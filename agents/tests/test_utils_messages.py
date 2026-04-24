from langchain_core.messages import HumanMessage, AIMessage, SystemMessage
from app.utils.messages import last_buyer_text


def test_empty_list_returns_empty():
    assert last_buyer_text([]) == ""


def test_returns_last_human_message():
    msgs = [
        HumanMessage(content="first"),
        AIMessage(content="reply"),
        HumanMessage(content="second"),
    ]
    assert last_buyer_text(msgs) == "second"


def test_skips_trailing_ai_messages():
    msgs = [HumanMessage(content="ask"), AIMessage(content="answer")]
    assert last_buyer_text(msgs) == "ask"


def test_ignores_system_messages():
    msgs = [SystemMessage(content="sys"), HumanMessage(content="hi")]
    assert last_buyer_text(msgs) == "hi"


def test_no_human_returns_empty():
    msgs = [AIMessage(content="hi"), SystemMessage(content="sys")]
    assert last_buyer_text(msgs) == ""
