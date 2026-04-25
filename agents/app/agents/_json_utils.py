"""Loose JSON parsing + structured-output repair for non-OpenAI providers.

Some providers (Kimi/OpenRouter, etc.) ignore `with_structured_output` and emit
markdown-fenced JSON in plain content. That breaks Pydantic validation with
`json_invalid` on the leading backticks. This helper retries once with an
explicit JSON-only instruction, then strips fences and validates.
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any, Type, TypeVar

from langchain_core.messages import SystemMessage
from pydantic import BaseModel

_log = logging.getLogger(__name__)

_JSON_FENCE_RE = re.compile(r"^```(?:json)?\s*|\s*```$", re.IGNORECASE)
_JSON_OBJECT_RE = re.compile(r"\{.*\}", re.DOTALL)

T = TypeVar("T", bound=BaseModel)


def parse_json_loose(text: str) -> dict | None:
    """Extract first JSON object from text, tolerating ```json fences and prose."""
    if not text or not text.strip():
        return None
    s = _JSON_FENCE_RE.sub("", text.strip()).strip()
    match = _JSON_OBJECT_RE.search(s)
    if not match:
        return None
    try:
        return json.loads(match.group(0), strict=False)
    except Exception:
        return None


async def structured_or_repair(llm, prompt: Any, model_cls: Type[T]) -> T:
    """Call `llm.with_structured_output(model_cls)`; on failure, retry with a
    JSON-only instruction and parse loosely. Raises on second failure.

    `prompt` may be a string or a list of BaseMessage — both are passed through
    to `ainvoke` unchanged.
    """
    try:
        return await llm.with_structured_output(model_cls).ainvoke(prompt)
    except Exception as e:
        _log.warning(
            "structured_output_failed",
            extra={"model": model_cls.__name__, "error": str(e)[:200]},
        )

    schema = json.dumps(model_cls.model_json_schema())
    repair = (
        f"Output ONLY a single JSON object that validates against this schema. "
        f"No markdown code fences. No prose before or after.\n\nSchema:\n{schema}"
    )
    if isinstance(prompt, str):
        repair_prompt: Any = f"{prompt}\n\n{repair}"
    else:
        repair_prompt = list(prompt) + [SystemMessage(content=repair)]

    resp = await llm.ainvoke(repair_prompt)
    text = getattr(resp, "content", resp)
    if not isinstance(text, str):
        text = str(text)
    data = parse_json_loose(text)
    if data is None:
        raise ValueError(
            f"could not parse JSON for {model_cls.__name__}; raw head: {text[:200]!r}"
        )
    return model_cls.model_validate(data)
