from app.agents.customer_support import _try_parse_json_reply, _try_parse_nl_reply


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


def test_nl_parser_parses_well_formed():
    text = "REPLY: Hello buyer\nCONFIDENCE: 0.9\nREASONING: direct answer"
    result = _try_parse_nl_reply(text)
    assert result is not None
    assert result.reply == "Hello buyer"
    assert result.confidence == 0.9
    assert result.reasoning == "direct answer"


def test_nl_parser_handles_multiline_reply():
    text = (
        "REPLY: Line 1\n"
        "Line 2\n"
        "- bullet\n"
        "CONFIDENCE: 0.85\n"
        "REASONING: multi-line reply preserved"
    )
    result = _try_parse_nl_reply(text)
    assert result is not None
    assert "Line 1" in result.reply
    assert "Line 2" in result.reply
    assert "- bullet" in result.reply
    assert result.confidence == 0.85


def test_nl_parser_case_insensitive_labels():
    text = "reply: hi\nconfidence: 0.7\nreasoning: ok"
    result = _try_parse_nl_reply(text)
    assert result is not None
    assert result.reply == "hi"


def test_nl_parser_returns_none_on_missing_field():
    assert _try_parse_nl_reply("REPLY: hi\nCONFIDENCE: 0.5") is None
    assert _try_parse_nl_reply("just prose, no labels") is None


def test_nl_parser_returns_none_on_empty():
    assert _try_parse_nl_reply("") is None
    assert _try_parse_nl_reply("   ") is None
