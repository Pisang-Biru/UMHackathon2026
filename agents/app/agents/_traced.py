import os
import time
import functools
from typing import Callable

from app.events import emit

TRACE_LLM = os.getenv("TRACE_LLM", "0") == "1"


def traced(agent_id: str, node: str) -> Callable:
    """Wrap a LangGraph node fn to emit node.start/node.end events.

    Node functions have signature (state: dict) -> dict. We pull
    business_id / conversation_id / customer_id from the state for event scoping.

    Status derivation for node.end:
    - "error" if the callable raises.
    - "escalate" if the returned dict has final_action=="escalate".
    - One of {"revise","rewrite","escalate"} if verdict is set.
    - "ok" otherwise.
    """
    def decorator(fn: Callable[[dict], dict]) -> Callable[[dict], dict]:
        @functools.wraps(fn)
        def wrapper(state: dict) -> dict:
            biz = state.get("business_id") if isinstance(state, dict) else None
            conv = None
            if isinstance(state, dict):
                conv = state.get("conversation_id") or state.get("customer_id")

            emit(
                agent_id=agent_id,
                kind="node.start",
                business_id=biz,
                conversation_id=conv,
                node=node,
            )

            start = time.perf_counter()
            try:
                out = fn(state)
                dur = int((time.perf_counter() - start) * 1000)

                status = "ok"
                reasoning = None
                if isinstance(out, dict):
                    verdict = out.get("verdict")
                    if verdict in ("revise", "rewrite", "escalate"):
                        status = verdict
                    if out.get("final_action") == "escalate":
                        status = "escalate"
                    crit = out.get("critique")
                    if crit is not None and hasattr(crit, "model_dump"):
                        try:
                            reasoning = crit.model_dump().get("notes") or None
                        except Exception:
                            reasoning = None

                emit(
                    agent_id=agent_id,
                    kind="node.end",
                    business_id=biz,
                    conversation_id=conv,
                    node=node,
                    status=status,
                    reasoning=reasoning,
                    duration_ms=dur,
                )
                return out
            except Exception as e:
                dur = int((time.perf_counter() - start) * 1000)
                emit(
                    agent_id=agent_id,
                    kind="node.end",
                    business_id=biz,
                    conversation_id=conv,
                    node=node,
                    status="error",
                    summary=f"{type(e).__name__}: {e}",
                    duration_ms=dur,
                )
                raise

        return wrapper
    return decorator
