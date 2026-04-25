import os
import time
import asyncio
import functools
from typing import Callable, Any

from app.events import emit

TRACE_LLM = os.getenv("TRACE_LLM", "0") == "1"


def _extract_ctx(state: Any) -> tuple[str | None, str | None]:
    if not isinstance(state, dict):
        return None, None
    biz = state.get("business_id")
    conv = state.get("conversation_id") or state.get("customer_id")
    return biz, conv


def _status_and_reasoning(out: Any) -> tuple[str, str | None]:
    status = "ok"
    reasoning: str | None = None
    if isinstance(out, dict):
        verdict = out.get("verdict")
        if verdict in ("revise", "rewrite", "escalate"):
            status = verdict
        if out.get("final_action") == "escalate":
            status = "escalate"
        crit = out.get("critique")
        if crit is not None and hasattr(crit, "model_dump"):
            try:
                d = crit.model_dump()
                parts: list[str] = []
                for key in ("missing_facts", "incorrect_claims",
                            "tone_issues", "unanswered_questions"):
                    vals = d.get(key) or []
                    if isinstance(vals, list) and vals:
                        parts.append(f"{key}: " + "; ".join(str(v) for v in vals))
                reasoning = " | ".join(parts) or None
            except Exception:
                reasoning = None
    return status, reasoning


def traced(agent_id: str, node: str) -> Callable:
    """Wrap a LangGraph node (sync or async) to emit node.start/node.end events."""
    def decorator(fn: Callable) -> Callable:
        if asyncio.iscoroutinefunction(fn):
            @functools.wraps(fn)
            async def awrapper(state):
                biz, conv = _extract_ctx(state)
                emit(agent_id=agent_id, kind="node.start",
                     business_id=biz, conversation_id=conv, node=node)
                start = time.perf_counter()
                try:
                    out = await fn(state)
                    dur = int((time.perf_counter() - start) * 1000)
                    status, reasoning = _status_and_reasoning(out)
                    emit(agent_id=agent_id, kind="node.end",
                         business_id=biz, conversation_id=conv, node=node,
                         status=status, reasoning=reasoning, duration_ms=dur)
                    return out
                except Exception as e:
                    dur = int((time.perf_counter() - start) * 1000)
                    emit(agent_id=agent_id, kind="node.end",
                         business_id=biz, conversation_id=conv, node=node,
                         status="error", summary=f"{type(e).__name__}: {e}",
                         duration_ms=dur)
                    raise
            return awrapper

        @functools.wraps(fn)
        def swrapper(state):
            biz, conv = _extract_ctx(state)
            emit(agent_id=agent_id, kind="node.start",
                 business_id=biz, conversation_id=conv, node=node)
            start = time.perf_counter()
            try:
                out = fn(state)
                dur = int((time.perf_counter() - start) * 1000)
                status, reasoning = _status_and_reasoning(out)
                emit(agent_id=agent_id, kind="node.end",
                     business_id=biz, conversation_id=conv, node=node,
                     status=status, reasoning=reasoning, duration_ms=dur)
                return out
            except Exception as e:
                dur = int((time.perf_counter() - start) * 1000)
                emit(agent_id=agent_id, kind="node.end",
                     business_id=biz, conversation_id=conv, node=node,
                     status="error", summary=f"{type(e).__name__}: {e}",
                     duration_ms=dur)
                raise
        return swrapper
    return decorator
