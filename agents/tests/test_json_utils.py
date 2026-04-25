"""Tests for the structured-output repair helper used by manager + jual nodes."""
from __future__ import annotations

import pytest
from pydantic import BaseModel

from app.agents._json_utils import parse_json_loose, structured_or_repair
from app.schemas.agent_io import ManagerVerdict


class _Resp:
    def __init__(self, content: str):
        self.content = content


class _StructuredOutputBound:
    """Mimic `llm.with_structured_output(Model)` result, configurable to fail."""

    def __init__(self, mode: str, model_cls):
        self.mode = mode
        self.model_cls = model_cls

    async def ainvoke(self, _prompt):
        if self.mode == "ok":
            return self.model_cls(verdict="pass", reason="all good")
        # Simulate the real-world failure: provider returned fenced JSON, the
        # langchain wrapper tried to validate the raw string, Pydantic blew up.
        raise ValueError("Invalid JSON: expected value at line 1 column 2")


class _FakeLLM:
    """Fake llm with configurable structured + plain ainvoke behavior."""

    def __init__(self, *, structured_mode: str, repair_text: str):
        self.structured_mode = structured_mode
        self.repair_text = repair_text
        self.repair_calls = 0

    def with_structured_output(self, model_cls):
        return _StructuredOutputBound(self.structured_mode, model_cls)

    async def ainvoke(self, _prompt):
        self.repair_calls += 1
        return _Resp(self.repair_text)


def test_parse_json_loose_strips_fences():
    text = ' ```json\n{"verdict": "pass", "reason": "ok"}\n```'
    data = parse_json_loose(text)
    assert data == {"verdict": "pass", "reason": "ok"}


def test_parse_json_loose_handles_prose_around_object():
    text = 'Here is your verdict:\n{"verdict": "pass", "reason": "ok"}\nthanks'
    assert parse_json_loose(text) == {"verdict": "pass", "reason": "ok"}


def test_parse_json_loose_returns_none_on_garbage():
    assert parse_json_loose("not json") is None
    assert parse_json_loose("") is None


@pytest.mark.asyncio
async def test_structured_or_repair_happy_path():
    llm = _FakeLLM(structured_mode="ok", repair_text="")
    out = await structured_or_repair(llm, "prompt", ManagerVerdict)
    assert out.verdict == "pass"
    assert llm.repair_calls == 0


@pytest.mark.asyncio
async def test_structured_or_repair_recovers_from_fenced_json():
    """The exact failure from production: fenced JSON returned as raw string."""
    fenced = ' ```json\n{\n "verdict": "pass",\n "reason": "appropriate tone"\n}\n```'
    llm = _FakeLLM(structured_mode="fail", repair_text=fenced)
    out = await structured_or_repair(llm, "prompt", ManagerVerdict)
    assert out.verdict == "pass"
    assert out.reason == "appropriate tone"
    assert llm.repair_calls == 1


@pytest.mark.asyncio
async def test_structured_or_repair_raises_on_unrecoverable():
    llm = _FakeLLM(structured_mode="fail", repair_text="totally not json")
    with pytest.raises(ValueError):
        await structured_or_repair(llm, "prompt", ManagerVerdict)


@pytest.mark.asyncio
async def test_structured_or_repair_accepts_message_list_prompt():
    from langchain_core.messages import SystemMessage

    fenced = '```json\n{"verdict": "revise", "reason": "missing facts"}\n```'
    llm = _FakeLLM(structured_mode="fail", repair_text=fenced)
    out = await structured_or_repair(
        llm, [SystemMessage(content="hi")], ManagerVerdict
    )
    assert out.verdict == "revise"
