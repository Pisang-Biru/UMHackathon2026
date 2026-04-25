# Grounding Receipts Envelope Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make retrieval tools emit grounding receipts harvested into `valid_fact_ids` mid-turn so the manager stops escalating well-grounded replies (incl. citable negatives like "no orders found").

**Architecture:** Tools migrate to `@tool(response_format="content_and_artifact")` returning `(text, [GroundingReceipt, ...])`. A new `harvest_receipts` graph node post-Jual reads `ToolMessage.artifact` and merges ids into `valid_fact_ids`. Gates verify against the enriched set; Gate 5 distinguishes "tool fired but uncited" from "tool never fired."

**Tech Stack:** Python 3.12, LangChain 1.2.15, LangGraph 1.1.9, Pydantic v2, pytest 8 (asyncio_mode=auto). Source root `agents/app/`, tests `agents/tests/`. All commands run from `agents/` unless noted.

Spec: `docs/superpowers/specs/2026-04-25-grounding-receipts-envelope-design.md`

---

## File Structure

**Schemas**
- Modify: `agents/app/schemas/agent_io.py` — add `GroundingReceipt` discriminated union, extend `FactRef.kind` literal.

**Manager graph**
- Modify: `agents/app/agents/manager.py` — add `preloaded_fact_ids`, `last_harvested_msg_index` to `ManagerState`; populate in `load_shared_context`; add `harvest_receipts` node; rewire edges.

**Gates**
- Modify: `agents/app/agents/manager_gates.py` — Gate 5 split into `ungrounded_factual_answer` vs `uncited_tool_result`. `run_gates` gains `preloaded_fact_ids` kwarg.
- Modify: `agents/app/agents/manager_evaluator.py:86-91` — pass new kwarg through.

**Customer support tools**
- Modify: `agents/app/agents/customer_support.py` —
  - Add module-level helpers `_safe_tool_return`, `_error_tool_return`, `_phone_key`, `_short_id`, `_query_hash8`.
  - Migrate `check_order_status` to `content_and_artifact`.
  - Migrate `search_memory` to `content_and_artifact`.
  - Change tool invocation loop to `chosen.invoke(call)`.

**Memory formatter**
- Modify: `agents/app/memory/formatter.py:format_search_results` — surface short ids; emit empty-result `[id=none:<hash>]` line.

**Tests (new)**
- Create: `agents/tests/test_grounding_receipts_schema.py`
- Create: `agents/tests/test_check_order_status_envelope.py`
- Create: `agents/tests/test_search_memory_envelope.py`
- Create: `agents/tests/test_harvest_receipts.py`

**Tests (extended)**
- Modify: `agents/tests/test_manager_gates.py` — Gate 5 truth-table cases.
- Modify: `agents/tests/test_manager_e2e.py` — screenshot reproduction.

---

## Task 1: GroundingReceipt discriminated union

**Files:**
- Modify: `agents/app/schemas/agent_io.py`
- Test: `agents/tests/test_grounding_receipts_schema.py`

- [ ] **Step 1: Write the failing test**

Create `agents/tests/test_grounding_receipts_schema.py`:

```python
# agents/tests/test_grounding_receipts_schema.py
import pytest
from pydantic import TypeAdapter, ValidationError
from app.schemas.agent_io import (
    GroundingReceipt,
    ProductReceipt,
    OrderReceipt,
    KbReceipt,
    PastActionReceipt,
    PaymentLinkReceipt,
)

_ADAPTER = TypeAdapter(GroundingReceipt)


def test_product_receipt_round_trips():
    r = ProductReceipt(id="prod_123")
    data = _ADAPTER.dump_python(r)
    assert data == {"kind": "product", "id": "prod_123"}
    parsed = _ADAPTER.validate_python(data)
    assert isinstance(parsed, ProductReceipt)
    assert parsed.id == "prod_123"


def test_order_receipt_supports_negative_id():
    r = OrderReceipt(id="none:60123456789")
    data = _ADAPTER.dump_python(r)
    parsed = _ADAPTER.validate_python(data)
    assert parsed.id == "none:60123456789"


def test_kb_receipt_requires_chunk_id_and_sim():
    r = KbReceipt(id="ab12cd34", chunk_id="full-chunk-pk", sim=0.82)
    parsed = _ADAPTER.validate_python(_ADAPTER.dump_python(r))
    assert parsed.chunk_id == "full-chunk-pk"
    assert parsed.sim == pytest.approx(0.82)


def test_past_action_receipt_round_trip():
    r = PastActionReceipt(id="cd56ef78", full_id="action-full", sim=0.71)
    parsed = _ADAPTER.validate_python(_ADAPTER.dump_python(r))
    assert parsed.kind == "memory:past_action"
    assert parsed.id == "cd56ef78"


def test_payment_link_receipt_round_trip():
    r = PaymentLinkReceipt(id="order_xyz")
    parsed = _ADAPTER.validate_python(_ADAPTER.dump_python(r))
    assert parsed.kind == "payment_link"


def test_discriminator_rejects_unknown_kind():
    with pytest.raises(ValidationError):
        _ADAPTER.validate_python({"kind": "weather", "id": "sunny"})


def test_discriminator_routes_by_kind_field():
    parsed = _ADAPTER.validate_python({"kind": "kb", "id": "ab12cd34", "chunk_id": "x", "sim": 0.5})
    assert isinstance(parsed, KbReceipt)
```

- [ ] **Step 2: Run test to verify it fails**

```
cd agents && pytest tests/test_grounding_receipts_schema.py -v
```

Expected: FAIL with `ImportError: cannot import name 'GroundingReceipt'` (or similar — symbols don't exist yet).

- [ ] **Step 3: Implement schema**

Replace `agents/app/schemas/agent_io.py` with:

```python
from typing import Annotated, Literal, Union
from pydantic import BaseModel, Field


class FactRef(BaseModel):
    """Identity key is (kind, id). Gate check uses f'{kind}:{id}' composite."""
    kind: Literal["product", "order", "kb", "memory", "memory:past_action", "payment_link"]
    id: str


class StructuredReply(BaseModel):
    reply: str
    confidence: float = Field(default=0.5, ge=0.0, le=1.0)
    reasoning: str = ""
    addressed_questions: list[str] = Field(default_factory=list)
    unaddressed_questions: list[str] = Field(default_factory=list)
    facts_used: list[FactRef] = Field(default_factory=list)
    needs_human: bool = False


class ManagerCritique(BaseModel):
    missing_facts: list[str] = Field(default_factory=list)
    incorrect_claims: list[str] = Field(default_factory=list)
    tone_issues: list[str] = Field(default_factory=list)
    unanswered_questions: list[str] = Field(default_factory=list)
    keep_from_draft: list[str] = Field(default_factory=list)


class ManagerVerdict(BaseModel):
    verdict: Literal["pass", "revise", "rewrite", "escalate"]
    critique: ManagerCritique | None = None
    reason: str


class IterationEntry(BaseModel):
    stage: Literal["jual_v1", "jual_v2", "manager_rewrite"]
    draft: StructuredReply | None = None
    verdict: ManagerVerdict | None = None
    gate_results: dict = Field(default_factory=dict)
    latency_ms: int | None = None


# ---- Grounding receipts (tool-emitted, harvested into valid_fact_ids) ----

class ProductReceipt(BaseModel):
    kind: Literal["product"] = "product"
    id: str  # product_id


class OrderReceipt(BaseModel):
    kind: Literal["order"] = "order"
    id: str  # order_id, OR f"none:{phone_key}" for citable negative


class KbReceipt(BaseModel):
    kind: Literal["kb"] = "kb"
    id: str          # 8-char short id surfaced in formatter; what the LLM cites
    chunk_id: str    # full chunk pk; telemetry/debug only
    sim: float


class PastActionReceipt(BaseModel):
    kind: Literal["memory:past_action"] = "memory:past_action"
    id: str          # 8-char short id
    full_id: str
    sim: float


class PaymentLinkReceipt(BaseModel):
    kind: Literal["payment_link"] = "payment_link"
    id: str          # order_id


GroundingReceipt = Annotated[
    Union[ProductReceipt, OrderReceipt, KbReceipt, PastActionReceipt, PaymentLinkReceipt],
    Field(discriminator="kind"),
]
```

Note: `FactRef.kind` literal extended to include `"memory:past_action"` and `"payment_link"` so LLM citations stay typed.

- [ ] **Step 4: Run test to verify it passes**

```
cd agents && pytest tests/test_grounding_receipts_schema.py -v
```

Expected: 7 passed.

- [ ] **Step 5: Run full schema tests for regression**

```
cd agents && pytest tests/test_agent_io_schemas.py tests/test_jual_structured_reply_shape.py -v
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add agents/app/schemas/agent_io.py agents/tests/test_grounding_receipts_schema.py
git commit -m "feat(schemas): add GroundingReceipt discriminated union"
```

---

## Task 2: Manager state — preloaded_fact_ids + harvest cursor

**Files:**
- Modify: `agents/app/agents/manager.py:33-52` (state def), `:98-103` (load_shared_context)
- Test: existing `agents/tests/test_manager_e2e.py` regression — no new test yet (state additions are no-op until Task 3 reads them).

- [ ] **Step 1: Add fields to ManagerState and populate them**

In `agents/app/agents/manager.py`, replace the `ManagerState` class (current lines 33-51) with:

```python
class ManagerState(TypedDict, total=False):
    messages: Annotated[list[BaseMessage], add_messages]
    business_id: str
    customer_id: str
    customer_phone: str
    business_context: str
    memory_block: str
    valid_fact_ids: set[str]
    preloaded_fact_ids: set[str]      # snapshot of pre-tool-call ids; never mutated after load
    last_harvested_msg_index: int     # cursor for harvest_receipts; init 0
    jual_draft: StructuredReply | None
    verdict: Literal["pass", "revise", "rewrite", "escalate"] | None
    critique: ManagerCritique | None
    gate_results: dict | None
    revision_count: int
    iterations: list[IterationEntry]
    final_reply: str | None
    final_action: Literal["auto_send", "escalate"] | None
    final_action_hint: Literal["auto_send", "escalate"] | None
    action_id: str | None
    best_draft: str | None
```

In `_load_shared_context_impl`, replace the return block (current lines 98-103) with:

```python
    valid_ids = {f"product:{p.id}" for p in products}
    return {
        "business_context": business_context,
        "memory_block": memory_block,
        "valid_fact_ids": valid_ids,
        "preloaded_fact_ids": set(valid_ids),  # frozen snapshot for Gate 5 "had retrieval?" check
        "last_harvested_msg_index": 0,
    }
```

- [ ] **Step 2: Run regression**

```
cd agents && pytest tests/test_manager_e2e.py tests/test_manager_evaluator.py tests/test_manager_gates.py -v
```

Expected: all pass (no behavior change).

- [ ] **Step 3: Commit**

```bash
git add agents/app/agents/manager.py
git commit -m "feat(manager): add preloaded_fact_ids and harvest cursor to state"
```

---

## Task 3: harvest_receipts node + graph rewiring

**Files:**
- Modify: `agents/app/agents/manager.py` — add node, wire edges.
- Create: `agents/tests/test_harvest_receipts.py`

- [ ] **Step 1: Write the failing test**

Create `agents/tests/test_harvest_receipts.py`:

```python
# agents/tests/test_harvest_receipts.py
import pytest
from langchain_core.messages import HumanMessage, AIMessage, ToolMessage
from app.schemas.agent_io import OrderReceipt, KbReceipt
from app.agents.manager import _harvest_receipts_impl


def _tm(content, artifact=None, tool_call_id="call_1"):
    msg = ToolMessage(content=content, tool_call_id=tool_call_id)
    if artifact is not None:
        # langchain ToolMessage supports artifact attribute
        msg.artifact = artifact
    return msg


@pytest.mark.asyncio
async def test_harvest_merges_artifact_receipts_into_valid_fact_ids():
    state = {
        "messages": [
            HumanMessage(content="ada order?"),
            AIMessage(content=""),
            _tm("no orders found", artifact=[OrderReceipt(id="none:60123")]),
        ],
        "valid_fact_ids": {"product:p1"},
        "last_harvested_msg_index": 0,
    }
    out = await _harvest_receipts_impl(state)
    assert out["valid_fact_ids"] == {"product:p1", "order:none:60123"}
    assert out["last_harvested_msg_index"] == 3


@pytest.mark.asyncio
async def test_harvest_is_idempotent_across_revise_loop():
    msg = _tm("ok", artifact=[OrderReceipt(id="ord_42")])
    state = {
        "messages": [HumanMessage(content="x"), msg],
        "valid_fact_ids": {"product:p1"},
        "last_harvested_msg_index": 0,
    }
    out1 = await _harvest_receipts_impl(state)
    state.update(out1)
    out2 = await _harvest_receipts_impl(state)
    # Cursor advanced to end; second call adds nothing new
    assert out2["valid_fact_ids"] == {"product:p1", "order:ord_42"}
    assert out2["last_harvested_msg_index"] == 2


@pytest.mark.asyncio
async def test_harvest_skips_plain_string_tool_messages():
    state = {
        "messages": [
            HumanMessage(content="x"),
            _tm("plain string output, no artifact"),
        ],
        "valid_fact_ids": {"product:p1"},
        "last_harvested_msg_index": 0,
    }
    out = await _harvest_receipts_impl(state)
    assert out["valid_fact_ids"] == {"product:p1"}
    assert out["last_harvested_msg_index"] == 2


@pytest.mark.asyncio
async def test_harvest_only_scans_messages_after_cursor():
    state = {
        "messages": [
            HumanMessage(content="x"),
            _tm("first call", artifact=[OrderReceipt(id="ord_1")]),
            _tm("second call", artifact=[OrderReceipt(id="ord_2")]),
        ],
        "valid_fact_ids": {"order:ord_1"},
        "last_harvested_msg_index": 2,  # already harvested first two messages
    }
    out = await _harvest_receipts_impl(state)
    assert out["valid_fact_ids"] == {"order:ord_1", "order:ord_2"}
    assert out["last_harvested_msg_index"] == 3


@pytest.mark.asyncio
async def test_harvest_handles_multiple_receipts_in_single_artifact():
    state = {
        "messages": [
            HumanMessage(content="x"),
            _tm("found 2", artifact=[
                KbReceipt(id="ab12cd34", chunk_id="full1", sim=0.8),
                KbReceipt(id="ef56gh78", chunk_id="full2", sim=0.7),
            ]),
        ],
        "valid_fact_ids": set(),
        "last_harvested_msg_index": 0,
    }
    out = await _harvest_receipts_impl(state)
    assert out["valid_fact_ids"] == {"kb:ab12cd34", "kb:ef56gh78"}
```

- [ ] **Step 2: Run test to verify it fails**

```
cd agents && pytest tests/test_harvest_receipts.py -v
```

Expected: FAIL with `ImportError: cannot import name '_harvest_receipts_impl'`.

- [ ] **Step 3: Implement harvest node**

In `agents/app/agents/manager.py`, add this module-level function near `_load_shared_context_impl`:

```python
async def _harvest_receipts_impl(state: dict) -> dict:
    """Read ToolMessage.artifact entries appended since last_harvested_msg_index;
    merge their (kind, id) tuples into valid_fact_ids. Idempotent via cursor.

    Plain @tool returns produce ToolMessage with artifact=None — harvest no-ops on
    those, allowing tools to migrate one at a time.
    """
    from langchain_core.messages import ToolMessage
    msgs = state.get("messages", []) or []
    start = state.get("last_harvested_msg_index", 0)
    new_ids = set(state.get("valid_fact_ids", set()))
    for msg in msgs[start:]:
        if not isinstance(msg, ToolMessage):
            continue
        for r in (getattr(msg, "artifact", None) or []):
            new_ids.add(f"{r.kind}:{r.id}")
    return {
        "valid_fact_ids": new_ids,
        "last_harvested_msg_index": len(msgs),
    }
```

In `build_manager_graph`, register the node and rewire. Find the existing block (around lines 281-307) and modify:

1. After `graph.add_node("dispatch_jual_revise", ...)`, add:
   ```python
   graph.add_node("harvest_receipts", _t("harvest_receipts")(_harvest_receipts_impl))
   ```

2. Replace `graph.add_edge("dispatch_jual", "evaluate")` with:
   ```python
   graph.add_edge("dispatch_jual", "harvest_receipts")
   graph.add_edge("harvest_receipts", "evaluate")
   ```

3. Replace `graph.add_edge("dispatch_jual_revise", "evaluate")` with:
   ```python
   graph.add_edge("dispatch_jual_revise", "harvest_receipts")
   ```

Note: `harvest_receipts → evaluate` covers both first-draft and revise paths (single fan-in edge).

- [ ] **Step 4: Run test to verify it passes**

```
cd agents && pytest tests/test_harvest_receipts.py -v
```

Expected: 5 passed.

- [ ] **Step 5: Run full manager regression**

```
cd agents && pytest tests/test_manager_e2e.py tests/test_manager_evaluator.py tests/test_manager_gates.py -v
```

Expected: all pass. Harvest is a no-op (no artifacts emitted yet), so existing flows are unchanged.

- [ ] **Step 6: Commit**

```bash
git add agents/app/agents/manager.py agents/tests/test_harvest_receipts.py
git commit -m "feat(manager): add harvest_receipts node merging tool artifacts into valid_fact_ids"
```

---

## Task 4: Tool invocation loop — single convention

**Files:**
- Modify: `agents/app/agents/customer_support.py:407-413`
- Test: `agents/tests/test_customer_support_traced.py` (existing) regression

- [ ] **Step 1: Inspect the existing loop**

Open `agents/app/agents/customer_support.py:407-413`. Current code:

```python
for call in tool_calls:
    chosen = tool_by_name.get(call["name"])
    if chosen is None:
        history.append(ToolMessage(content=f"ERROR: unknown tool {call['name']}", tool_call_id=call["id"]))
        continue
    result = chosen.invoke(call["args"])
    history.append(ToolMessage(content=str(result), tool_call_id=call["id"]))
```

- [ ] **Step 2: Replace with single-convention invocation**

Replace those lines with:

```python
for call in tool_calls:
    chosen = tool_by_name.get(call["name"])
    if chosen is None:
        history.append(ToolMessage(content=f"ERROR: unknown tool {call['name']}", tool_call_id=call["id"]))
        continue
    # Tool invocation: pass the full ToolCall dict.
    # - For @tool(response_format="content_and_artifact"): returns ToolMessage with .artifact populated.
    # - For plain @tool: returns ToolMessage with .artifact=None.
    # Single convention covers both during the migration window.
    tool_msg = chosen.invoke(call)
    history.append(tool_msg)
```

- [ ] **Step 3: Run regression**

```
cd agents && pytest tests/test_customer_support_traced.py tests/test_manager_e2e.py -v
```

Expected: all pass. Plain `@tool` invoked with a ToolCall dict still produces a `ToolMessage(content=str(result), tool_call_id=..., artifact=None)`.

- [ ] **Step 4: Commit**

```bash
git add agents/app/agents/customer_support.py
git commit -m "refactor(customer_support): single tool-invocation convention via ToolCall dict"
```

---

## Task 5: Migrate check_order_status to content_and_artifact

**Files:**
- Modify: `agents/app/agents/customer_support.py:245-292` (tool factory) + add module-level helpers near top.
- Create: `agents/tests/test_check_order_status_envelope.py`

- [ ] **Step 1: Write the failing test**

Create `agents/tests/test_check_order_status_envelope.py`:

```python
# agents/tests/test_check_order_status_envelope.py
import pytest
from unittest.mock import MagicMock, patch
from langchain_core.messages import ToolMessage
from app.schemas.agent_io import OrderReceipt
from app.agents.customer_support import _make_order_lookup_tool, _phone_key


def _toolcall(args=None, name="check_order_status", id="call_1"):
    return {"name": name, "args": args or {}, "id": id, "type": "tool_call"}


def test_phone_key_strips_non_digits():
    assert _phone_key("+60 12-345 6789") == "60123456789"
    assert _phone_key("60123456789") == "60123456789"
    assert _phone_key("") == ""
    assert _phone_key(None) == ""


def test_phone_key_round_trip_with_spaces_and_dashes():
    a = _phone_key("+60 12-345 6789")
    b = _phone_key("60-123-456-789")
    assert a == b == "60123456789"


def test_check_order_status_no_phone_returns_error_no_receipts():
    tool = _make_order_lookup_tool("biz_1", "")
    msg = tool.invoke(_toolcall())
    assert isinstance(msg, ToolMessage)
    assert "ERROR" in msg.content
    assert (msg.artifact or []) == []


def test_check_order_status_empty_emits_negative_receipt():
    tool = _make_order_lookup_tool("biz_1", "+60 12-345 6789")
    with patch("app.agents.customer_support.SessionLocal") as mock_session:
        ctx = MagicMock()
        mock_session.return_value.__enter__.return_value = ctx
        ctx.query.return_value.outerjoin.return_value.filter.return_value.order_by.return_value.limit.return_value.all.return_value = []
        msg = tool.invoke(_toolcall())
    assert msg.content == "no orders found for this phone"
    assert len(msg.artifact) == 1
    r = msg.artifact[0]
    assert isinstance(r, OrderReceipt)
    assert r.id == "none:60123456789"


def test_check_order_status_db_error_returns_no_receipts():
    tool = _make_order_lookup_tool("biz_1", "60123")
    with patch("app.agents.customer_support.SessionLocal") as mock_session:
        mock_session.side_effect = RuntimeError("db down")
        msg = tool.invoke(_toolcall())
    assert msg.content.startswith("ERROR")
    assert (msg.artifact or []) == []


def test_check_order_status_orders_emit_one_receipt_per_row():
    from datetime import datetime
    from app.db.models import OrderStatus
    tool = _make_order_lookup_tool("biz_1", "60123456789")
    fake_order_a = MagicMock(
        id="ord_aaaaaaaaaa", productId="prod_1", qty=2,
        status=OrderStatus.PAID, createdAt=datetime(2026, 4, 25),
        paidAt=datetime(2026, 4, 25), paymentUrl=None,
    )
    fake_order_b = MagicMock(
        id="ord_bbbbbbbbbb", productId="prod_2", qty=1,
        status=OrderStatus.PENDING_PAYMENT, createdAt=datetime(2026, 4, 24),
        paidAt=None, paymentUrl="https://pay/x",
    )
    rows = [(fake_order_a, "Widget"), (fake_order_b, "Gadget")]
    with patch("app.agents.customer_support.SessionLocal") as mock_session:
        ctx = MagicMock()
        mock_session.return_value.__enter__.return_value = ctx
        ctx.query.return_value.outerjoin.return_value.filter.return_value.order_by.return_value.limit.return_value.all.return_value = rows
        msg = tool.invoke(_toolcall())
    ids = sorted(r.id for r in msg.artifact)
    assert ids == ["ord_aaaaaaaaaa", "ord_bbbbbbbbbb"]
    assert all(isinstance(r, OrderReceipt) for r in msg.artifact)
```

- [ ] **Step 2: Run test to verify it fails**

```
cd agents && pytest tests/test_check_order_status_envelope.py -v
```

Expected: FAIL with `ImportError: cannot import name '_phone_key'` and/or AttributeError on `msg.artifact`.

- [ ] **Step 3: Add module-level helpers and migrate the tool**

In `agents/app/agents/customer_support.py`, add near the top of the file (after imports, before tool factories):

```python
import hashlib
import re

def _phone_key(phone: str | None) -> str:
    """Lowercase, digits-only key. Used both at receipt emission and gate lookup
    so 'none:<phone_key>' ids round-trip across formatting differences."""
    return re.sub(r"\D", "", (phone or "").lower())


def _short_id(full: str, n: int = 8) -> str:
    """Stable short id derived from a full pk. Used by formatter and tools to
    produce the citable short id LLM sees and gates verify."""
    return hashlib.sha1(full.encode("utf-8")).hexdigest()[:n]


def _query_hash8(query: str) -> str:
    return hashlib.sha1((query or "").encode("utf-8")).hexdigest()[:8]


def _safe_tool_return(text: str, receipts: list) -> tuple[str, list]:
    """Success path. Receipts MUST reflect data the tool actually saw."""
    return (text, receipts)


def _error_tool_return(err: str) -> tuple[str, list]:
    """Error path. NO receipts — Gate 5 will treat any downstream claim as ungrounded."""
    return (f"ERROR: {err}", [])
```

Replace `_make_order_lookup_tool` (lines 245-292) with:

```python
def _make_order_lookup_tool(business_id: str, customer_phone: str):
    @tool(response_format="content_and_artifact")
    def check_order_status() -> tuple[str, list]:
        """Look up the current buyer's recent orders and their payment status.

        Call this whenever the buyer asks about past purchases, current orders,
        or whether a payment succeeded. Takes no arguments — it already knows
        the current buyer. Never guess — always call this tool.

        Returns up to 5 orders, newest first, or "no orders found for this phone".
        """
        from app.schemas.agent_io import OrderReceipt
        if not customer_phone:
            return _error_tool_return("no phone on file for this buyer")
        try:
            with SessionLocal() as session:
                rows = (
                    session.query(Order, Product.name)
                    .outerjoin(Product, Product.id == Order.productId)
                    .filter(
                        Order.businessId == business_id,
                        Order.buyerContact == customer_phone,
                    )
                    .order_by(Order.createdAt.desc())
                    .limit(5)
                    .all()
                )
            if not rows:
                return _safe_tool_return(
                    "no orders found for this phone",
                    [OrderReceipt(id=f"none:{_phone_key(customer_phone)}")],
                )
            lines = []
            receipts = []
            for order, product_name in rows:
                short_id = order.id[:10]
                created = order.createdAt.date().isoformat() if order.createdAt else "?"
                parts = [
                    f"#{short_id}",
                    f"{order.qty}x {product_name or order.productId}",
                    order.status.value,
                    f"created {created}",
                ]
                if order.status == OrderStatus.PAID and order.paidAt:
                    parts.append(f"paid {order.paidAt.date().isoformat()}")
                if order.status == OrderStatus.PENDING_PAYMENT:
                    pay_url = order.paymentUrl or f"{APP_URL}/pay/{order.id}"
                    parts.append(f"pay: {pay_url}")
                lines.append(" • ".join(parts))
                receipts.append(OrderReceipt(id=order.id))
            return _safe_tool_return("\n".join(lines), receipts)
        except Exception as e:
            return _error_tool_return(str(e))
    return check_order_status
```

Update the system prompt at `customer_support.py:208`. Find:

```
- If you call check_order_status, add {{"kind":"order","id":"<order_id>"}} for each order you reference.
```

Replace with:

```
- If you call check_order_status, add {{"kind":"order","id":"<order_id>"}} for each order you reference. If the tool returns "no orders found for this phone", cite {{"kind":"order","id":"none:<digits-only phone>"}} — that is the citable negative.
```

- [ ] **Step 4: Run test to verify it passes**

```
cd agents && pytest tests/test_check_order_status_envelope.py -v
```

Expected: 6 passed.

- [ ] **Step 5: Run regression**

```
cd agents && pytest tests/test_customer_support_traced.py tests/test_manager_e2e.py -v
```

Expected: all pass. Order-related e2e cases now produce richer `valid_fact_ids` mid-turn but Gate 2 still admits the same ids it did before (order ids are now legitimately registered).

- [ ] **Step 6: Commit**

```bash
git add agents/app/agents/customer_support.py agents/tests/test_check_order_status_envelope.py
git commit -m "feat(tools): check_order_status emits grounding receipts (incl. citable negatives)"
```

---

## Task 6: Gate 5 — distinguish uncited_tool_result vs ungrounded_factual_answer

**Files:**
- Modify: `agents/app/agents/manager_gates.py`
- Modify: `agents/app/agents/manager_evaluator.py:86-91`
- Modify: `agents/tests/test_manager_gates.py`

- [ ] **Step 1: Extend manager_gates tests**

Append to `agents/tests/test_manager_gates.py`:

```python
def test_gate5_no_facts_no_retrieval_says_ungrounded():
    d = _draft(facts_used=[])
    r = run_gates(
        d,
        valid_fact_ids={"product:p1"},
        preloaded_fact_ids={"product:p1"},
        revision_count=0,
        messages=_msgs("ada saya beli apa-apa harini?"),
    )
    assert r.verdict == "revise"
    assert r.gate_num == 5
    assert r.reason_slug == "ungrounded_factual_answer"


def test_gate5_no_facts_but_retrieval_happened_says_uncited():
    d = _draft(facts_used=[])
    r = run_gates(
        d,
        valid_fact_ids={"product:p1", "order:none:60123"},
        preloaded_fact_ids={"product:p1"},
        revision_count=0,
        messages=_msgs("ada saya beli apa-apa harini?"),
    )
    assert r.verdict == "revise"
    assert r.gate_num == 5
    assert r.reason_slug == "uncited_tool_result"


def test_gate5_negative_receipt_cited_passes():
    d = _draft(facts_used=[FactRef(kind="order", id="none:60123")])
    r = run_gates(
        d,
        valid_fact_ids={"product:p1", "order:none:60123"},
        preloaded_fact_ids={"product:p1"},
        revision_count=0,
        messages=_msgs("ada saya beli apa-apa harini?"),
    )
    assert r.verdict is None  # all gates passed


def test_gate5_uncited_tool_result_persists_after_revise():
    d = _draft(facts_used=[])
    r = run_gates(
        d,
        valid_fact_ids={"product:p1", "order:ord_42"},
        preloaded_fact_ids={"product:p1"},
        revision_count=1,
        messages=_msgs("ada saya beli apa-apa harini?"),
    )
    assert r.verdict == "rewrite"
    assert r.reason_slug == "uncited_tool_result_persists"
```

- [ ] **Step 2: Run extended tests to verify they fail**

```
cd agents && pytest tests/test_manager_gates.py -v
```

Expected: the 4 new cases FAIL with `TypeError: run_gates() got an unexpected keyword argument 'preloaded_fact_ids'`.

- [ ] **Step 3: Update run_gates signature and Gate 5 logic**

Replace `agents/app/agents/manager_gates.py` with:

```python
# agents/app/agents/manager_gates.py
import re
from dataclasses import dataclass, field
from typing import Literal
from langchain_core.messages import BaseMessage, HumanMessage
from app.schemas.agent_io import StructuredReply, ManagerCritique


FACTUAL_Q_RE = re.compile(
    r"\b(harga|price|stock|berapa|bila|macam\s+mana|bagaimana|"
    r"how\s+much|available|when|order|cost)\b",
    re.IGNORECASE,
)


def _last_human_text(messages: list[BaseMessage]) -> str:
    for msg in reversed(messages):
        if isinstance(msg, HumanMessage) and isinstance(msg.content, str):
            return msg.content
    return ""


@dataclass
class GateResult:
    verdict: Literal["pass", "revise", "rewrite", "escalate"] | None
    gate_num: int | None = None
    reason_slug: str | None = None
    critique: ManagerCritique | None = None
    passed_gates: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "verdict": self.verdict,
            "gate_num": self.gate_num,
            "reason_slug": self.reason_slug,
            "passed_gates": self.passed_gates,
        }


def run_gates(
    draft: StructuredReply,
    *,
    valid_fact_ids: set[str],
    revision_count: int,
    messages: list[BaseMessage],
    preloaded_fact_ids: set[str] | None = None,
) -> GateResult:
    """Run gates against a draft.

    `preloaded_fact_ids` is the snapshot of valid_fact_ids before any tools fired
    this turn. Used by Gate 5 to distinguish "no tool fired" (ungrounded answer)
    from "tool fired but draft did not cite the result" (uncited tool result).
    Defaults to empty for callers that don't track it (legacy tests).

    kb / memory:past_action grounding verifies a specific retrieved chunk was
    cited as basis. Relevance of claim to chunk content is NOT checked
    automatically — that's delegated to manager_evaluator's content judgment.
    A future LLM-judged relevance gate (claim-vs-content) would close this gap.
    See docs/superpowers/specs/2026-04-25-grounding-receipts-envelope-design.md §8.
    """
    if preloaded_fact_ids is None:
        preloaded_fact_ids = set()
    passed = []

    # Gate 1 — needs_human flag
    if draft.needs_human:
        return GateResult(verdict="escalate", gate_num=1, reason_slug="jual_self_flagged", passed_gates=passed)
    passed.append("needs_human_flag")

    # Gate 2 — hallucinated fact
    for fact in draft.facts_used:
        key = f"{fact.kind}:{fact.id}"
        if key not in valid_fact_ids:
            return GateResult(
                verdict="rewrite",
                gate_num=2,
                reason_slug=f"ungrounded_fact:{fact.kind}:{fact.id}",
                passed_gates=passed,
            )
    passed.append("hallucinated_fact")

    # Gate 3 / 4 — unaddressed questions
    if draft.unaddressed_questions:
        if revision_count == 0:
            return GateResult(
                verdict="revise",
                gate_num=3,
                reason_slug="jual_self_reported_gap",
                critique=ManagerCritique(unanswered_questions=list(draft.unaddressed_questions)),
                passed_gates=passed,
            )
        return GateResult(
            verdict="rewrite",
            gate_num=4,
            reason_slug="revise_failed_to_close_gaps",
            passed_gates=passed,
        )
    passed.append("unaddressed")

    # Gate 5 — factual question without grounding
    buyer_msg = _last_human_text(messages)
    if FACTUAL_Q_RE.search(buyer_msg) and not draft.facts_used:
        added_this_turn = valid_fact_ids - preloaded_fact_ids
        had_retrieval = bool(added_this_turn)
        base = "uncited_tool_result" if had_retrieval else "ungrounded_factual_answer"
        if revision_count == 0:
            return GateResult(
                verdict="revise",
                gate_num=5,
                reason_slug=base,
                critique=ManagerCritique(
                    missing_facts=[f"grounded data for: {buyer_msg[:80]}"],
                ),
                passed_gates=passed,
            )
        return GateResult(
            verdict="rewrite",
            gate_num=5,
            reason_slug=f"{base}_persists",
            passed_gates=passed,
        )
    passed.append("factual_q_grounded")

    return GateResult(verdict=None, passed_gates=passed)
```

Update the call site in `agents/app/agents/manager_evaluator.py:86-91`. Replace:

```python
        gate_result = run_gates(
            draft,
            valid_fact_ids=state.get("valid_fact_ids", set()),
            revision_count=state.get("revision_count", 0),
            messages=state.get("messages", []),
        )
```

with:

```python
        gate_result = run_gates(
            draft,
            valid_fact_ids=state.get("valid_fact_ids", set()),
            preloaded_fact_ids=state.get("preloaded_fact_ids", set()),
            revision_count=state.get("revision_count", 0),
            messages=state.get("messages", []),
        )
```

- [ ] **Step 4: Run gate tests to verify they pass**

```
cd agents && pytest tests/test_manager_gates.py -v
```

Expected: all pass (existing + 4 new).

- [ ] **Step 5: Run manager regression**

```
cd agents && pytest tests/test_manager_e2e.py tests/test_manager_evaluator.py -v
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add agents/app/agents/manager_gates.py agents/app/agents/manager_evaluator.py agents/tests/test_manager_gates.py
git commit -m "feat(gates): split Gate 5 into uncited_tool_result vs ungrounded_factual_answer"
```

---

## Task 7: Bundle — formatter rewrite + search_memory migration

These ship together. Formatter surfaces `[id=...]` markers in LLM-visible text; the moment they appear, Jual will start citing them, so receipts must be registered in the same release.

**Files:**
- Modify: `agents/app/memory/formatter.py:format_search_results`
- Modify: `agents/app/agents/customer_support.py` (`_make_search_memory_tool`)
- Create: `agents/tests/test_search_memory_envelope.py`
- Modify: `agents/tests/test_formatter.py` (extend)

### 7a — Formatter rewrite

- [ ] **Step 1: Inspect existing formatter test to keep its conventions**

```
cd agents && grep -n "format_search_results" tests/test_formatter.py
```

Note the existing assertions; we'll add new ones rather than break them where possible. (If existing tests rely on the old `[sim=0.82]` line shape, update those assertions in this task.)

- [ ] **Step 2: Add failing formatter tests**

Append to `agents/tests/test_formatter.py`:

```python
def test_format_search_results_surfaces_short_ids_for_kb():
    from app.memory.formatter import format_search_results

    class _Hit:
        def __init__(self, _id, content, sim):
            self.id = _id
            self.content = content
            self.similarity = sim

    hits = [
        _Hit("kb-chunk-aaaaaaaa", "Return policy is 7 days.", 0.82),
        _Hit("kb-chunk-bbbbbbbb", "Refunds processed within 14 days.", 0.71),
    ]
    out = format_search_results("kb", hits)
    assert "[id=" in out
    # Two distinct short ids visible
    import re
    short_ids = re.findall(r"\[id=([a-f0-9]{8,})\b", out)
    assert len(short_ids) == 2
    assert short_ids[0] != short_ids[1]


def test_format_search_results_empty_emits_negative_id_marker():
    from app.memory.formatter import format_search_results
    out = format_search_results("kb", [], query="return policy")
    assert "No results" in out
    assert "[id=none:" in out
    assert 'for query "return policy"' in out
```

- [ ] **Step 3: Run to verify failure**

```
cd agents && pytest tests/test_formatter.py -v
```

Expected: the 2 new tests FAIL — current formatter strips ids and signature lacks `query` kwarg.

- [ ] **Step 4: Rewrite the formatter**

Replace `format_search_results` in `agents/app/memory/formatter.py` (currently at line 52):

```python
def format_search_results(kind: str, hits, *, query: str | None = None) -> str:
    """Render a retrieval result for the LLM with stable, citable short ids.

    Each hit gets `[id=<short>]` derived from its full pk via sha1[:8]. Empty
    results render `[id=none:<query_hash8>]` so the LLM has a citable anchor
    for negative claims ("I checked, no relevant docs"). On the rare short-id
    collision within one result, all ids in that result bump to 12 chars.
    """
    import hashlib

    def _short(full: str, n: int) -> str:
        return hashlib.sha1(str(full).encode("utf-8")).hexdigest()[:n]

    hits = list(hits)
    if not hits:
        q = query or ""
        q_hash = _short(q, 8)
        return (
            f"No results (kind={kind}).\n"
            f'[id=none:{q_hash}] for query "{q}"'
        )

    # Choose short-id width (8 default; bump to 12 on collision).
    raw_ids = [str(getattr(h, "id", "")) for h in hits]
    width = 8
    if len({_short(r, 8) for r in raw_ids}) < len(raw_ids):
        width = 12

    lines = [f"Found {len(hits)} results (kind={kind}):"]
    for h, raw in zip(hits, raw_ids):
        sim = getattr(h, "similarity", 0.0)
        content = getattr(h, "content", None) or getattr(h, "customerMsg", None) or ""
        lines.append(f"[id={_short(raw, width)} sim={sim:.2f}] {content}")
    return "\n".join(lines)
```

If the existing `test_formatter.py` had assertions on the old shape (`"1. [sim=...]"`), update them to match the new shape: `[id=<short> sim=<sim>]`.

- [ ] **Step 5: Run formatter tests to verify they pass**

```
cd agents && pytest tests/test_formatter.py -v
```

Expected: all pass.

### 7b — search_memory migration

- [ ] **Step 6: Write search_memory envelope tests**

Create `agents/tests/test_search_memory_envelope.py`:

```python
# agents/tests/test_search_memory_envelope.py
import pytest
from unittest.mock import MagicMock, patch
from langchain_core.messages import ToolMessage
from app.schemas.agent_io import KbReceipt, ProductReceipt, PastActionReceipt
from app.agents.customer_support import _make_search_memory_tool, _short_id


def _toolcall(args, name="search_memory", id="call_1"):
    return {"name": name, "args": args, "id": id, "type": "tool_call"}


class _Hit:
    def __init__(self, _id, content, sim, **extra):
        self.id = _id
        self.content = content
        self.similarity = sim
        for k, v in extra.items():
            setattr(self, k, v)


@pytest.fixture
def mock_embed_and_session():
    with patch("app.agents.customer_support.embed", return_value=[[0.1] * 16]) as e, \
         patch("app.agents.customer_support.SessionLocal") as s:
        ctx = MagicMock()
        s.return_value.__enter__.return_value = ctx
        yield e, s, ctx


def test_kb_hits_emit_kb_receipts_with_short_ids(mock_embed_and_session):
    _, _, ctx = mock_embed_and_session
    hits = [
        _Hit("kb-pk-aaaaaaaa", "Return within 7 days.", 0.82),
        _Hit("kb-pk-bbbbbbbb", "Refund 14 days.", 0.71),
    ]
    with patch("app.agents.customer_support.memory_repo") as mrepo:
        mrepo.search_kb.return_value = hits
        tool = _make_search_memory_tool("biz_1")
        msg = tool.invoke(_toolcall({"query": "return policy", "kind": "kb"}))
    assert isinstance(msg, ToolMessage)
    assert "[id=" in msg.content
    assert all(isinstance(r, KbReceipt) for r in msg.artifact)
    assert len(msg.artifact) == 2
    # Receipt id matches what the formatter renders
    assert msg.artifact[0].id == _short_id("kb-pk-aaaaaaaa")
    assert msg.artifact[0].chunk_id == "kb-pk-aaaaaaaa"


def test_kb_empty_emits_single_negative_kb_receipt(mock_embed_and_session):
    with patch("app.agents.customer_support.memory_repo") as mrepo:
        mrepo.search_kb.return_value = []
        tool = _make_search_memory_tool("biz_1")
        msg = tool.invoke(_toolcall({"query": "warranty", "kind": "kb"}))
    assert "No results" in msg.content
    assert len(msg.artifact) == 1
    r = msg.artifact[0]
    assert isinstance(r, KbReceipt)
    assert r.id.startswith("none:")
    assert r.chunk_id == "-"


def test_product_hits_emit_product_receipts(mock_embed_and_session):
    hits = [_Hit("prod_1", "Widget", 0.9, productId="prod_1")]
    with patch("app.agents.customer_support.memory_repo") as mrepo:
        mrepo.search_products.return_value = hits
        tool = _make_search_memory_tool("biz_1")
        msg = tool.invoke(_toolcall({"query": "widget", "kind": "product"}))
    assert all(isinstance(r, ProductReceipt) for r in msg.artifact)
    assert msg.artifact[0].id == "prod_1"


def test_past_action_hits_emit_past_action_receipts(mock_embed_and_session):
    hits = [_Hit("pa-pk-cccccccc", "buyer asked refund", 0.75, customerMsg="buyer asked refund")]
    with patch("app.agents.customer_support.memory_repo") as mrepo:
        mrepo.search_past_actions.return_value = hits
        tool = _make_search_memory_tool("biz_1")
        msg = tool.invoke(_toolcall({"query": "refund", "kind": "past_action"}))
    assert all(isinstance(r, PastActionReceipt) for r in msg.artifact)
    assert msg.artifact[0].full_id == "pa-pk-cccccccc"
    assert msg.artifact[0].id == _short_id("pa-pk-cccccccc")


def test_search_memory_db_error_returns_no_receipts(mock_embed_and_session):
    with patch("app.agents.customer_support.memory_repo") as mrepo:
        mrepo.search_kb.side_effect = RuntimeError("vector index down")
        tool = _make_search_memory_tool("biz_1")
        msg = tool.invoke(_toolcall({"query": "x", "kind": "kb"}))
    assert msg.content.startswith("ERROR")
    assert (msg.artifact or []) == []
```

- [ ] **Step 7: Run to verify failure**

```
cd agents && pytest tests/test_search_memory_envelope.py -v
```

Expected: FAIL — `search_memory` still returns plain strings.

- [ ] **Step 8: Migrate search_memory**

In `agents/app/agents/customer_support.py`, replace `_make_search_memory_tool` (currently lines 295-313):

```python
def _make_search_memory_tool(business_id: str):
    @tool(response_format="content_and_artifact")
    def search_memory(query: str, kind: _Lit["kb", "product", "past_action"]) -> tuple[str, list]:
        """Search business memory for context outside of the live conversation.
        Args:
            query: what to search for (buyer's phrasing or a paraphrase)
            kind: "kb" (FAQ/policy docs), "product" (fuzzy product match), or "past_action" (similar past buyer messages)
        Returns a numbered list of top matches with similarity scores, or "No results".
        """
        from app.schemas.agent_io import KbReceipt, ProductReceipt, PastActionReceipt
        try:
            q_vec = embed([query])[0]
            with SessionLocal() as session:
                if kind == "kb":
                    hits = memory_repo.search_kb(session, business_id, q_vec, k=5, min_sim=0.6)
                elif kind == "product":
                    hits = memory_repo.search_products(session, business_id, q_vec, k=5, min_sim=0.5)
                else:
                    hits = memory_repo.search_past_actions(session, business_id, q_vec, k=3, min_sim=0.7)
            text = format_search_results(kind, hits, query=query)
            receipts = _build_memory_receipts(kind, hits, query)
            return _safe_tool_return(text, receipts)
        except Exception as e:
            return _error_tool_return(str(e))
    return search_memory


def _build_memory_receipts(kind: str, hits, query: str) -> list:
    """Build receipts mirroring what format_search_results renders."""
    from app.schemas.agent_io import KbReceipt, ProductReceipt, PastActionReceipt

    hits = list(hits)
    if not hits:
        none_id = f"none:{_query_hash8(query)}"
        if kind == "kb":
            return [KbReceipt(id=none_id, chunk_id="-", sim=0.0)]
        if kind == "product":
            return [ProductReceipt(id=none_id)]
        # past_action
        return [PastActionReceipt(id=none_id, full_id="-", sim=0.0)]

    raw_ids = [str(getattr(h, "id", "")) for h in hits]
    # Match the formatter's collision-bump width.
    width = 8 if len({_short_id(r, 8) for r in raw_ids}) == len(raw_ids) else 12

    receipts = []
    for h, raw in zip(hits, raw_ids):
        sim = float(getattr(h, "similarity", 0.0))
        if kind == "kb":
            receipts.append(KbReceipt(id=_short_id(raw, width), chunk_id=raw, sim=sim))
        elif kind == "product":
            # Product receipts use the product id directly (already short and stable).
            pid = str(getattr(h, "productId", raw))
            receipts.append(ProductReceipt(id=pid))
        else:
            receipts.append(PastActionReceipt(id=_short_id(raw, width), full_id=raw, sim=sim))
    return receipts
```

Update the LLM-facing rules block in `customer_support.py:202-209` to teach citation by short id. Find the lines starting `Rules for facts_used:` and ending `... add that product's {{"kind":"product","id":"<id>"}}.` Replace the whole block with:

```
Rules for facts_used:
- If you call create_payment_link, add {{"kind":"product","id":"<product_id>"}}.
- If you call check_order_status, add {{"kind":"order","id":"<order_id>"}} for each order you reference. If the tool returns "no orders found for this phone", cite {{"kind":"order","id":"none:<digits-only phone>"}} — that is the citable negative.
- If you quote a product price or stock number, add that product's {{"kind":"product","id":"<id>"}}.
- If you reference content from search_memory, copy the [id=<short>] marker into facts_used as {{"kind":"<kind>","id":"<short>"}}. For kind="past_action", use {{"kind":"memory:past_action","id":"<short>"}}. For empty results, cite the [id=none:<hash>] marker — that grounds "I checked, found nothing".
```

Also update the duplicate JSON shape comment near `customer_support.py:444` if it references kinds. Search:

```
cd agents && grep -n '"kind":"product|order|kb|memory"' app/agents/customer_support.py
```

For each hit, extend the kind union to `product|order|kb|memory|memory:past_action|payment_link`.

- [ ] **Step 9: Run search_memory tests**

```
cd agents && pytest tests/test_search_memory_envelope.py tests/test_formatter.py -v
```

Expected: all pass.

- [ ] **Step 10: Full regression**

```
cd agents && pytest -v
```

Expected: all green.

- [ ] **Step 11: Commit**

```bash
git add agents/app/memory/formatter.py agents/app/agents/customer_support.py agents/tests/test_search_memory_envelope.py agents/tests/test_formatter.py
git commit -m "feat(memory): formatter surfaces short ids; search_memory emits grounding receipts"
```

---

## Task 8: E2E reproduction — screenshot scenario stops escalating

**Files:**
- Modify: `agents/tests/test_manager_e2e.py`

- [ ] **Step 1: Inspect existing e2e structure**

```
cd agents && grep -n "def test_\|monkeypatch\|_load_shared_context_impl\|fake_jual\|stub" tests/test_manager_e2e.py | head -30
```

Note the patterns the file uses for stubbing the Jual subgraph and shared context. Match them.

- [ ] **Step 2: Add failing e2e test**

Append a test that reproduces the screenshot scenario. The exact stub shape depends on what's already there; the assertion shape is fixed:

```python
@pytest.mark.asyncio
async def test_negative_order_lookup_does_not_escalate(monkeypatch):
    """Screenshot reproduction: buyer asks 'ada saya beli barang ke harini?',
    order tool returns no rows, Jual cites the citable negative,
    manager auto-sends instead of escalating."""
    from app.agents.manager import build_manager_graph, _load_shared_context_impl
    from app.schemas.agent_io import StructuredReply, FactRef, OrderReceipt
    from langchain_core.messages import HumanMessage, AIMessage, ToolMessage

    # Stub shared-context loader: just one product, plus the snapshot fields.
    def _fake_load(state):
        valid_ids = {"product:p1"}
        return {
            "business_context": "Business: Test",
            "memory_block": "",
            "valid_fact_ids": valid_ids,
            "preloaded_fact_ids": set(valid_ids),
            "last_harvested_msg_index": 0,
        }
    monkeypatch.setattr(
        "app.agents.manager._load_shared_context_impl",
        _fake_load,
    )

    # Stub jual_graph.ainvoke: simulate a tool call landing in messages and a
    # draft that cites the negative receipt id.
    phone_key = "60123456789"
    fake_tool_msg = ToolMessage(
        content="no orders found for this phone",
        tool_call_id="call_x",
    )
    fake_tool_msg.artifact = [OrderReceipt(id=f"none:{phone_key}")]
    fake_draft = StructuredReply(
        reply="Tiada, saya tidak jumpa sebarang pesanan untuk nombor anda.",
        confidence=0.9,
        reasoning="Order lookup returned empty; cited negative.",
        facts_used=[FactRef(kind="order", id=f"none:{phone_key}")],
    )

    class _FakeJualGraph:
        async def ainvoke(self, sub_state):
            new_msgs = list(sub_state["messages"]) + [
                AIMessage(content="(tool call)"),
                fake_tool_msg,
            ]
            return {
                "messages": new_msgs,
                "draft_reply": fake_draft.reply,
                "structured_reply": fake_draft,
                "confidence": fake_draft.confidence,
                "reasoning": fake_draft.reasoning,
            }

    monkeypatch.setattr(
        "app.agents.manager.build_customer_support_agent",
        lambda llm: _FakeJualGraph(),
    )

    # Stub manager_llm — Gate path will short-circuit before LLM evaluator.
    class _NopLLM:
        def with_structured_output(self, *_a, **_k):
            return self
        async def ainvoke(self, *_a, **_k):
            raise AssertionError("LLM should not be called when gates pass")

    graph = build_manager_graph(jual_llm=_NopLLM(), manager_llm=_NopLLM())
    result = await graph.ainvoke({
        "business_id": "biz_1",
        "customer_phone": "+60 12-345 6789",
        "messages": [HumanMessage(content="ada saya beli barang ke harini?")],
        "iterations": [],
    })

    assert result.get("final_action") == "auto_send", \
        f"expected auto_send, got {result.get('final_action')} reason={result.get('verdict')}"
```

If the surrounding test file uses different stubbing helpers (e.g. a shared `_run_graph` fixture), adapt to match — keep the assertion `final_action == "auto_send"`.

- [ ] **Step 3: Run the new test**

```
cd agents && pytest tests/test_manager_e2e.py::test_negative_order_lookup_does_not_escalate -v
```

Expected: PASS.

- [ ] **Step 4: Run all e2e**

```
cd agents && pytest tests/test_manager_e2e.py -v
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add agents/tests/test_manager_e2e.py
git commit -m "test(e2e): negative order lookup auto-sends instead of escalating"
```

---

## Task 9: Final regression + manual smoke

- [ ] **Step 1: Full backend test sweep**

```
cd agents && pytest -v
```

Expected: all green.

- [ ] **Step 2: Manual smoke (live agent dashboard)**

From repo root:

```
./scripts/dev.sh env
./scripts/dev.sh up
```

Open the dashboard, send buyer message "saya ada beli apa-apa ke harini?" against a phone with no orders. Verify in the activity feed:

- `[customer_support]` calls `check_order_status`.
- `[manager_evaluator]` does NOT emit `ungrounded_fact:order:no orders found`.
- Outcome is `auto_send`, not `escalate`.

If escalation still occurs, capture the full event chain (gate slug + facts_used) and triage before merging.

- [ ] **Step 3: No commit (smoke only). If smoke surfaces issues, fix in-place and amend the relevant earlier commit's follow-up.**

---

## Self-Review Checklist

**Spec coverage:**
- §1 Envelope schema → Task 1.
- §2 Tool signature + error-receipt rule + invocation loop → Tasks 4, 5, 7.
- §3 Formatter + short-id derivation → Task 7a.
- §4 Harvest node + state additions → Tasks 2, 3.
- §5 Gate behavior split → Task 6.
- §6 Test plan items → Tasks 1, 3, 5, 6, 7, 8 (each test enumerated in §6 has a corresponding test step).
- §7 Rollout order → Tasks 1–7 in spec-defined order; bundled step 7 honored.
- §8 Future work → not implemented (out of scope, by design).

**Placeholder scan:** none.

**Type/name consistency check:**
- `_phone_key` defined in Task 5, used by Task 5 (tool) and Task 8 (e2e stub builds the same `none:60123456789` id directly).
- `_short_id` defined in Task 5, used by Tasks 5, 7 (formatter helper inlines its own equivalent — same sha1[:8] derivation; verified identical).
- `GroundingReceipt` symbols (`OrderReceipt`, `KbReceipt`, etc.) defined in Task 1, imported in Tasks 3, 5, 7, 8.
- `run_gates` `preloaded_fact_ids` kwarg added in Task 6, populated by Task 2's state additions, passed by Task 6's evaluator update.
- `harvest_receipts` node name consistent across Task 3 wiring + future references.
