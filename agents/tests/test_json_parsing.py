from app.agents.customer_support import _try_parse_json_reply


def test_parses_plain_json():
    text = '{"reply": "hi", "confidence": 0.9, "reasoning": "direct"}'
    result = _try_parse_json_reply(text)
    assert result is not None
    assert result.reply == "hi"
    assert result.confidence == 0.9


def test_parses_fenced_json():
    text = '```json\n{"reply": "hi", "confidence": 0.9, "reasoning": "ok"}\n```'
    result = _try_parse_json_reply(text)
    assert result is not None
    assert result.reply == "hi"


def test_parses_json_with_raw_newlines_in_string_value():
    # LLM emits literal newlines inside the reply string — default json.loads rejects these
    text = '```json\n{\n "reply": "Ada!\nLine two\nLine three",\n "confidence": 0.9,\n "reasoning": "tool returned orders"\n}\n```'
    result = _try_parse_json_reply(text)
    assert result is not None
    assert "Ada!" in result.reply
    assert "Line two" in result.reply
    assert result.confidence == 0.9


def test_parses_fenced_json_with_markdown_content():
    text = '```json\n{"reply": "1. **Bold**\n2. *italic*", "confidence": 0.85, "reasoning": "ok"}\n```'
    result = _try_parse_json_reply(text)
    assert result is not None
    assert "**Bold**" in result.reply


def test_returns_none_on_garbage():
    assert _try_parse_json_reply("not json at all") is None


def test_returns_none_on_empty():
    assert _try_parse_json_reply("") is None
    assert _try_parse_json_reply("   ") is None
