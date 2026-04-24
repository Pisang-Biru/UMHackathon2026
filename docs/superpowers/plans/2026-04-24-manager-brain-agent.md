# Manager Brain Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Manager supervisor agent that evaluates Jual's (customer_support) draft with mechanical gates + discrete LLM verdict, runs one bounded revision pass, falls back to text-only rewrite, and escalates to human only when needed.

**Architecture:** Nested LangGraph — Manager graph wraps `customer_support` as a subgraph. Manager state carries an `iterations` audit trail persisted as JSONB on `AgentAction`. Routing uses discrete verdicts (`pass|revise|rewrite|escalate`), never float confidence. Feature-flagged via `MANAGER_ENABLED`.

**Tech Stack:** Python, FastAPI, LangGraph, LangChain, SQLAlchemy, Alembic (Postgres JSONB), pytest. Frontend: TanStack Router, React, Vitest.

**Spec:** `docs/superpowers/specs/2026-04-24-manager-brain-agent-design.md`

**Naming note:** Spec references `HUMAN_SENT` enum status. Existing code uses `APPROVED` for the human-sent path. This plan **keeps `APPROVED`** (no enum migration) — semantics match ("human approved reply goes out").

---

## Task 1: Pydantic schemas module

**Files:**
- Create: `agents/app/schemas/__init__.py`
- Create: `agents/app/schemas/agent_io.py`
- Create: `agents/tests/test_agent_io_schemas.py`

- [ ] **Step 1: Write failing test**

```python
# agents/tests/test_agent_io_schemas.py
from app.schemas.agent_io import (
    FactRef, StructuredReply, ManagerCritique, ManagerVerdict, IterationEntry,
)


def test_fact_ref_requires_kind_and_id():
    f = FactRef(kind="product", id="p_123")
    assert f.kind == "product" and f.id == "p_123"


def test_structured_reply_defaults():
    r = StructuredReply(reply="hi")
    assert r.confidence == 0.5
    assert r.reasoning == ""
    assert r.addressed_questions == []
    assert r.unaddressed_questions == []
    assert r.facts_used == []
    assert r.needs_human is False


def test_structured_reply_full_payload():
    r = StructuredReply(
        reply="ok",
        confidence=0.9,
        reasoning="direct",
        addressed_questions=["price?"],
        unaddressed_questions=[],
        facts_used=[{"kind": "product", "id": "p1"}],
        needs_human=False,
    )
    assert r.facts_used[0].kind == "product"


def test_manager_verdict_critique_optional():
    v = ManagerVerdict(verdict="pass", reason="all good")
    assert v.critique is None

    v2 = ManagerVerdict(
        verdict="revise",
        critique=ManagerCritique(missing_facts=["diabetic mom"]),
        reason="missing context",
    )
    assert v2.critique.missing_facts == ["diabetic mom"]


def test_iteration_entry_json_round_trip():
    e = IterationEntry(
        stage="jual_v1",
        draft=StructuredReply(reply="hi"),
        verdict=ManagerVerdict(verdict="pass", reason="ok"),
        gate_results={"passed": True},
        latency_ms=120,
    )
    payload = e.model_dump(mode="json")
    assert payload["stage"] == "jual_v1"
    restored = IterationEntry.model_validate(payload)
    assert restored.draft.reply == "hi"
    assert restored.verdict.verdict == "pass"


def test_manager_critique_fields_all_default_empty():
    c = ManagerCritique()
    assert c.missing_facts == [] and c.incorrect_claims == []
    assert c.tone_issues == [] and c.unanswered_questions == []
    assert c.keep_from_draft == []
```

- [ ] **Step 2: Run test — expected FAIL (import error, module missing)**

Run: `cd agents && pytest tests/test_agent_io_schemas.py -v`
Expected: `ModuleNotFoundError: No module named 'app.schemas'`

- [ ] **Step 3: Create package marker**

```python
# agents/app/schemas/__init__.py
```

Empty file.

- [ ] **Step 4: Implement schemas module**

```python
# agents/app/schemas/agent_io.py
from typing import Literal
from pydantic import BaseModel, Field


class FactRef(BaseModel):
    """Identity key is (kind, id). Gate check uses f'{kind}:{id}' composite."""
    kind: Literal["product", "order", "kb", "memory"]
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
```

- [ ] **Step 5: Run tests — expected PASS**

Run: `cd agents && pytest tests/test_agent_io_schemas.py -v`
Expected: 6 passed.

- [ ] **Step 6: Commit**

```bash
git add agents/app/schemas/__init__.py agents/app/schemas/agent_io.py agents/tests/test_agent_io_schemas.py
git commit -m "feat(schemas): add agent_io Pydantic models for Manager + Jual"
```

---

## Task 2: Alembic migration for iterations column

**Files:**
- Create: `agents/alembic/versions/0002_agent_action_iterations.py`

- [ ] **Step 1: Write migration**

```python
# agents/alembic/versions/0002_agent_action_iterations.py
"""add iterations JSONB column to agent_action

Revision ID: 0002
Revises: 0001
Create Date: 2026-04-24
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "agent_action",
        sa.Column(
            "iterations",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )


def downgrade():
    op.drop_column("agent_action", "iterations")
```

- [ ] **Step 2: Run migration against dev DB**

Run: `cd agents && alembic upgrade head`
Expected: `Running upgrade 0001 -> 0002, add iterations JSONB column to agent_action`

- [ ] **Step 3: Verify column exists**

Run:
```bash
docker compose exec postgres psql -U postgres -d postgres -c "\d agent_action" | grep iterations
```
Expected: `iterations | jsonb | not null default '[]'::jsonb`

If docker compose isn't available, inspect via whatever psql is reachable.

- [ ] **Step 4: Commit**

```bash
git add agents/alembic/versions/0002_agent_action_iterations.py
git commit -m "feat(db): add iterations JSONB column to agent_action"
```

---

## Task 3: Add iterations column to ORM model

**Files:**
- Modify: `agents/app/db.py`

- [ ] **Step 1: Write failing test**

```python
# agents/tests/test_agent_action_iterations_column.py
from app.db import AgentAction


def test_agent_action_has_iterations_column():
    cols = {c.name for c in AgentAction.__table__.columns}
    assert "iterations" in cols


def test_iterations_is_jsonb_nullable_false():
    col = AgentAction.__table__.c.iterations
    assert col.nullable is False
```

- [ ] **Step 2: Run test — expected FAIL**

Run: `cd agents && pytest tests/test_agent_action_iterations_column.py -v`
Expected: `AssertionError: assert 'iterations' in {...}`

- [ ] **Step 3: Add column to model**

Edit `agents/app/db.py`. Add to imports:

```python
from sqlalchemy.dialects.postgresql import JSONB
```

Add to the `AgentAction` class (after `updatedAt`):

```python
    iterations = Column(JSONB, nullable=False, server_default=sa.text("'[]'::jsonb"))
```

Also add to imports at top of `db.py`:

```python
from sqlalchemy import text as _sa_text
```

Actually simpler — import `text` alongside existing imports. Final imports block (replace existing line 2):

```python
from sqlalchemy import (
    create_engine, Column, String, Float, Integer, Text, DateTime,
    Enum as SAEnum, Numeric, text,
)
```

Column becomes:

```python
    iterations = Column(JSONB, nullable=False, server_default=text("'[]'::jsonb"))
```

- [ ] **Step 4: Run test — expected PASS**

Run: `cd agents && pytest tests/test_agent_action_iterations_column.py -v`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add agents/app/db.py agents/tests/test_agent_action_iterations_column.py
git commit -m "feat(db): map iterations JSONB column on AgentAction ORM model"
```

---

## Task 4: Shared message-extraction utility

**Files:**
- Create: `agents/app/utils/__init__.py`
- Create: `agents/app/utils/messages.py`
- Create: `agents/tests/test_utils_messages.py`

- [ ] **Step 1: Write failing tests**

```python
# agents/tests/test_utils_messages.py
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
```

- [ ] **Step 2: Run tests — expected FAIL**

Run: `cd agents && pytest tests/test_utils_messages.py -v`
Expected: `ModuleNotFoundError: No module named 'app.utils'`

- [ ] **Step 3: Create package + module**

```python
# agents/app/utils/__init__.py
```

Empty file.

```python
# agents/app/utils/messages.py
from langchain_core.messages import BaseMessage, HumanMessage


def last_buyer_text(messages: list[BaseMessage]) -> str:
    if not messages:
        return ""
    for msg in reversed(messages):
        if isinstance(msg, HumanMessage) and isinstance(msg.content, str):
            return msg.content
    return ""
```

- [ ] **Step 4: Run tests — expected PASS**

Run: `cd agents && pytest tests/test_utils_messages.py -v`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add agents/app/utils/__init__.py agents/app/utils/messages.py agents/tests/test_utils_messages.py
git commit -m "feat(utils): add last_buyer_text shared helper"
```

---

## Task 5: Jual — import schema, emit structural fields

**Files:**
- Modify: `agents/app/agents/customer_support.py`
- Modify: `agents/tests/test_json_parsing.py`

- [ ] **Step 1: Write failing test**

```python
# agents/tests/test_jual_structured_reply_shape.py
from app.schemas.agent_io import StructuredReply, FactRef


def test_customer_support_reexports_structured_reply_from_schemas():
    # Jual must use the shared schema, not a local one.
    from app.agents import customer_support as cs
    assert cs.StructuredReply is StructuredReply


def test_structured_reply_accepts_new_fields_from_jual():
    # Simulates what Jual's prompt will produce.
    raw = {
        "reply": "RM15 ada stock",
        "confidence": 0.92,
        "reasoning": "from product list",
        "addressed_questions": ["harga?"],
        "unaddressed_questions": [],
        "facts_used": [{"kind": "product", "id": "p_001"}],
        "needs_human": False,
    }
    sr = StructuredReply.model_validate(raw)
    assert sr.facts_used[0] == FactRef(kind="product", id="p_001")
```

- [ ] **Step 2: Run test — expected FAIL**

Run: `cd agents && pytest tests/test_jual_structured_reply_shape.py -v`
Expected: `AssertionError: assert <class 'app.agents.customer_support.StructuredReply'> is <class 'app.schemas.agent_io.StructuredReply'>`

- [ ] **Step 3: Replace local `StructuredReply` with import in `customer_support.py`**

In `agents/app/agents/customer_support.py`:

Delete lines 32-35 (local `StructuredReply` class).

Add after existing `from app.memory.formatter import ...` imports:

```python
from app.schemas.agent_io import StructuredReply, FactRef, ManagerCritique
```

- [ ] **Step 4: Rewrite `SYSTEM_TEMPLATE` JSON schema block**

Replace `SYSTEM_TEMPLATE` (lines 167-200) with:

```python
SYSTEM_TEMPLATE = """\
You are a helpful customer support agent for a seller.

{context}

{memory_block}

Your job:
- Answer buyer questions accurately using ONLY the info above, plus what tools return
- Be friendly and concise
- Reply in the same language the buyer uses (Malay or English)
- If you are unsure about anything, say so honestly — never fabricate stock or prices

Purchase flow:
- If the buyer clearly wants to purchase a specific product and quantity, call the create_payment_link tool with the product id and quantity.
- After the tool returns a URL, include that URL verbatim in your reply.
- Never invent a payment URL.

Order status flow:
- If the buyer asks about past purchases, existing orders, or whether a payment succeeded, call check_order_status (no arguments — it knows the current buyer).
- Report what the tool returns. Do not guess.

After any tool calls, respond with valid JSON only, no other text:
{{
  "reply": "<your reply to the buyer (include payment URL when a link was generated)>",
  "confidence": <float 0.0-1.0>,
  "reasoning": "<one sentence explaining your confidence>",
  "addressed_questions": ["<buyer question you answered>", ...],
  "unaddressed_questions": ["<buyer question you did NOT answer, verbatim>", ...],
  "facts_used": [{{"kind": "product|order|kb|memory", "id": "<id>"}}, ...],
  "needs_human": <true only if refund / complaint / out-of-scope, else false>
}}

Rules for facts_used:
- If you call create_payment_link, add {{"kind":"product","id":"<product_id>"}}.
- If you call check_order_status, add {{"kind":"order","id":"<order_id>"}} for each order you reference.
- If you quote a product price or stock number, add that product's {{"kind":"product","id":"<id>"}}.

Confidence guide (for telemetry only, not routing):
- 0.9+   : Direct factual answer from product data or tool output
- 0.7-0.9: Reasonable inference
- <0.7   : Uncertain / info missing / sensitive topic
"""
```

- [ ] **Step 5: Run test — expected PASS**

Run: `cd agents && pytest tests/test_jual_structured_reply_shape.py tests/test_json_parsing.py -v`
Expected: `test_jual_structured_reply_shape.py` — 2 passed. `test_json_parsing.py` — must still pass (existing parse helpers unchanged).

- [ ] **Step 6: Commit**

```bash
git add agents/app/agents/customer_support.py agents/tests/test_jual_structured_reply_shape.py
git commit -m "feat(agent): Jual imports StructuredReply from schemas, emits structural fields"
```

---

## Task 6: Jual — state additions, entry router, redraft_reply node

**Files:**
- Modify: `agents/app/agents/customer_support.py`
- Create: `agents/tests/test_redraft_mode.py`

- [ ] **Step 1: Write failing test**

```python
# agents/tests/test_redraft_mode.py
import pytest
from unittest.mock import AsyncMock
from langchain_core.messages import HumanMessage
from app.schemas.agent_io import StructuredReply, ManagerCritique, FactRef
from app.agents.customer_support import build_customer_support_agent


class _FakeLLM:
    def __init__(self, structured_response):
        self._structured_response = structured_response

    def bind_tools(self, tools):
        return self

    def with_structured_output(self, schema):
        llm = self
        class _Wrapped:
            async def ainvoke(self, messages):
                return llm._structured_response
        return _Wrapped()

    async def ainvoke(self, messages):
        raise RuntimeError("redraft should use with_structured_output")


@pytest.mark.asyncio
async def test_redraft_mode_skips_context_and_memory_loading(monkeypatch):
    # If load_context or load_memory ran, they'd touch the DB — force them to raise.
    import app.agents.customer_support as cs
    monkeypatch.setattr(cs, "_build_context", lambda bid: (_ for _ in ()).throw(AssertionError("load_context ran")))
    monkeypatch.setattr(cs, "_load_memory_node", AsyncMock(side_effect=AssertionError("load_memory ran")))

    fake = _FakeLLM(StructuredReply(
        reply="revised reply",
        confidence=0.85,
        reasoning="addressed critique",
        addressed_questions=["harga?"],
        facts_used=[FactRef(kind="product", id="p1")],
    ))
    graph = build_customer_support_agent(fake)

    state = {
        "messages": [HumanMessage(content="berapa harga?")],
        "business_id": "biz1",
        "customer_id": "c1",
        "customer_phone": "60123",
        "business_context": "Business: Test\nProducts:\n- [p1] Foo: RM10, 5 in stock",
        "memory_block": "",
        "draft_reply": "",
        "confidence": 0.0,
        "reasoning": "",
        "revision_mode": "redraft",
        "previous_draft": StructuredReply(reply="previous"),
        "critique": ManagerCritique(missing_facts=["mention stock"]),
    }
    result = await graph.ainvoke(state)
    assert result["draft_reply"] == "revised reply"
    assert result["confidence"] == 0.85


@pytest.mark.asyncio
async def test_draft_mode_still_loads_context(monkeypatch):
    import app.agents.customer_support as cs

    loads = {"context": 0}

    def _fake_build_context(bid):
        loads["context"] += 1
        return "Business: Test\nProducts:\n- [p1] Foo: RM10, 5 in stock"

    monkeypatch.setattr(cs, "_build_context", _fake_build_context)

    class _DraftFake:
        def bind_tools(self, tools): return self
        async def ainvoke(self, history):
            from langchain_core.messages import AIMessage
            return AIMessage(content='{"reply":"hi","confidence":0.9,"reasoning":"ok","addressed_questions":[],"unaddressed_questions":[],"facts_used":[],"needs_human":false}')

    graph = build_customer_support_agent(_DraftFake())
    state = {
        "messages": [HumanMessage(content="hi")],
        "business_id": "biz1",
        "customer_id": "c1",
        "customer_phone": "",
        "business_context": "",
        "memory_block": "",
        "draft_reply": "",
        "confidence": 0.0,
        "reasoning": "",
        "revision_mode": "draft",
        "previous_draft": None,
        "critique": None,
    }
    await graph.ainvoke(state)
    assert loads["context"] == 1
```

- [ ] **Step 2: Run tests — expected FAIL**

Run: `cd agents && pytest tests/test_redraft_mode.py -v`
Expected: graph raises / state keys missing for `revision_mode`.

- [ ] **Step 3: Add state fields, entry router, redraft_reply**

Edit `agents/app/agents/customer_support.py`:

Update `SupportAgentState` (lines 38-49) to add new fields and drop `action`/`action_id`:

```python
class SupportAgentState(TypedDict, total=False):
    messages: Annotated[list[BaseMessage], add_messages]
    business_context: str
    business_id: str
    customer_id: str
    customer_phone: str
    memory_block: str
    draft_reply: str
    confidence: float
    reasoning: str
    structured_reply: StructuredReply | None
    revision_mode: Literal["draft", "redraft"]
    previous_draft: StructuredReply | None
    critique: ManagerCritique | None
```

(Note: `total=False` so Manager can pass partial state when invoking as subgraph without having to provide every field.)

In `build_customer_support_agent` (near the other node definitions), add:

```python
    async def redraft_reply(state: SupportAgentState) -> dict:
        prev = state.get("previous_draft")
        critique = state.get("critique")
        if prev is None or critique is None:
            raise ValueError("redraft_reply requires previous_draft and critique in state")

        system_prompt = SYSTEM_TEMPLATE.format(
            context=state.get("business_context", ""),
            memory_block=state.get("memory_block", ""),
        )
        revision_instruction = SystemMessage(content=(
            "You are revising your previous reply based on Manager feedback. "
            "Produce a corrected reply that addresses ALL of the following:\n\n"
            f"Previous reply:\n{prev.reply}\n\n"
            f"Missing facts to add: {critique.missing_facts}\n"
            f"Incorrect claims to remove/correct: {critique.incorrect_claims}\n"
            f"Tone issues to fix: {critique.tone_issues}\n"
            f"Questions still unanswered: {critique.unanswered_questions}\n"
            f"Keep from the previous draft: {critique.keep_from_draft}\n\n"
            "Respond with the same JSON schema as before. Emit JSON only."
        ))
        history = [SystemMessage(content=system_prompt), *state["messages"], revision_instruction]
        response = await llm.with_structured_output(StructuredReply).ainvoke(history)
        return {
            "structured_reply": response,
            "draft_reply": response.reply,
            "confidence": response.confidence,
            "reasoning": response.reasoning,
        }

    def _entry_route(state: SupportAgentState) -> Literal["load_context", "redraft_reply"]:
        return "redraft_reply" if state.get("revision_mode") == "redraft" else "load_context"
```

Replace the graph assembly block (lines 515-534) with:

```python
    graph = StateGraph(SupportAgentState)
    graph.add_node("load_context", load_context)
    graph.add_node("load_memory", _load_memory_node)
    graph.add_node("draft_reply", draft_reply)
    graph.add_node("redraft_reply", redraft_reply)

    graph.add_conditional_edges(START, _entry_route, {
        "load_context": "load_context",
        "redraft_reply": "redraft_reply",
    })
    graph.add_edge("load_context", "load_memory")
    graph.add_edge("load_memory", "draft_reply")
    graph.add_edge("draft_reply", END)
    graph.add_edge("redraft_reply", END)

    return graph.compile()
```

Also delete the now-unused `route_decision`, `auto_send`, `queue_approval` inner functions and the `_route_edge` helper (lines 471-513).

- [ ] **Step 4: Run tests — expected PASS**

Run: `cd agents && pytest tests/test_redraft_mode.py -v`
Expected: 2 passed.

- [ ] **Step 5: Update existing router wiring that depends on removed state keys**

Since `customer_support` no longer writes `action` / `action_id`, `agents/app/routers/support.py` will break. Temporarily keep existing router working by adding a wrapper that provides defaults. Task 14 fully swaps the router — for now, adapt `_support_graph_ainvoke` caller at `support.py:72-97` to handle absent keys:

Edit `support.py:72-97`:

```python
    @router.post("/support/chat", response_model=SupportChatResponse)
    async def support_chat(req: SupportChatRequest):
        try:
            result = await _support_graph_ainvoke({
                "messages": [HumanMessage(content=req.message)],
                "business_id": req.business_id,
                "customer_id": req.customer_id,
                "customer_phone": normalize_phone(req.customer_phone) if req.customer_phone else "",
                "memory_block": "",
                "business_context": "",
                "draft_reply": "",
                "confidence": 0.0,
                "reasoning": "",
                "revision_mode": "draft",
            })
            # Manager-less fallback: auto-send if confidence >= 0.8, else queue.
            # This preserves behavior until Task 14 swaps in the Manager graph.
            from app.db import SessionLocal, AgentAction, AgentActionStatus
            from cuid2 import Cuid as _Cuid
            action_id = _Cuid().generate()
            confidence = result.get("confidence", 0.0)
            draft = result.get("draft_reply", "")
            reasoning = result.get("reasoning", "")
            customer_msg = req.message
            should_auto = confidence >= 0.8
            status = AgentActionStatus.AUTO_SENT if should_auto else AgentActionStatus.PENDING
            with SessionLocal() as session:
                record = AgentAction(
                    id=action_id,
                    businessId=req.business_id,
                    customerMsg=customer_msg,
                    draftReply=draft,
                    finalReply=draft if should_auto else None,
                    confidence=confidence,
                    reasoning=reasoning,
                    status=status,
                )
                session.add(record)
                session.commit()
            if should_auto:
                _enqueue_past_action(action_id)
                return SupportChatResponse(status="sent", reply=draft, action_id=action_id, confidence=confidence)
            return SupportChatResponse(status="pending_approval", action_id=action_id, confidence=confidence)
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))
```

- [ ] **Step 6: Run full agents test suite — nothing new should fail**

Run: `cd agents && pytest tests/ -v`
Expected: all tests pass (prior tests may need no changes; if `test_router_memory.py` or similar relied on `action`/`action_id` in the state dict, update those tests to stop asserting on those keys and start asserting on `draft_reply` + a new DB row).

- [ ] **Step 7: Commit**

```bash
git add agents/app/agents/customer_support.py agents/app/routers/support.py agents/tests/test_redraft_mode.py
git commit -m "feat(agent): Jual adds revision_mode + redraft_reply node, removes terminal action logic"
```

---

## Task 7: Jual — drop NL fallback, synthesize needs_human on parse failure

**Files:**
- Modify: `agents/app/agents/customer_support.py`
- Modify: `agents/tests/test_json_parsing.py`

- [ ] **Step 1: Write failing test**

```python
# agents/tests/test_parse_failure_escalation.py
import pytest
from unittest.mock import AsyncMock
from langchain_core.messages import HumanMessage, AIMessage
from app.agents.customer_support import build_customer_support_agent


class _UnparseableLLM:
    def bind_tools(self, tools): return self
    async def ainvoke(self, history):
        return AIMessage(content="this is not JSON at all")


@pytest.mark.asyncio
async def test_parse_failure_produces_needs_human_draft(monkeypatch):
    import app.agents.customer_support as cs
    monkeypatch.setattr(cs, "_build_context", lambda bid: "Business: Test")

    graph = build_customer_support_agent(_UnparseableLLM())
    state = {
        "messages": [HumanMessage(content="what?")],
        "business_id": "biz1",
        "customer_id": "c1",
        "customer_phone": "",
        "memory_block": "",
        "business_context": "",
        "draft_reply": "",
        "confidence": 0.0,
        "reasoning": "",
        "revision_mode": "draft",
    }
    result = await graph.ainvoke(state)
    sr = result["structured_reply"]
    assert sr.needs_human is True
    assert "JSON parsing failed" in sr.reasoning.lower() or "human" in sr.reply.lower()
```

- [ ] **Step 2: Run test — expected FAIL**

Run: `cd agents && pytest tests/test_parse_failure_escalation.py -v`
Expected: current code raises `ValueError("JSON retry and NL fallback both failed...")`.

- [ ] **Step 3: Rewrite fallback path**

In `agents/app/agents/customer_support.py`, replace the block at lines 425-469 (the try/except around json_retry + nl_fallback) with:

```python
        json_retry_instruction = SystemMessage(content=(
            "Produce the final reply as a single JSON object matching this schema:\n"
            '{"reply": "<text>", "confidence": <float>, "reasoning": "<sentence>", '
            '"addressed_questions": [...], "unaddressed_questions": [...], '
            '"facts_used": [{"kind":"product|order|kb|memory","id":"<id>"}], '
            '"needs_human": <bool>}\n'
            "Output ONLY the JSON object. No markdown fences, no prose before or after."
        ))
        try:
            response = await llm.ainvoke(history + [json_retry_instruction])
            retry_text = response.content if isinstance(response.content, str) else ""
            retry_parsed = _try_parse_json_reply(retry_text)
            if retry_parsed is not None:
                return {
                    "structured_reply": retry_parsed,
                    "draft_reply": retry_parsed.reply,
                    "confidence": float(retry_parsed.confidence),
                    "reasoning": retry_parsed.reasoning,
                }
        except Exception as e:
            _log.warning("JSON retry raised: %s", e)

        _log.warning("JSON parse failed twice; synthesizing needs_human draft")
        fallback = StructuredReply(
            reply="Sorry, I need someone to look at this properly. A human will reply shortly.",
            confidence=0.0,
            reasoning="JSON parsing failed twice",
            needs_human=True,
        )
        return {
            "structured_reply": fallback,
            "draft_reply": fallback.reply,
            "confidence": 0.0,
            "reasoning": fallback.reasoning,
        }
```

Also: in the happy path (direct parse success at lines 417-423), add `structured_reply` to the return:

```python
        direct = _try_parse_json_reply(last_text)
        if direct is not None:
            return {
                "structured_reply": direct,
                "draft_reply": direct.reply,
                "confidence": float(direct.confidence),
                "reasoning": direct.reasoning,
            }
```

- [ ] **Step 4: Delete NL fallback helpers**

Remove from `customer_support.py`:
- `_NL_REPLY_RE` regex (lines 303-306)
- `_try_parse_nl_reply` function (lines 335-357)

- [ ] **Step 5: Update existing NL-fallback tests**

Open `agents/tests/test_json_parsing.py`. Remove any test named like `test_nl_fallback_*` or asserting on `_try_parse_nl_reply`. Keep JSON-parse tests.

- [ ] **Step 6: Run tests — expected PASS**

Run: `cd agents && pytest tests/test_parse_failure_escalation.py tests/test_json_parsing.py -v`
Expected: all pass, including the new escalation test.

- [ ] **Step 7: Commit**

```bash
git add agents/app/agents/customer_support.py agents/tests/test_json_parsing.py agents/tests/test_parse_failure_escalation.py
git commit -m "refactor(agent): drop NL fallback; parse failure yields needs_human draft"
```

---

## Task 8: Manager gates module

**Files:**
- Create: `agents/app/agents/manager_gates.py`
- Create: `agents/tests/test_manager_gates.py`

- [ ] **Step 1: Write failing tests**

```python
# agents/tests/test_manager_gates.py
from langchain_core.messages import HumanMessage
from app.schemas.agent_io import StructuredReply, FactRef
from app.agents.manager_gates import run_gates


def _draft(**kwargs):
    defaults = dict(reply="ok", confidence=0.8, reasoning="r")
    defaults.update(kwargs)
    return StructuredReply(**defaults)


def _msgs(text): return [HumanMessage(content=text)]


def test_gate1_needs_human_flag_escalates():
    d = _draft(needs_human=True)
    r = run_gates(d, valid_fact_ids=set(), revision_count=0, messages=_msgs("hi"))
    assert r.verdict == "escalate"
    assert r.reason_slug == "jual_self_flagged"


def test_gate2_hallucinated_fact_triggers_rewrite():
    d = _draft(facts_used=[FactRef(kind="product", id="ghost")])
    r = run_gates(d, valid_fact_ids={"product:real"}, revision_count=0, messages=_msgs("harga?"))
    assert r.verdict == "rewrite"
    assert r.reason_slug.startswith("ungrounded_fact:product:ghost")


def test_gate3_unaddressed_first_pass_revises():
    d = _draft(unaddressed_questions=["shipping?"])
    r = run_gates(d, valid_fact_ids=set(), revision_count=0, messages=_msgs("q"))
    assert r.verdict == "revise"


def test_gate4_unaddressed_after_revise_rewrites():
    d = _draft(unaddressed_questions=["shipping?"])
    r = run_gates(d, valid_fact_ids=set(), revision_count=1, messages=_msgs("q"))
    assert r.verdict == "rewrite"


def test_gate5a_ungrounded_factual_revises_v1():
    d = _draft(facts_used=[])
    r = run_gates(d, valid_fact_ids=set(), revision_count=0, messages=_msgs("berapa harga ondeh?"))
    assert r.verdict == "revise"
    assert r.reason_slug == "ungrounded_factual_answer"


def test_gate5b_ungrounded_factual_rewrites_v2():
    d = _draft(facts_used=[])
    r = run_gates(d, valid_fact_ids=set(), revision_count=1, messages=_msgs("how much?"))
    assert r.verdict == "rewrite"


def test_precedence_needs_human_beats_hallucinated():
    d = _draft(needs_human=True, facts_used=[FactRef(kind="product", id="ghost")])
    r = run_gates(d, valid_fact_ids=set(), revision_count=0, messages=_msgs("hi"))
    assert r.verdict == "escalate"


def test_all_gates_pass_returns_none_verdict():
    d = _draft(
        facts_used=[FactRef(kind="product", id="real")],
        addressed_questions=["harga?"],
    )
    r = run_gates(d, valid_fact_ids={"product:real"}, revision_count=0, messages=_msgs("harga?"))
    assert r.verdict is None


def test_factual_q_regex_ignores_idioms():
    # "terima kasih ada jumpa lagi" must not match gate 5 via bare "ada"
    d = _draft(facts_used=[])
    r = run_gates(d, valid_fact_ids=set(), revision_count=0, messages=_msgs("terima kasih ada jumpa lagi"))
    assert r.verdict is None   # no factual-Q hit


def test_gate3_critique_populated_on_revise():
    d = _draft(unaddressed_questions=["shipping?"])
    r = run_gates(d, valid_fact_ids=set(), revision_count=0, messages=_msgs("q"))
    assert r.critique is not None
    assert "shipping?" in r.critique.unanswered_questions
```

- [ ] **Step 2: Run tests — expected FAIL**

Run: `cd agents && pytest tests/test_manager_gates.py -v`
Expected: `ModuleNotFoundError: No module named 'app.agents.manager_gates'`

- [ ] **Step 3: Implement gates module**

```python
# agents/app/agents/manager_gates.py
import re
from dataclasses import dataclass, field
from typing import Literal
from langchain_core.messages import BaseMessage, HumanMessage
from app.schemas.agent_io import StructuredReply, ManagerCritique


FACTUAL_Q_RE = re.compile(
    r"\b(harga|price|stock|ada\s|berapa|bila|macam\s+mana|bagaimana|mana|"
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
) -> GateResult:
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

    # Gate 5a/5b — ungrounded factual question
    buyer_msg = _last_human_text(messages)
    if FACTUAL_Q_RE.search(buyer_msg) and not draft.facts_used:
        if revision_count == 0:
            return GateResult(
                verdict="revise",
                gate_num=5,
                reason_slug="ungrounded_factual_answer",
                critique=ManagerCritique(
                    missing_facts=[f"grounded data for: {buyer_msg[:80]}"],
                ),
                passed_gates=passed,
            )
        return GateResult(
            verdict="rewrite",
            gate_num=5,
            reason_slug="ungrounded_factual_answer_persists",
            passed_gates=passed,
        )
    passed.append("factual_q_grounded")

    return GateResult(verdict=None, passed_gates=passed)
```

- [ ] **Step 4: Run tests — expected PASS**

Run: `cd agents && pytest tests/test_manager_gates.py -v`
Expected: 10 passed.

- [ ] **Step 5: Commit**

```bash
git add agents/app/agents/manager_gates.py agents/tests/test_manager_gates.py
git commit -m "feat(manager): mechanical gates with verdict+slug, no LLM"
```

---

## Task 9: Manager evaluator prompt builder + evaluate node

**Files:**
- Create: `agents/app/agents/manager_evaluator.py`
- Create: `agents/tests/test_manager_evaluator.py`

- [ ] **Step 1: Write failing tests**

```python
# agents/tests/test_manager_evaluator.py
import pytest
from langchain_core.messages import HumanMessage, AIMessage
from app.schemas.agent_io import (
    StructuredReply, ManagerCritique, ManagerVerdict, IterationEntry, FactRef,
)
from app.agents.manager_evaluator import build_evaluator_prompt, make_evaluate_node


def _state(**overrides):
    draft = StructuredReply(reply="hi", addressed_questions=["harga?"])
    base = {
        "messages": [HumanMessage(content="berapa harga?")],
        "business_context": "Business: Foo",
        "memory_block": "",
        "valid_fact_ids": {"product:p1"},
        "jual_draft": draft,
        "verdict": None,
        "critique": None,
        "gate_results": None,
        "revision_count": 0,
        "iterations": [IterationEntry(stage="jual_v1", draft=draft)],
    }
    base.update(overrides)
    return base


def test_build_prompt_contains_draft_and_context():
    s = _state()
    p = build_evaluator_prompt(s, s["jual_draft"])
    assert "Business: Foo" in p
    assert "berapa harga?" in p
    assert "hi" in p   # draft text


def test_build_prompt_revision_pass_includes_prior_critique():
    critique_v1 = ManagerCritique(missing_facts=["diabetic mom"])
    v1_entry = IterationEntry(
        stage="jual_v1",
        draft=StructuredReply(reply="v1"),
        verdict=ManagerVerdict(verdict="revise", critique=critique_v1, reason="gap"),
    )
    v2_entry = IterationEntry(stage="jual_v2", draft=StructuredReply(reply="v2"))
    s = _state(revision_count=1, iterations=[v1_entry, v2_entry], jual_draft=v2_entry.draft)
    p = build_evaluator_prompt(s, s["jual_draft"])
    assert "REVISED draft" in p
    assert "diabetic mom" in p
    assert "Do NOT emit 'revise'" in p


@pytest.mark.asyncio
async def test_evaluate_gate_path_skips_llm():
    class _RaisingLLM:
        def with_structured_output(self, schema):
            raise AssertionError("LLM must not be called when a gate fires")
    draft = StructuredReply(reply="hi", needs_human=True)
    s = _state(jual_draft=draft, iterations=[IterationEntry(stage="jual_v1", draft=draft)])
    evaluate = make_evaluate_node(_RaisingLLM())
    out = await evaluate(s)
    assert out["verdict"] == "escalate"
    assert out["iterations"][-1].verdict.verdict == "escalate"


@pytest.mark.asyncio
async def test_evaluate_llm_path_when_gates_pass():
    class _LLM:
        def with_structured_output(self, schema):
            class _W:
                async def ainvoke(self, prompt):
                    return ManagerVerdict(verdict="pass", reason="all good")
            return _W()
    draft = StructuredReply(
        reply="RM15",
        addressed_questions=["harga?"],
        facts_used=[FactRef(kind="product", id="p1")],
    )
    s = _state(jual_draft=draft, iterations=[IterationEntry(stage="jual_v1", draft=draft)])
    evaluate = make_evaluate_node(_LLM())
    out = await evaluate(s)
    assert out["verdict"] == "pass"
    assert out["iterations"][-1].verdict.reason == "all good"


@pytest.mark.asyncio
async def test_evaluate_returns_new_iterations_list_not_mutation():
    class _LLM:
        def with_structured_output(self, schema):
            class _W:
                async def ainvoke(self, prompt):
                    return ManagerVerdict(verdict="pass", reason="ok")
            return _W()
    draft = StructuredReply(
        reply="hi",
        addressed_questions=["q?"],
        facts_used=[FactRef(kind="product", id="p1")],
    )
    original_iter = [IterationEntry(stage="jual_v1", draft=draft)]
    s = _state(jual_draft=draft, iterations=original_iter)
    evaluate = make_evaluate_node(_LLM())
    out = await evaluate(s)
    assert out["iterations"] is not original_iter
    assert original_iter[0].verdict is None   # unmodified
```

- [ ] **Step 2: Run tests — expected FAIL**

Run: `cd agents && pytest tests/test_manager_evaluator.py -v`
Expected: `ModuleNotFoundError`.

- [ ] **Step 3: Implement evaluator module**

```python
# agents/app/agents/manager_evaluator.py
import logging
import time
from app.schemas.agent_io import StructuredReply, ManagerVerdict
from app.agents.manager_gates import run_gates

_log = logging.getLogger(__name__)


SYSTEM_PREAMBLE = (
    "You are Manager, evaluating a draft reply your worker Jual produced for a buyer. "
    "Your only job: emit one of four verdicts — pass, revise, rewrite, escalate."
)

VERDICT_CRITERIA_BLOCK = """\
# Verdict criteria
- pass      : reply is accurate, addresses buyer, tone appropriate. DEFAULT when in doubt — lean permissive.
- revise    : specific fixable issues. ONLY if revision_count == 0.
- rewrite   : draft is structurally off but you can do better with same context. No tools available.
- escalate  : genuinely requires human (refund, unknown policy, sensitive complaint).

Target: escalate is RARE (~5-10% of turns). The human operator is a busy student — respect their time.
When uncertain between pass and revise, choose pass. When uncertain between rewrite and escalate, choose rewrite.

If verdict == "revise", populate ManagerCritique with concrete actionable items:
- missing_facts, incorrect_claims, tone_issues, unanswered_questions, keep_from_draft.

Emit ManagerVerdict JSON only.
"""


def _format_recent(messages, n: int = 6) -> str:
    recent = messages[-n:] if len(messages) > n else messages
    lines = []
    for m in recent:
        role = type(m).__name__.replace("Message", "").lower()
        content = m.content if isinstance(m.content, str) else str(m.content)
        lines.append(f"[{role}] {content}")
    return "\n".join(lines)


def _extract_last_buyer_msg(messages) -> str:
    from langchain_core.messages import HumanMessage
    for m in reversed(messages):
        if isinstance(m, HumanMessage) and isinstance(m.content, str):
            return m.content
    return ""


def build_evaluator_prompt(state: dict, draft: StructuredReply) -> str:
    parts = [
        SYSTEM_PREAMBLE,
        f"\n# Context\nBusiness: {state.get('business_context','')}",
        f"\n# Memory\n{state.get('memory_block','')}",
        f"\n# Conversation (last 6 turns)\n{_format_recent(state.get('messages', []))}",
        f'\n# The specific message Jual is replying to\n"{_extract_last_buyer_msg(state.get("messages", []))}"',
        f"\n# Jual's draft",
        f"Reply: {draft.reply}",
        f"Addressed: {draft.addressed_questions}",
        f"Unaddressed: {draft.unaddressed_questions}",
        f"Facts used: {[f.model_dump() for f in draft.facts_used]}",
    ]
    if state.get("revision_count", 0) >= 1:
        # v1 is iterations[-2]; v2 is iterations[-1]
        prior_entry = state["iterations"][-2]
        prior = prior_entry.verdict.critique if prior_entry.verdict else None
        critique_json = prior.model_dump_json(indent=2) if prior else "{}"
        parts.append(
            "\n# This is a REVISED draft (v2).\n"
            f"The original critique was:\n{critique_json}\n"
            "Check: did Jual address each point? If yes → lean pass. "
            "If Jual introduced new problems while fixing old → rewrite. "
            "Do NOT emit 'revise' — already revised once."
        )
    parts.append("\n" + VERDICT_CRITERIA_BLOCK)
    parts.append(
        "Always populate `reason` with a one-sentence justification — "
        "even on pass (e.g., 'all questions addressed with grounded facts')."
    )
    return "\n".join(parts)


def make_evaluate_node(llm):
    async def evaluate(state: dict) -> dict:
        draft = state["jual_draft"]
        gate_result = run_gates(
            draft,
            valid_fact_ids=state.get("valid_fact_ids", set()),
            revision_count=state.get("revision_count", 0),
            messages=state.get("messages", []),
        )
        t0 = time.monotonic()
        if gate_result.verdict is not None:
            verdict_obj = ManagerVerdict(
                verdict=gate_result.verdict,
                critique=gate_result.critique,
                reason=f"gate:{gate_result.reason_slug}",
            )
            via = f"gate_{gate_result.gate_num}"
        else:
            prompt = build_evaluator_prompt(state, draft)
            verdict_obj = await llm.with_structured_output(ManagerVerdict).ainvoke(prompt)
            via = "llm"
        latency_ms = int((time.monotonic() - t0) * 1000)

        current = state["iterations"][-1]
        updated = current.model_copy(update={
            "verdict": verdict_obj,
            "gate_results": gate_result.as_dict(),
            "latency_ms": (current.latency_ms or 0) + latency_ms,
        })

        _log.info(
            "evaluator_decision",
            extra={
                "verdict": verdict_obj.verdict,
                "via": via,
                "revision_count": state.get("revision_count", 0),
                "stage": current.stage,
                "reason": verdict_obj.reason,
            },
        )
        return {
            "iterations": [*state["iterations"][:-1], updated],
            "verdict": verdict_obj.verdict,
            "critique": verdict_obj.critique,
        }
    return evaluate
```

- [ ] **Step 4: Run tests — expected PASS**

Run: `cd agents && pytest tests/test_manager_evaluator.py -v`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add agents/app/agents/manager_evaluator.py agents/tests/test_manager_evaluator.py
git commit -m "feat(manager): evaluate node — gates first, LLM verdict second, immutable state"
```

---

## Task 10: Manager rewrite + gates_only_check

**Files:**
- Create: `agents/app/agents/manager_rewrite.py`
- Create: `agents/tests/test_manager_rewrite.py`

- [ ] **Step 1: Write failing tests**

```python
# agents/tests/test_manager_rewrite.py
import pytest
from langchain_core.messages import HumanMessage
from app.schemas.agent_io import StructuredReply, IterationEntry, FactRef
from app.agents.manager_rewrite import make_manager_rewrite_node, gates_only_check


class _LLM:
    def __init__(self, output):
        self._output = output

    def with_structured_output(self, schema):
        out = self._output
        class _W:
            async def ainvoke(self, prompt):
                return out
        return _W()


@pytest.mark.asyncio
async def test_rewrite_appends_manager_rewrite_iteration():
    rewritten = StructuredReply(
        reply="corrected",
        facts_used=[FactRef(kind="product", id="p1")],
    )
    state = {
        "messages": [HumanMessage(content="q")],
        "business_context": "biz",
        "memory_block": "",
        "jual_draft": StructuredReply(reply="bad draft"),
        "valid_fact_ids": {"product:p1"},
        "iterations": [IterationEntry(stage="jual_v1", draft=StructuredReply(reply="bad draft"))],
    }
    node = make_manager_rewrite_node(_LLM(rewritten))
    out = await node(state)
    assert out["iterations"][-1].stage == "manager_rewrite"
    assert out["iterations"][-1].draft.reply == "corrected"
    assert out["final_reply"] == "corrected"


@pytest.mark.asyncio
async def test_gates_only_check_passes_on_clean_rewrite():
    draft = StructuredReply(reply="ok", facts_used=[FactRef(kind="product", id="p1")])
    state = {
        "valid_fact_ids": {"product:p1"},
        "iterations": [IterationEntry(stage="manager_rewrite", draft=draft)],
    }
    out = await gates_only_check(state)
    assert out["final_action_hint"] == "auto_send"
    assert out["final_reply"] == "ok"


@pytest.mark.asyncio
async def test_gates_only_check_escalates_on_hallucinated_rewrite():
    draft = StructuredReply(reply="ok", facts_used=[FactRef(kind="product", id="ghost")])
    state = {
        "valid_fact_ids": {"product:p1"},
        "iterations": [IterationEntry(stage="manager_rewrite", draft=draft)],
    }
    out = await gates_only_check(state)
    assert out["final_action_hint"] == "escalate"


@pytest.mark.asyncio
async def test_gates_only_check_escalates_on_needs_human():
    draft = StructuredReply(reply="pls help", needs_human=True)
    state = {
        "valid_fact_ids": set(),
        "iterations": [IterationEntry(stage="manager_rewrite", draft=draft)],
    }
    out = await gates_only_check(state)
    assert out["final_action_hint"] == "escalate"
```

- [ ] **Step 2: Run tests — expected FAIL**

Run: `cd agents && pytest tests/test_manager_rewrite.py -v`

- [ ] **Step 3: Implement rewrite + gates_only_check**

```python
# agents/app/agents/manager_rewrite.py
import logging
import time
from langchain_core.messages import SystemMessage
from app.schemas.agent_io import StructuredReply, IterationEntry

_log = logging.getLogger(__name__)


REWRITE_SYSTEM = (
    "You are Manager. Jual's draft could not be salvaged by a single revision. "
    "Rewrite the reply using ONLY the context below. You have no tools — work from the facts "
    "already established. Preserve any payment URLs verbatim if they appear in Jual's prior draft. "
    "Output the same StructuredReply JSON schema. Mark needs_human=true ONLY if you genuinely "
    "cannot produce a responsible reply from the available context."
)


def make_manager_rewrite_node(llm):
    async def manager_rewrite(state: dict) -> dict:
        jual_draft = state.get("jual_draft")
        prior_text = jual_draft.reply if jual_draft else ""
        t0 = time.monotonic()
        prompt = [
            SystemMessage(content=REWRITE_SYSTEM),
            SystemMessage(content=(
                f"Business context:\n{state.get('business_context','')}\n\n"
                f"Memory:\n{state.get('memory_block','')}\n\n"
                f"Jual's draft (starting point):\n{prior_text}\n"
            )),
            *state.get("messages", []),
        ]
        result = await llm.with_structured_output(StructuredReply).ainvoke(prompt)
        latency_ms = int((time.monotonic() - t0) * 1000)

        new_entry = IterationEntry(
            stage="manager_rewrite",
            draft=result,
            latency_ms=latency_ms,
        )
        _log.info("manager_rewrite_complete", extra={
            "latency_ms": latency_ms,
            "facts_used_count": len(result.facts_used),
        })
        return {
            "iterations": [*state["iterations"], new_entry],
            "final_reply": result.reply,
        }
    return manager_rewrite


async def gates_only_check(state: dict) -> dict:
    rewrite_entry = state["iterations"][-1]
    rewrite_draft = rewrite_entry.draft
    valid_ids = state.get("valid_fact_ids", set())

    for fact in rewrite_draft.facts_used:
        key = f"{fact.kind}:{fact.id}"
        if key not in valid_ids:
            _log.info("gates_only_outcome", extra={
                "outcome": "escalate",
                "reason_slug": f"ungrounded_fact:{fact.kind}:{fact.id}",
            })
            return {"final_action_hint": "escalate", "final_reply": rewrite_draft.reply}

    if rewrite_draft.needs_human:
        _log.info("gates_only_outcome", extra={"outcome": "escalate", "reason_slug": "rewrite_needs_human"})
        return {"final_action_hint": "escalate", "final_reply": rewrite_draft.reply}

    _log.info("gates_only_outcome", extra={"outcome": "auto_send"})
    return {"final_action_hint": "auto_send", "final_reply": rewrite_draft.reply}
```

- [ ] **Step 4: Run tests — expected PASS**

Run: `cd agents && pytest tests/test_manager_rewrite.py -v`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add agents/app/agents/manager_rewrite.py agents/tests/test_manager_rewrite.py
git commit -m "feat(manager): text-only rewrite node + gates_only_check"
```

---

## Task 11: Manager helpers (best-draft picker, humanization, resolve_final)

**Files:**
- Create: `agents/app/agents/manager_helpers.py`
- Create: `agents/tests/test_manager_helpers.py`

- [ ] **Step 1: Write failing tests**

```python
# agents/tests/test_manager_helpers.py
import pytest
from app.schemas.agent_io import StructuredReply, IterationEntry, ManagerVerdict, FactRef
from app.agents.manager_helpers import (
    pick_best_draft_for_human,
    humanize_reason,
    build_escalation_summary,
    resolve_final_reply,
    jual_v1_reply,
    jual_v1_confidence,
)


def _it(stage, reply="x", facts=None, needs_human=False, confidence=0.5):
    return IterationEntry(
        stage=stage,
        draft=StructuredReply(
            reply=reply,
            facts_used=facts or [],
            needs_human=needs_human,
            confidence=confidence,
        ),
    )


def test_picks_rewrite_when_grounded():
    state = {
        "iterations": [
            _it("jual_v1", "v1"),
            _it("jual_v2", "v2"),
            _it("manager_rewrite", "rewrite", facts=[FactRef(kind="product", id="p1")]),
        ],
        "valid_fact_ids": {"product:p1"},
    }
    assert pick_best_draft_for_human(state) == "rewrite"


def test_skips_rewrite_when_hallucinated():
    state = {
        "iterations": [
            _it("jual_v1", "v1"),
            _it("jual_v2", "v2"),
            _it("manager_rewrite", "bad", facts=[FactRef(kind="product", id="ghost")]),
        ],
        "valid_fact_ids": {"product:p1"},
    }
    assert pick_best_draft_for_human(state) == "v2"


def test_falls_back_to_v1_when_no_v2():
    state = {"iterations": [_it("jual_v1", "v1")], "valid_fact_ids": set()}
    assert pick_best_draft_for_human(state) == "v1"


def test_returns_empty_string_when_no_drafts():
    state = {"iterations": [], "valid_fact_ids": set()}
    assert pick_best_draft_for_human(state) == ""


def test_humanize_known_slugs():
    assert "Refund" in humanize_reason("gate:jual_self_flagged")
    assert "couldn't answer" in humanize_reason("gate:jual_self_reported_gap")
    assert "tried twice" in humanize_reason("gate:revise_failed_to_close_gaps").lower()
    assert "didn't have data" in humanize_reason("gate:ungrounded_factual_answer")
    assert "even after revising" in humanize_reason("gate:ungrounded_factual_answer_persists").lower()
    assert "double-check" in humanize_reason("gate:ungrounded_fact:product:p1")


def test_humanize_llm_reason_passes_through():
    assert humanize_reason("reply covers all points") == "reply covers all points"


def test_humanize_unknown_gate_returns_default(caplog):
    result = humanize_reason("gate:made_up_gate")
    assert result == "Needs your review."


def test_build_escalation_summary_uses_last_verdict():
    v1 = IterationEntry(
        stage="jual_v1",
        verdict=ManagerVerdict(verdict="escalate", reason="gate:jual_self_flagged"),
    )
    state = {"iterations": [v1]}
    assert "Refund" in build_escalation_summary(state)


def test_build_escalation_summary_non_escalate_verdict_gives_rewrite_default():
    v1 = IterationEntry(
        stage="jual_v1",
        verdict=ManagerVerdict(verdict="rewrite", reason="gate:ungrounded_fact:product:ghost"),
    )
    state = {"iterations": [v1]}
    # gates_only_check path — last verdict wasn't "escalate" at evaluate time
    assert "fact" in build_escalation_summary(state).lower()


def test_resolve_final_reply_uses_explicit_final_reply():
    state = {"final_reply": "done", "jual_draft": None, "iterations": []}
    assert resolve_final_reply(state) == "done"


def test_resolve_final_reply_falls_back_to_jual_draft():
    state = {
        "final_reply": None,
        "jual_draft": StructuredReply(reply="fallback"),
        "iterations": [],
    }
    assert resolve_final_reply(state) == "fallback"


def test_resolve_final_reply_raises_when_unresolvable():
    state = {"final_reply": None, "jual_draft": None, "iterations": []}
    with pytest.raises(RuntimeError):
        resolve_final_reply(state)


def test_jual_v1_reply_and_confidence():
    state = {"iterations": [_it("jual_v1", "first", confidence=0.7)]}
    assert jual_v1_reply(state) == "first"
    assert jual_v1_confidence(state) == 0.7
```

- [ ] **Step 2: Run tests — expected FAIL**

Run: `cd agents && pytest tests/test_manager_helpers.py -v`

- [ ] **Step 3: Implement helpers**

```python
# agents/app/agents/manager_helpers.py
import logging
from app.schemas.agent_io import IterationEntry

_log = logging.getLogger(__name__)


def _by_stage(state: dict) -> dict[str, IterationEntry]:
    return {e.stage: e for e in state.get("iterations", [])}


def pick_best_draft_for_human(state: dict) -> str:
    """
    Preference:
      1. manager_rewrite if all its facts are grounded
      2. jual_v2
      3. jual_v1
    """
    by_stage = _by_stage(state)
    valid_ids = state.get("valid_fact_ids", set())

    rewrite = by_stage.get("manager_rewrite")
    if rewrite and rewrite.draft:
        all_grounded = all(
            f"{f.kind}:{f.id}" in valid_ids for f in rewrite.draft.facts_used
        )
        if all_grounded:
            return rewrite.draft.reply

    for stage in ("jual_v2", "jual_v1"):
        entry = by_stage.get(stage)
        if entry and entry.draft:
            return entry.draft.reply

    _log.warning(
        "no_draft_for_escalation",
        extra={"iterations": [e.stage for e in state.get("iterations", [])]},
    )
    return ""


_SLUG_MAP = {
    "jual_self_flagged": "Refund, complaint, or sensitive issue — needs your call.",
    "jual_self_reported_gap": "Buyer asked something I couldn't answer.",
    "revise_failed_to_close_gaps": "Tried twice but couldn't cover everything the buyer asked.",
    "ungrounded_factual_answer": "Factual question I didn't have data to answer.",
    "ungrounded_factual_answer_persists": "Couldn't find data for this even after revising.",
    "rewrite_needs_human": "Needed help answering — please take a look.",
}


def humanize_reason(reason: str) -> str:
    if not reason.startswith("gate:"):
        return reason
    slug = reason[len("gate:"):]
    if slug in _SLUG_MAP:
        return _SLUG_MAP[slug]
    if slug.startswith("ungrounded_fact:"):
        return "Referenced something I couldn't verify — please double-check."
    _log.warning("unknown_gate_slug", extra={"slug": slug})
    return "Needs your review."


def build_escalation_summary(state: dict) -> str:
    iters = state.get("iterations", [])
    if not iters:
        return "Needs your review."
    last_verdict = iters[-1].verdict
    if last_verdict and last_verdict.verdict == "escalate":
        return humanize_reason(last_verdict.reason)
    # gates_only_check path after rewrite hallucinated
    return "Rewrite referenced a fact I couldn't verify — please review."


def resolve_final_reply(state: dict) -> str:
    resolved = state.get("final_reply")
    if not resolved:
        jd = state.get("jual_draft")
        if jd is not None:
            resolved = jd.reply
    if not resolved:
        iters = state.get("iterations", [])
        if iters and iters[-1].draft is not None:
            resolved = iters[-1].draft.reply
    if not resolved:
        _log.error(
            "finalize_no_reply",
            extra={"iterations": [e.stage for e in state.get("iterations", [])]},
        )
        raise RuntimeError("finalize reached without a resolvable reply")
    return resolved


def jual_v1_reply(state: dict) -> str:
    entry = _by_stage(state).get("jual_v1")
    return entry.draft.reply if entry and entry.draft else ""


def jual_v1_confidence(state: dict) -> float:
    entry = _by_stage(state).get("jual_v1")
    return entry.draft.confidence if entry and entry.draft else 0.0
```

- [ ] **Step 4: Run tests — expected PASS**

Run: `cd agents && pytest tests/test_manager_helpers.py -v`
Expected: 13 passed.

- [ ] **Step 5: Commit**

```bash
git add agents/app/agents/manager_helpers.py agents/tests/test_manager_helpers.py
git commit -m "feat(manager): helpers for best-draft picker, humanization, final-reply resolve"
```

---

## Task 12: Manager terminal nodes (finalize, queue_for_human)

**Files:**
- Create: `agents/app/agents/manager_terminal.py`
- Create: `agents/tests/test_manager_terminal.py`

- [ ] **Step 1: Write failing tests**

```python
# agents/tests/test_manager_terminal.py
import pytest
from unittest.mock import MagicMock
from langchain_core.messages import HumanMessage
from app.schemas.agent_io import StructuredReply, IterationEntry, ManagerVerdict, FactRef
from app.agents.manager_terminal import make_finalize_node, make_queue_for_human_node


class _FakeSession:
    def __init__(self):
        self.added = []
        self.committed = False
    def add(self, r): self.added.append(r)
    def commit(self): self.committed = True
    def __enter__(self): return self
    def __exit__(self, *a): return False


@pytest.fixture
def patch_session(monkeypatch):
    fake = _FakeSession()
    def _factory():
        return fake
    import app.agents.manager_terminal as mt
    monkeypatch.setattr(mt, "SessionLocal", _factory)
    return fake


@pytest.fixture
def patch_enqueue(monkeypatch):
    calls = []
    import app.agents.manager_terminal as mt
    def _fake(state, action_id, final_reply):
        calls.append((action_id, final_reply))
    monkeypatch.setattr(mt, "_enqueue_memory_write", _fake)
    return calls


def _base_state():
    v1 = IterationEntry(
        stage="jual_v1",
        draft=StructuredReply(reply="hello", confidence=0.72, reasoning="r"),
        verdict=ManagerVerdict(verdict="pass", reason="all good"),
    )
    return {
        "messages": [HumanMessage(content="hi")],
        "business_id": "biz1",
        "valid_fact_ids": set(),
        "jual_draft": v1.draft,
        "iterations": [v1],
        "final_reply": None,
    }


@pytest.mark.asyncio
async def test_finalize_writes_auto_sent_row(patch_session, patch_enqueue):
    finalize = make_finalize_node()
    out = await finalize(_base_state())
    assert patch_session.committed
    row = patch_session.added[0]
    assert row.status.value == "AUTO_SENT"
    assert row.finalReply == "hello"
    assert row.confidence == 0.72   # Jual v1 confidence, not rewrite's
    assert row.draftReply == "hello"
    assert isinstance(row.iterations, list)
    assert len(row.iterations) == 1
    assert row.iterations[0]["stage"] == "jual_v1"
    assert out["action_id"] == row.id
    assert len(patch_enqueue) == 1
    assert patch_enqueue[0][1] == "hello"


@pytest.mark.asyncio
async def test_queue_for_human_writes_pending_row_no_memory(patch_session, patch_enqueue):
    v1 = IterationEntry(
        stage="jual_v1",
        draft=StructuredReply(reply="unsure", needs_human=True, confidence=0.3),
        verdict=ManagerVerdict(verdict="escalate", reason="gate:jual_self_flagged"),
    )
    state = _base_state()
    state["iterations"] = [v1]
    state["jual_draft"] = v1.draft

    queue = make_queue_for_human_node()
    out = await queue(state)
    row = patch_session.added[0]
    assert row.status.value == "PENDING"
    assert row.finalReply is None
    assert row.confidence == 0.3
    assert "Refund" in row.reasoning or "sensitive" in row.reasoning
    assert out["best_draft"] == "unsure"
    # memory write NOT called on escalation
    assert len(patch_enqueue) == 0


@pytest.mark.asyncio
async def test_finalize_uses_manager_rewrite_reply_when_present(patch_session, patch_enqueue):
    v1 = IterationEntry(stage="jual_v1", draft=StructuredReply(reply="v1", confidence=0.6))
    rewrite = IterationEntry(
        stage="manager_rewrite",
        draft=StructuredReply(reply="rewritten", facts_used=[FactRef(kind="product", id="p1")]),
    )
    state = _base_state()
    state["iterations"] = [v1, rewrite]
    state["valid_fact_ids"] = {"product:p1"}
    state["final_reply"] = "rewritten"
    state["jual_draft"] = v1.draft

    finalize = make_finalize_node()
    await finalize(state)
    row = patch_session.added[0]
    assert row.finalReply == "rewritten"
    assert row.confidence == 0.6   # Jual v1 confidence preserved for telemetry
```

- [ ] **Step 2: Run tests — expected FAIL**

Run: `cd agents && pytest tests/test_manager_terminal.py -v`

- [ ] **Step 3: Implement terminal nodes**

```python
# agents/app/agents/manager_terminal.py
import logging
import os
from cuid2 import Cuid as _Cuid
from app.db import SessionLocal, AgentAction, AgentActionStatus
from app.utils.messages import last_buyer_text
from app.agents.manager_helpers import (
    resolve_final_reply, pick_best_draft_for_human, build_escalation_summary,
    jual_v1_reply, jual_v1_confidence,
)

_log = logging.getLogger(__name__)
_gen_cuid = _Cuid().generate


def _enqueue_memory_write(state: dict, action_id: str, final_reply: str):
    """Wrapped so tests can monkeypatch without importing Celery."""
    if os.environ.get("MEMORY_ENABLED", "true").lower() != "true":
        return
    phone = state.get("customer_phone") or ""
    if not phone:
        return
    try:
        from app.worker.tasks import embed_and_store_turn, embed_past_action
        buyer_msg = last_buyer_text(state.get("messages", []))
        embed_and_store_turn.delay(
            business_id=state["business_id"],
            customer_phone=phone,
            buyer_msg=buyer_msg,
            agent_reply=final_reply,
            action_id=action_id,
        )
        embed_past_action.delay(action_id)
    except Exception as e:
        _log.warning("memory enqueue failed: %s", e)


def _iterations_to_jsonb(iterations):
    return [e.model_dump(mode="json") for e in iterations]


def make_finalize_node():
    async def finalize(state: dict) -> dict:
        final_reply = resolve_final_reply(state)
        action_id = _gen_cuid()
        last_verdict = state["iterations"][-1].verdict
        with SessionLocal() as session:
            record = AgentAction(
                id=action_id,
                businessId=state["business_id"],
                customerMsg=last_buyer_text(state.get("messages", [])),
                draftReply=jual_v1_reply(state) or final_reply,
                finalReply=final_reply,
                confidence=jual_v1_confidence(state),
                reasoning=last_verdict.reason if last_verdict else "",
                status=AgentActionStatus.AUTO_SENT,
                iterations=_iterations_to_jsonb(state["iterations"]),
            )
            session.add(record)
            session.commit()
        _enqueue_memory_write(state, action_id, final_reply)
        _log.info("manager_turn_terminal", extra={
            "action_id": action_id, "final_action": "auto_send",
            "iteration_count": len(state["iterations"]),
        })
        return {"final_action": "auto_send", "action_id": action_id}
    return finalize


def make_queue_for_human_node():
    async def queue_for_human(state: dict) -> dict:
        action_id = _gen_cuid()
        best_draft = pick_best_draft_for_human(state)
        escalation_summary = build_escalation_summary(state)
        with SessionLocal() as session:
            record = AgentAction(
                id=action_id,
                businessId=state["business_id"],
                customerMsg=last_buyer_text(state.get("messages", [])),
                draftReply=jual_v1_reply(state) or best_draft,
                finalReply=None,
                confidence=jual_v1_confidence(state),
                reasoning=escalation_summary,
                status=AgentActionStatus.PENDING,
                iterations=_iterations_to_jsonb(state["iterations"]),
            )
            session.add(record)
            session.commit()
        _log.info("manager_turn_terminal", extra={
            "action_id": action_id, "final_action": "escalate",
            "iteration_count": len(state["iterations"]),
        })
        return {"final_action": "escalate", "action_id": action_id, "best_draft": best_draft}
    return queue_for_human
```

- [ ] **Step 4: Run tests — expected PASS**

Run: `cd agents && pytest tests/test_manager_terminal.py -v`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add agents/app/agents/manager_terminal.py agents/tests/test_manager_terminal.py
git commit -m "feat(manager): finalize + queue_for_human terminal nodes with deferred memory on escalate"
```

---

## Task 13: Manager graph assembly + load_shared_context

**Files:**
- Create: `agents/app/agents/manager.py`
- Create: `agents/tests/test_manager_graph.py`
- Modify: `agents/app/main.py`

- [ ] **Step 1: Write failing integration test**

```python
# agents/tests/test_manager_graph.py
import pytest
from langchain_core.messages import HumanMessage
from app.schemas.agent_io import StructuredReply, ManagerVerdict, FactRef


class _ScriptedJualLLM:
    """Returns a parseable JSON string imitating Jual's structured JSON output."""
    def __init__(self, payload):
        self._payload = payload
    def bind_tools(self, tools): return self
    def with_structured_output(self, schema):
        pl = self._payload
        class _W:
            async def ainvoke(self, h):
                # Used by redraft_reply; return the next scripted payload
                return StructuredReply.model_validate(pl)
        return _W()
    async def ainvoke(self, history):
        from langchain_core.messages import AIMessage
        import json
        return AIMessage(content=json.dumps(self._payload))


class _ManagerLLM:
    def __init__(self, verdict_obj):
        self._verdict = verdict_obj
    def with_structured_output(self, schema):
        v = self._verdict
        class _W:
            async def ainvoke(self, prompt):
                return v
        return _W()


@pytest.mark.asyncio
async def test_manager_happy_path_auto_sends(monkeypatch):
    """Jual drafts a clean reply, gates pass, Manager LLM says pass, finalize writes row."""
    import app.agents.manager as mgr
    import app.agents.customer_support as cs

    # Stub Jual's DB-dependent helpers
    monkeypatch.setattr(cs, "_build_context", lambda bid: "Business: Test\nProducts:\n- [p1] Foo: RM10, 5 in stock")

    # Stub load_shared_context DB reads
    def _fake_load_shared(state):
        return {
            "business_context": "Business: Test\nProducts:\n- [p1] Foo: RM10, 5 in stock",
            "memory_block": "",
            "valid_fact_ids": {"product:p1"},
        }
    monkeypatch.setattr(mgr, "_load_shared_context_impl", _fake_load_shared)

    # Stub DB write
    writes = []
    class _Session:
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def add(self, r): writes.append(r)
        def commit(self): pass
    monkeypatch.setattr("app.agents.manager_terminal.SessionLocal", _Session)
    monkeypatch.setattr("app.agents.manager_terminal._enqueue_memory_write", lambda *a, **k: None)

    jual_payload = {
        "reply": "RM10 ada 5 stock",
        "confidence": 0.92,
        "reasoning": "direct",
        "addressed_questions": ["harga?"],
        "unaddressed_questions": [],
        "facts_used": [{"kind": "product", "id": "p1"}],
        "needs_human": False,
    }
    jual_llm = _ScriptedJualLLM(jual_payload)
    manager_llm = _ManagerLLM(ManagerVerdict(verdict="pass", reason="grounded, addressed"))

    graph = mgr.build_manager_graph(jual_llm=jual_llm, manager_llm=manager_llm)
    result = await graph.ainvoke({
        "messages": [HumanMessage(content="berapa harga foo?")],
        "business_id": "biz1",
        "customer_id": "c1",
        "customer_phone": "60123",
        "revision_count": 0,
        "iterations": [],
    })
    assert result["final_action"] == "auto_send"
    assert len(writes) == 1
    assert writes[0].status.value == "AUTO_SENT"


@pytest.mark.asyncio
async def test_manager_needs_human_escalates_immediately(monkeypatch):
    """Jual flags needs_human → gate 1 fires → queue_for_human, no Manager LLM call."""
    import app.agents.manager as mgr
    import app.agents.customer_support as cs
    monkeypatch.setattr(cs, "_build_context", lambda bid: "Business: Test")
    monkeypatch.setattr(mgr, "_load_shared_context_impl", lambda s: {
        "business_context": "Business: Test", "memory_block": "", "valid_fact_ids": set(),
    })

    writes = []
    class _Session:
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def add(self, r): writes.append(r)
        def commit(self): pass
    monkeypatch.setattr("app.agents.manager_terminal.SessionLocal", _Session)
    monkeypatch.setattr("app.agents.manager_terminal._enqueue_memory_write", lambda *a, **k: None)

    payload = {
        "reply": "pls help", "confidence": 0.2, "reasoning": "sensitive",
        "addressed_questions": [], "unaddressed_questions": [],
        "facts_used": [], "needs_human": True,
    }
    class _RaisingManagerLLM:
        def with_structured_output(self, schema):
            raise AssertionError("gate escalation must not call Manager LLM")

    graph = mgr.build_manager_graph(
        jual_llm=_ScriptedJualLLM(payload),
        manager_llm=_RaisingManagerLLM(),
    )
    result = await graph.ainvoke({
        "messages": [HumanMessage(content="saya nak refund")],
        "business_id": "biz1",
        "customer_id": "c1",
        "customer_phone": "60123",
        "revision_count": 0,
        "iterations": [],
    })
    assert result["final_action"] == "escalate"
    assert writes[0].status.value == "PENDING"
```

- [ ] **Step 2: Run tests — expected FAIL**

Run: `cd agents && pytest tests/test_manager_graph.py -v`
Expected: `ModuleNotFoundError: No module named 'app.agents.manager'`

- [ ] **Step 3: Implement Manager graph**

```python
# agents/app/agents/manager.py
import logging
from typing import Literal, Annotated
from typing_extensions import TypedDict
from langgraph.graph import StateGraph, START, END
from langgraph.graph.message import add_messages
from langchain_core.messages import BaseMessage

from app.db import SessionLocal, Business, Product
from app.schemas.agent_io import (
    StructuredReply, ManagerCritique, IterationEntry,
)
from app.agents.customer_support import build_customer_support_agent
from app.agents.manager_evaluator import make_evaluate_node
from app.agents.manager_rewrite import make_manager_rewrite_node, gates_only_check
from app.agents.manager_terminal import make_finalize_node, make_queue_for_human_node

_log = logging.getLogger(__name__)


class ManagerState(TypedDict, total=False):
    messages: Annotated[list[BaseMessage], add_messages]
    business_id: str
    customer_id: str
    customer_phone: str
    business_context: str
    memory_block: str
    valid_fact_ids: set[str]
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


def _load_shared_context_impl(state: dict) -> dict:
    """Loads business context, memory, valid_fact_ids. Module-level so tests can monkeypatch."""
    import os
    from app.memory import repo as memory_repo
    from app.memory.embedder import embed
    from app.memory.formatter import memory_block as format_memory_block

    business_id = state["business_id"]
    phone = state.get("customer_phone") or ""

    with SessionLocal() as session:
        business = session.query(Business).filter(Business.id == business_id).first()
        if not business:
            raise ValueError(f"Business {business_id} not found")
        products = session.query(Product).filter(Product.businessId == business_id).all()

        # Build business_context same shape as customer_support._build_context
        lines = [f"Business: {business.name}"]
        if business.mission:
            lines.append(f"About: {business.mission}")
        if products:
            lines.append("\nProducts available (use product id when creating payment links):")
            for p in products:
                stock_note = f"{p.stock} in stock" if p.stock > 0 else "OUT OF STOCK"
                desc = f" — {p.description}" if p.description else ""
                lines.append(f"- [{p.id}] {p.name}: RM{p.price:.2f}, {stock_note}{desc}")
        business_context = "\n".join(lines)

        memory_enabled = os.environ.get("MEMORY_ENABLED", "true").lower() == "true"
        memory_block = ""
        if memory_enabled and phone:
            recent = memory_repo.recent_turns(session, business_id, phone,
                                              limit=int(os.environ.get("MEMORY_RECENT_TURNS", "20")))
            latest = ""
            if state.get("messages"):
                last = state["messages"][-1]
                if isinstance(last.content, str):
                    latest = last.content
            summaries = []
            if latest:
                q_vec = embed([latest])[0]
                summaries = memory_repo.search_summaries(session, business_id, phone, q_vec, k=3, min_sim=0.5)
            memory_block = format_memory_block(phone=phone, recent_turns=recent, summaries=summaries)

    valid_ids = {f"product:{p.id}" for p in products}
    return {
        "business_context": business_context,
        "memory_block": memory_block,
        "valid_fact_ids": valid_ids,
    }


def build_manager_graph(*, jual_llm, manager_llm):
    jual_graph = build_customer_support_agent(jual_llm)

    async def load_shared_context(state: ManagerState) -> dict:
        _log.info("manager_turn_start", extra={
            "business_id": state.get("business_id"),
            "customer_phone": state.get("customer_phone"),
        })
        loaded = _load_shared_context_impl(state)
        loaded["revision_count"] = state.get("revision_count", 0)
        loaded["iterations"] = state.get("iterations", []) or []
        return loaded

    async def dispatch_jual(state: ManagerState) -> dict:
        sub_state = {
            "messages": state["messages"],
            "business_id": state["business_id"],
            "customer_id": state.get("customer_id", ""),
            "customer_phone": state.get("customer_phone", ""),
            "business_context": state["business_context"],
            "memory_block": state["memory_block"],
            "draft_reply": "",
            "confidence": 0.0,
            "reasoning": "",
            "revision_mode": "draft",
        }
        result = await jual_graph.ainvoke(sub_state)
        draft = result.get("structured_reply") or StructuredReply(
            reply=result.get("draft_reply", ""),
            confidence=result.get("confidence", 0.0),
            reasoning=result.get("reasoning", ""),
        )
        new_entry = IterationEntry(stage="jual_v1", draft=draft)
        _log.info("jual_draft_complete", extra={
            "stage": "jual_v1",
            "unaddressed_count": len(draft.unaddressed_questions),
            "facts_used_count": len(draft.facts_used),
            "needs_human": draft.needs_human,
        })
        return {
            "jual_draft": draft,
            "iterations": [*state["iterations"], new_entry],
        }

    async def dispatch_jual_revise(state: ManagerState) -> dict:
        sub_state = {
            "messages": state["messages"],
            "business_id": state["business_id"],
            "customer_id": state.get("customer_id", ""),
            "customer_phone": state.get("customer_phone", ""),
            "business_context": state["business_context"],
            "memory_block": state["memory_block"],
            "draft_reply": "",
            "confidence": 0.0,
            "reasoning": "",
            "revision_mode": "redraft",
            "previous_draft": state["jual_draft"],
            "critique": state["critique"],
        }
        result = await jual_graph.ainvoke(sub_state)
        draft = result.get("structured_reply") or StructuredReply(
            reply=result.get("draft_reply", ""),
            confidence=result.get("confidence", 0.0),
            reasoning=result.get("reasoning", ""),
        )
        new_entry = IterationEntry(stage="jual_v2", draft=draft)
        _log.info("jual_draft_complete", extra={
            "stage": "jual_v2",
            "unaddressed_count": len(draft.unaddressed_questions),
            "facts_used_count": len(draft.facts_used),
            "needs_human": draft.needs_human,
        })
        return {
            "jual_draft": draft,
            "revision_count": state.get("revision_count", 0) + 1,
            "iterations": [*state["iterations"], new_entry],
        }

    evaluate = make_evaluate_node(manager_llm)
    manager_rewrite = make_manager_rewrite_node(manager_llm)
    finalize = make_finalize_node()
    queue_for_human = make_queue_for_human_node()

    def route_verdict(state: ManagerState) -> Literal[
        "finalize", "dispatch_jual_revise", "manager_rewrite", "queue_for_human",
    ]:
        v = state.get("verdict")
        if v == "pass":
            return "finalize"
        if v == "revise":
            if state.get("revision_count", 0) >= 1:
                return "manager_rewrite"
            return "dispatch_jual_revise"
        if v == "rewrite":
            return "manager_rewrite"
        return "queue_for_human"

    def route_gates_only(state: ManagerState) -> Literal["finalize", "queue_for_human"]:
        return "finalize" if state.get("final_action_hint") == "auto_send" else "queue_for_human"

    graph = StateGraph(ManagerState)
    graph.add_node("load_shared_context", load_shared_context)
    graph.add_node("dispatch_jual", dispatch_jual)
    graph.add_node("dispatch_jual_revise", dispatch_jual_revise)
    graph.add_node("evaluate", evaluate)
    graph.add_node("manager_rewrite", manager_rewrite)
    graph.add_node("gates_only_check", gates_only_check)
    graph.add_node("finalize", finalize)
    graph.add_node("queue_for_human", queue_for_human)

    graph.add_edge(START, "load_shared_context")
    graph.add_edge("load_shared_context", "dispatch_jual")
    graph.add_edge("dispatch_jual", "evaluate")
    graph.add_conditional_edges("evaluate", route_verdict, {
        "finalize": "finalize",
        "dispatch_jual_revise": "dispatch_jual_revise",
        "manager_rewrite": "manager_rewrite",
        "queue_for_human": "queue_for_human",
    })
    graph.add_edge("dispatch_jual_revise", "evaluate")
    graph.add_edge("manager_rewrite", "gates_only_check")
    graph.add_conditional_edges("gates_only_check", route_gates_only, {
        "finalize": "finalize",
        "queue_for_human": "queue_for_human",
    })
    graph.add_edge("finalize", END)
    graph.add_edge("queue_for_human", END)
    return graph.compile()
```

- [ ] **Step 4: Wire graph into main.py (behind flag)**

Open `agents/app/main.py`. After line 21 (`support_graph = build_customer_support_agent(llm)`), add:

```python
import os as _os_for_flag
from app.agents.manager import build_manager_graph as _build_manager_graph

_MANAGER_ENABLED = _os_for_flag.environ.get("MANAGER_ENABLED", "false").lower() == "true"

if _MANAGER_ENABLED:
    active_graph = _build_manager_graph(jual_llm=llm, manager_llm=llm)
else:
    active_graph = support_graph
```

Replace usages of `support_graph` in graph-wiring router registration (search for `support_graph` in `main.py`) with `active_graph`. Keep `support_graph` variable in scope for tests that import it directly.

- [ ] **Step 5: Run tests — expected PASS**

Run: `cd agents && pytest tests/test_manager_graph.py -v`
Expected: 2 passed.

- [ ] **Step 6: Run full agents test suite**

Run: `cd agents && pytest tests/ -v`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add agents/app/agents/manager.py agents/app/main.py agents/tests/test_manager_graph.py
git commit -m "feat(manager): assemble LangGraph — load_shared_context + dispatch + evaluate + terminal"
```

---

## Task 14: Router refactor — swap to Manager graph, surface best_draft/escalation_summary

**Files:**
- Modify: `agents/app/routers/support.py`
- Modify: `agents/app/main.py`
- Create: `agents/tests/test_support_router_manager.py`

- [ ] **Step 1: Write failing test**

```python
# agents/tests/test_support_router_manager.py
import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client_with_manager(monkeypatch):
    monkeypatch.setenv("MANAGER_ENABLED", "true")
    # Force-re-import main to honor env
    import importlib
    import app.main as main_mod
    importlib.reload(main_mod)
    return TestClient(main_mod.app)


def test_auto_sent_response_includes_best_draft_null(client_with_manager, monkeypatch):
    # Stub the graph to return an auto_sent result
    import app.routers.support as support_mod
    async def _fake_invoke(state):
        return {
            "final_action": "auto_send",
            "action_id": "a1",
            "final_reply": "hi",
            "best_draft": None,
        }
    monkeypatch.setattr(support_mod, "_support_graph_ainvoke", _fake_invoke)

    resp = client_with_manager.post("/agent/support/chat", json={
        "business_id": "biz1", "customer_id": "c1", "message": "hi",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "sent"
    assert data["best_draft"] is None
    assert data["escalation_summary"] is None


def test_pending_response_includes_best_draft_and_summary(client_with_manager, monkeypatch):
    import app.routers.support as support_mod
    async def _fake_invoke(state):
        return {
            "final_action": "escalate",
            "action_id": "a2",
            "best_draft": "suggested reply",
        }
    monkeypatch.setattr(support_mod, "_support_graph_ainvoke", _fake_invoke)

    # Also stub the DB read for escalation_summary
    monkeypatch.setattr(support_mod, "_load_escalation_summary", lambda aid: "Needs your review.")

    resp = client_with_manager.post("/agent/support/chat", json={
        "business_id": "biz1", "customer_id": "c1", "message": "refund?",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "pending_approval"
    assert data["best_draft"] == "suggested reply"
    assert data["escalation_summary"] == "Needs your review."
```

- [ ] **Step 2: Run — expected FAIL**

Run: `cd agents && pytest tests/test_support_router_manager.py -v`
Expected: missing fields on response model.

- [ ] **Step 3: Update response model + handler**

Edit `agents/app/routers/support.py`. Replace `SupportChatResponse` (lines 38-42):

```python
class SupportChatResponse(BaseModel):
    status: str
    reply: Optional[str] = None
    action_id: Optional[str] = None
    confidence: Optional[float] = None
    best_draft: Optional[str] = None
    escalation_summary: Optional[str] = None
```

Add helper at module level:

```python
def _load_escalation_summary(action_id: str) -> Optional[str]:
    with SessionLocal() as session:
        action = session.query(AgentAction).filter(AgentAction.id == action_id).first()
        if not action:
            return None
        return action.reasoning
```

Replace the `support_chat` body (the whole function from line 69 on) with:

```python
    @router.post("/support/chat", response_model=SupportChatResponse)
    async def support_chat(req: SupportChatRequest):
        try:
            result = await _support_graph_ainvoke({
                "messages": [HumanMessage(content=req.message)],
                "business_id": req.business_id,
                "customer_id": req.customer_id,
                "customer_phone": normalize_phone(req.customer_phone) if req.customer_phone else "",
                "revision_count": 0,
                "iterations": [],
            })

            # Manager graph shape
            if "final_action" in result:
                action_id = result.get("action_id")
                if result["final_action"] == "auto_send":
                    # Re-read the finalReply from DB for consistency, avoid state bleed
                    with SessionLocal() as session:
                        row = session.query(AgentAction).filter_by(id=action_id).first()
                        reply = row.finalReply if row else None
                        confidence = row.confidence if row else 0.0
                    return SupportChatResponse(
                        status="sent",
                        reply=reply,
                        action_id=action_id,
                        confidence=confidence,
                    )
                # escalate
                return SupportChatResponse(
                    status="pending_approval",
                    action_id=action_id,
                    best_draft=result.get("best_draft"),
                    escalation_summary=_load_escalation_summary(action_id),
                )

            # Legacy support_graph path (MANAGER_ENABLED=false)
            action_id = result.get("action_id", "")
            confidence = result.get("confidence", 0.0)
            draft = result.get("draft_reply", "")
            should_auto = confidence >= 0.8
            if should_auto:
                return SupportChatResponse(status="sent", reply=draft, action_id=action_id, confidence=confidence)
            return SupportChatResponse(status="pending_approval", action_id=action_id, confidence=confidence)

        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))
```

Remove the temporary legacy-compat block added in Task 6 step 5 (the one that writes AgentAction from the router) — Manager handles DB writes now. If `MANAGER_ENABLED=false` the legacy path falls through to graph's legacy shape; update `customer_support.py`'s `draft_reply` node to also write a row in legacy mode, OR leave legacy behavior explicitly behind a flag in `make_support_router` for now. For simplicity: when `MANAGER_ENABLED=false`, the route returns draft/confidence without a DB row. Document this in Task 23 as a known limitation of the rollback path.

- [ ] **Step 4: Update `make_support_router` wiring**

`make_support_router` should accept the active graph (Manager or support). In `main.py`, pass `active_graph` instead of `support_graph`:

Find where `make_support_router(support_graph)` is called and change to `make_support_router(active_graph)`.

- [ ] **Step 5: Run tests — expected PASS**

Run: `cd agents && pytest tests/test_support_router_manager.py tests/ -v`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add agents/app/routers/support.py agents/app/main.py agents/tests/test_support_router_manager.py
git commit -m "feat(router): surface best_draft + escalation_summary; swap to active_graph"
```

---

## Task 15: Iterations endpoint

**Files:**
- Modify: `agents/app/routers/support.py`
- Create: `agents/tests/test_iterations_endpoint.py`

- [ ] **Step 1: Write failing test**

```python
# agents/tests/test_iterations_endpoint.py
from fastapi.testclient import TestClient


def test_iterations_endpoint_returns_jsonb(monkeypatch):
    import app.main as main_mod
    import app.routers.support as support_mod

    class _Action:
        id = "a1"
        iterations = [{"stage": "jual_v1", "draft": {"reply": "hi"}}]

    class _Session:
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def query(self, m):
            class _Q:
                def filter(self, *a, **k): return self
                def filter_by(self, **k): return self
                def first(_self): return _Action()
            return _Q()
    monkeypatch.setattr(support_mod, "SessionLocal", _Session)

    client = TestClient(main_mod.app)
    resp = client.get("/agent/actions/a1/iterations")
    assert resp.status_code == 200
    assert resp.json() == {"iterations": [{"stage": "jual_v1", "draft": {"reply": "hi"}}]}
    assert "immutable" in resp.headers.get("cache-control", "")


def test_iterations_404_when_missing(monkeypatch):
    import app.main as main_mod
    import app.routers.support as support_mod

    class _Session:
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def query(self, m):
            class _Q:
                def filter(self, *a, **k): return self
                def filter_by(self, **k): return self
                def first(_self): return None
            return _Q()
    monkeypatch.setattr(support_mod, "SessionLocal", _Session)

    client = TestClient(main_mod.app)
    resp = client.get("/agent/actions/missing/iterations")
    assert resp.status_code == 404
```

- [ ] **Step 2: Run — expected FAIL**

Run: `cd agents && pytest tests/test_iterations_endpoint.py -v`

- [ ] **Step 3: Add endpoint inside `make_support_router`**

Append inside `make_support_router` (after existing `reject_action`):

```python
    from fastapi import Response

    @router.get("/actions/{action_id}/iterations")
    def get_iterations(action_id: str, response: Response):
        response.headers["Cache-Control"] = "private, max-age=3600, immutable"
        with SessionLocal() as session:
            action = session.query(AgentAction).filter(AgentAction.id == action_id).first()
            if not action:
                raise HTTPException(status_code=404, detail="Action not found")
            return {"iterations": action.iterations or []}
```

- [ ] **Step 4: Run tests — expected PASS**

Run: `cd agents && pytest tests/test_iterations_endpoint.py -v`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add agents/app/routers/support.py agents/tests/test_iterations_endpoint.py
git commit -m "feat(router): GET /agent/actions/{id}/iterations with immutable cache"
```

---

## Task 16: Approval endpoint — deferred memory enqueue (10s countdown)

**Files:**
- Modify: `agents/app/routers/support.py`
- Create: `agents/tests/test_approve_deferred_memory.py`

- [ ] **Step 1: Write failing test**

```python
# agents/tests/test_approve_deferred_memory.py
import pytest
from fastapi.testclient import TestClient


def test_approve_uses_body_reply_and_delays_memory_enqueue_10s(monkeypatch):
    import app.main as main_mod
    import app.routers.support as support_mod
    from app.db import AgentAction, AgentActionStatus

    # In-memory action
    action = AgentAction(
        id="a1", businessId="biz", customerMsg="hi", draftReply="d",
        finalReply=None, confidence=0.5, reasoning="r",
        status=AgentActionStatus.PENDING,
    )

    committed = {"flag": False}
    class _Session:
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def query(self, m):
            class _Q:
                def filter(self, *a, **k): return self
                def first(_self): return action
            return _Q()
        def commit(self): committed["flag"] = True
        def refresh(self, obj): pass
    monkeypatch.setattr(support_mod, "SessionLocal", _Session)

    # Fake task with apply_async that records countdown
    calls = []
    class _FakeTask:
        def apply_async(self, kwargs=None, countdown=None):
            calls.append({"kwargs": kwargs, "countdown": countdown})
            class _Result:
                id = "task-xyz"
            return _Result()
    monkeypatch.setattr(support_mod, "_get_past_action_task", lambda: _FakeTask())

    client = TestClient(main_mod.app)
    resp = client.post("/agent/actions/a1/approve", json={"reply": "final text"})
    assert resp.status_code == 200
    assert action.finalReply == "final text"
    assert action.status == AgentActionStatus.APPROVED
    assert committed["flag"]
    assert calls[0]["countdown"] == 10
    assert calls[0]["kwargs"] == {"action_id": "a1"}
```

- [ ] **Step 2: Run — expected FAIL**

Run: `cd agents && pytest tests/test_approve_deferred_memory.py -v`

- [ ] **Step 3: Refactor approve endpoint**

In `agents/app/routers/support.py`:

Add at module level:

```python
def _get_past_action_task():
    """Indirection so tests can monkeypatch without importing Celery."""
    from app.worker.tasks import embed_past_action
    return embed_past_action


def _enqueue_past_action_deferred(action_id: str, countdown_s: int = 10) -> Optional[str]:
    if os.environ.get("MEMORY_ENABLED", "true").lower() != "true":
        return None
    try:
        task = _get_past_action_task()
        result = task.apply_async(kwargs={"action_id": action_id}, countdown=countdown_s)
        return result.id
    except Exception as e:
        _log.warning("deferred past-action enqueue failed: %s", e)
        return None
```

Add `import os` and `from typing import Optional` at top if missing.

Extend `EditRequest`:

```python
class EditRequest(BaseModel):
    reply: str
```

(already exists)

Replace both `approve_action` and `edit_action` with a unified approve-with-body:

```python
    @router.post("/actions/{action_id}/approve", response_model=AgentActionOut)
    def approve_action(action_id: str, body: Optional[EditRequest] = None):
        with SessionLocal() as session:
            action = session.query(AgentAction).filter(AgentAction.id == action_id).first()
            if not action:
                raise HTTPException(status_code=404, detail="Action not found")
            if action.status != AgentActionStatus.PENDING:
                raise HTTPException(status_code=400, detail=f"Action is {action.status.value}, not PENDING")

            final_text = body.reply if body and body.reply else action.draftReply
            action.status = AgentActionStatus.APPROVED
            action.finalReply = final_text
            session.commit()
            session.refresh(action)

            task_id = _enqueue_past_action_deferred(action.id, countdown_s=10)
            # Store task id so unsend can revoke — small stash table or hash column on action.
            # For simplicity: put task id in a module-level dict keyed by action id.
            _PENDING_MEMORY_TASKS[action.id] = task_id

            return AgentActionOut(
                id=action.id,
                businessId=action.businessId,
                customerMsg=action.customerMsg,
                draftReply=action.draftReply,
                finalReply=action.finalReply,
                confidence=action.confidence,
                reasoning=action.reasoning,
                status=action.status.value,
                createdAt=action.createdAt.isoformat(),
            )
```

Remove the old `edit_action` (the `/actions/{id}/edit` route). Clients call `/approve` with a body to edit.

At module level, add:

```python
_PENDING_MEMORY_TASKS: dict[str, Optional[str]] = {}
```

Remove the existing `_enqueue_past_action` function (superseded by the deferred variant).

- [ ] **Step 4: Run tests — expected PASS**

Run: `cd agents && pytest tests/test_approve_deferred_memory.py tests/ -v`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add agents/app/routers/support.py agents/tests/test_approve_deferred_memory.py
git commit -m "feat(router): unified /approve with body; deferred memory enqueue (10s countdown)"
```

---

## Task 17: Unsend endpoint

**Files:**
- Modify: `agents/app/routers/support.py`
- Create: `agents/tests/test_unsend.py`

- [ ] **Step 1: Write failing test**

```python
# agents/tests/test_unsend.py
from datetime import datetime, timezone, timedelta
from fastapi.testclient import TestClient


def _make_action_stub(status, updatedAt):
    from app.db import AgentAction, AgentActionStatus
    a = AgentAction(
        id="a1", businessId="b", customerMsg="m", draftReply="d",
        finalReply="sent", confidence=0.5, reasoning="r",
        status=getattr(AgentActionStatus, status),
    )
    a.updatedAt = updatedAt
    return a


def test_unsend_within_window_restores_pending(monkeypatch):
    import app.main as main_mod
    import app.routers.support as support_mod

    action = _make_action_stub("APPROVED", datetime.now(timezone.utc) - timedelta(seconds=3))

    committed = {"flag": False}
    class _Session:
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def query(self, m):
            class _Q:
                def filter(_q, *a, **k): return _q
                def first(_q): return action
            return _Q()
        def commit(self): committed["flag"] = True
    monkeypatch.setattr(support_mod, "SessionLocal", _Session)

    revoked = []
    monkeypatch.setattr(support_mod, "_revoke_memory_task", lambda aid: revoked.append(aid))

    client = TestClient(main_mod.app)
    resp = client.post("/agent/actions/a1/unsend")
    assert resp.status_code == 200
    from app.db import AgentActionStatus
    assert action.status == AgentActionStatus.PENDING
    assert action.finalReply is None
    assert revoked == ["a1"]


def test_unsend_after_window_returns_409(monkeypatch):
    import app.main as main_mod
    import app.routers.support as support_mod

    action = _make_action_stub("APPROVED", datetime.now(timezone.utc) - timedelta(seconds=30))
    class _Session:
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def query(self, m):
            class _Q:
                def filter(_q, *a, **k): return _q
                def first(_q): return action
            return _Q()
        def commit(self): pass
    monkeypatch.setattr(support_mod, "SessionLocal", _Session)

    client = TestClient(main_mod.app)
    resp = client.post("/agent/actions/a1/unsend")
    assert resp.status_code == 409


def test_unsend_rejects_non_approved(monkeypatch):
    import app.main as main_mod
    import app.routers.support as support_mod

    action = _make_action_stub("PENDING", datetime.now(timezone.utc))
    class _Session:
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def query(self, m):
            class _Q:
                def filter(_q, *a, **k): return _q
                def first(_q): return action
            return _Q()
        def commit(self): pass
    monkeypatch.setattr(support_mod, "SessionLocal", _Session)

    client = TestClient(main_mod.app)
    resp = client.post("/agent/actions/a1/unsend")
    assert resp.status_code == 400
```

- [ ] **Step 2: Run — expected FAIL**

Run: `cd agents && pytest tests/test_unsend.py -v`

- [ ] **Step 3: Implement endpoint**

In `agents/app/routers/support.py`, add at module level:

```python
from datetime import datetime, timezone, timedelta

UNSEND_WINDOW_SECONDS = 10


def _revoke_memory_task(action_id: str):
    task_id = _PENDING_MEMORY_TASKS.pop(action_id, None)
    if not task_id:
        return
    try:
        from app.worker.celery_app import celery_app
        celery_app.control.revoke(task_id, terminate=False)
    except Exception as e:
        _log.warning("revoke memory task failed: %s", e)
```

Add inside `make_support_router`:

```python
    @router.post("/actions/{action_id}/unsend", response_model=AgentActionOut)
    def unsend_action(action_id: str):
        with SessionLocal() as session:
            action = session.query(AgentAction).filter(AgentAction.id == action_id).first()
            if not action:
                raise HTTPException(status_code=404, detail="Action not found")
            if action.status != AgentActionStatus.APPROVED:
                raise HTTPException(status_code=400, detail="Only APPROVED actions can be unsent")
            # action.updatedAt from the column is naive UTC-ish; compare as UTC
            updated = action.updatedAt
            if updated.tzinfo is None:
                updated = updated.replace(tzinfo=timezone.utc)
            if datetime.now(timezone.utc) - updated > timedelta(seconds=UNSEND_WINDOW_SECONDS):
                raise HTTPException(status_code=409, detail="Unsend window expired")
            action.status = AgentActionStatus.PENDING
            action.finalReply = None
            session.commit()
            session.refresh(action)
        _revoke_memory_task(action_id)
        return AgentActionOut(
            id=action.id, businessId=action.businessId, customerMsg=action.customerMsg,
            draftReply=action.draftReply, finalReply=action.finalReply,
            confidence=action.confidence, reasoning=action.reasoning,
            status=action.status.value, createdAt=action.createdAt.isoformat(),
        )
```

- [ ] **Step 4: Run tests — expected PASS**

Run: `cd agents && pytest tests/test_unsend.py -v`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add agents/app/routers/support.py agents/tests/test_unsend.py
git commit -m "feat(router): POST /actions/{id}/unsend with 10s window + Celery revoke"
```

---

## Task 18: Frontend — InboxAction type + server fns

**Files:**
- Modify: `app/src/lib/inbox-logic.ts`
- Modify: `app/src/lib/inbox-server-fns.ts`
- Modify: `app/src/__tests__/inbox-logic.test.ts`

- [ ] **Step 1: Read existing types**

Open `app/src/lib/inbox-logic.ts` and `app/src/lib/inbox-server-fns.ts`. Identify the `InboxAction` interface. (If it's defined via Prisma/generated types, extend via intersection instead of editing generated code.)

- [ ] **Step 2: Write failing test**

Append to `app/src/__tests__/inbox-logic.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { pickDisplayDraft } from '#/lib/inbox-logic'

describe('pickDisplayDraft', () => {
  it('prefers bestDraft when present', () => {
    const a = { bestDraft: 'rewrite', draftReply: 'v1' } as any
    expect(pickDisplayDraft(a)).toBe('rewrite')
  })
  it('falls back to draftReply when bestDraft is null', () => {
    const a = { bestDraft: null, draftReply: 'v1' } as any
    expect(pickDisplayDraft(a)).toBe('v1')
  })
  it('falls back to draftReply when bestDraft is undefined', () => {
    const a = { draftReply: 'v1' } as any
    expect(pickDisplayDraft(a)).toBe('v1')
  })
})
```

- [ ] **Step 3: Run — expected FAIL**

Run: `cd app && pnpm vitest run src/__tests__/inbox-logic.test.ts`
Expected: `pickDisplayDraft` not exported.

- [ ] **Step 4: Extend `InboxAction` type + add helper**

In `app/src/lib/inbox-logic.ts`, extend the `InboxAction` interface:

```ts
export interface InboxAction {
  // ...existing fields...
  bestDraft: string | null
  escalationSummary: string | null
}

export function pickDisplayDraft(action: Pick<InboxAction, 'bestDraft' | 'draftReply'>): string {
  return action.bestDraft ?? action.draftReply
}
```

(Adjust to match whatever the current `InboxAction` shape is — add the two optional fields and the helper.)

- [ ] **Step 5: Add `unsendAction` server fn**

In `app/src/lib/inbox-server-fns.ts`, add:

```ts
export async function unsendAction(actionId: string): Promise<void> {
  const r = await fetch(`${AGENTS_BASE_URL}/agent/actions/${actionId}/unsend`, {
    method: 'POST',
  })
  if (!r.ok) {
    const detail = await r.text()
    throw new Error(`Unsend failed: ${r.status} ${detail}`)
  }
}

export async function fetchIterations(actionId: string): Promise<unknown[]> {
  const r = await fetch(`${AGENTS_BASE_URL}/agent/actions/${actionId}/iterations`)
  if (!r.ok) throw new Error(`Iterations fetch failed: ${r.status}`)
  const data = await r.json()
  return data.iterations ?? []
}
```

(Use whatever base-URL pattern the file already uses for `AGENTS_BASE_URL`.)

Also update wherever `InboxAction` is populated from the API to pass through `bestDraft` and `escalationSummary`.

- [ ] **Step 6: Run tests — expected PASS**

Run: `cd app && pnpm vitest run src/__tests__/inbox-logic.test.ts`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add app/src/lib/inbox-logic.ts app/src/lib/inbox-server-fns.ts app/src/__tests__/inbox-logic.test.ts
git commit -m "feat(inbox): extend InboxAction with bestDraft+escalationSummary; add unsend/iterations fns"
```

---

## Task 19: Frontend — action-detail-panel refactor (Send + undo toast)

**Files:**
- Modify: `app/src/components/inbox/action-detail-panel.tsx`

- [ ] **Step 1: Inspect current shadcn toast availability**

Run: `ls app/src/components/ui/ | grep -i toast`

If `toast.tsx` / `use-toast.ts` / `sonner.tsx` exists, use it. Otherwise add a minimal inline toast state in the panel.

- [ ] **Step 2: Refactor panel**

Rewrite `app/src/components/inbox/action-detail-panel.tsx`. Full file (replace entirely):

```tsx
import React from 'react'
import { Check, Pencil, X } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { Textarea } from '#/components/ui/textarea'
import type { InboxAction } from '#/lib/inbox-logic'
import { pickDisplayDraft } from '#/lib/inbox-logic'
import { unsendAction } from '#/lib/inbox-server-fns'
import { IterationTrail } from '#/components/inbox/iteration-trail'

interface ActionDetailPanelProps {
  action: InboxAction | null
  onApprove?: (action: InboxAction, reply: string) => Promise<void>
  onReject?: (action: InboxAction) => Promise<void>
  readOnly?: boolean
}

const UNDO_MS = 5000

export function ActionDetailPanel({ action, onApprove, onReject, readOnly = false }: ActionDetailPanelProps) {
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [showTrail, setShowTrail] = React.useState(false)
  const [undoState, setUndoState] = React.useState<{ actionId: string; expiresAt: number } | null>(null)
  const [undoRemaining, setUndoRemaining] = React.useState(0)

  React.useEffect(() => {
    if (action) {
      setDraft(pickDisplayDraft(action))
      setEditing(false)
      setError(null)
      setShowTrail(false)
    }
  }, [action?.id])

  // Undo countdown timer
  React.useEffect(() => {
    if (!undoState) return
    const interval = setInterval(() => {
      const remaining = Math.max(0, undoState.expiresAt - Date.now())
      setUndoRemaining(remaining)
      if (remaining <= 0) {
        setUndoState(null)
      }
    }, 100)
    return () => clearInterval(interval)
  }, [undoState])

  if (!action) {
    return (
      <div className="w-[480px] shrink-0 flex items-center justify-center" style={{ background: '#0c0c0f', borderLeft: '1px solid #1a1a1e', color: '#444' }}>
        <p className="text-[12px]" style={{ fontFamily: 'var(--font-mono)' }}>Select an item to review</p>
      </div>
    )
  }

  const canAct = !readOnly && action.status === 'PENDING' && !!onApprove

  async function run(fn: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed')
    } finally {
      setBusy(false)
    }
  }

  async function handleSend() {
    if (!action || !onApprove) return
    const reply = (editing ? draft : pickDisplayDraft(action)).trim()
    if (!reply) return
    await onApprove(action, reply)
    setEditing(false)
    setUndoState({ actionId: action.id, expiresAt: Date.now() + UNDO_MS })
    setUndoRemaining(UNDO_MS)
  }

  async function handleUndo() {
    if (!undoState) return
    try {
      await unsendAction(undoState.actionId)
      setUndoState(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Undo failed')
    }
  }

  const label = (t: string) => (
    <span className="text-[10px] uppercase tracking-[0.14em] font-medium" style={{ color: '#555', fontFamily: 'var(--font-mono)' }}>
      {t}
    </span>
  )

  const headerText = action.status === 'PENDING' ? "I need your input on this one" : `Status: ${action.status}`

  return (
    <aside className="w-[480px] shrink-0 flex flex-col h-full overflow-auto" style={{ background: '#0c0c0f', borderLeft: '1px solid #1a1a1e' }}>
      <div className="px-6 py-5 border-b" style={{ borderColor: '#1a1a1e' }}>
        <p className="text-[9px] uppercase tracking-[0.2em] mb-1" style={{ color: '#444', fontFamily: 'var(--font-mono)' }}>
          Review
        </p>
        <h2 className="text-[15px] font-bold" style={{ color: '#f0ede8', fontFamily: 'var(--font-display)' }}>
          {headerText}
        </h2>
        {action.status === 'PENDING' && action.escalationSummary && (
          <p className="mt-2 text-[12px]" style={{ color: '#e8c07d' }}>
            {action.escalationSummary}
          </p>
        )}
      </div>

      <div className="px-6 py-5 flex flex-col gap-5">
        <div>
          {label('Customer message')}
          <p className="mt-1.5 text-[13px] leading-relaxed" style={{ color: '#e8e6e2' }}>{action.customerMsg}</p>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            {label('Suggested reply')}
            {canAct && !editing && (
              <button
                onClick={() => setEditing(true)}
                className="text-[11px] flex items-center gap-1"
                style={{ color: '#3b7ef8', fontFamily: 'var(--font-mono)' }}
              >
                <Pencil size={11} /> edit
              </button>
            )}
          </div>
          {editing ? (
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={5}
              style={{ background: '#16161a', borderColor: '#2a2a32', color: '#e8e6e2', resize: 'none' }}
            />
          ) : (
            <p className="text-[13px] leading-relaxed p-3 rounded-lg" style={{ background: '#16161a', color: '#c8c5c0', border: '1px solid #1a1a1e' }}>
              {action.finalReply ?? pickDisplayDraft(action)}
            </p>
          )}
        </div>

        {error && <p className="text-[12px]" style={{ color: '#ef4444' }}>{error}</p>}

        {canAct && (
          <div className="flex gap-2 mt-2">
            <Button
              onClick={() => run(handleSend)}
              disabled={busy || !(editing ? draft : pickDisplayDraft(action))?.trim()}
              className="flex-1 h-11 flex items-center justify-center gap-1.5"
              style={{ background: '#00c97a', color: '#0a0a0c', fontSize: 14, fontWeight: 600 }}
            >
              <Check size={16} /> Send
            </Button>
            <Button
              onClick={() => onReject && run(() => onReject(action))}
              disabled={busy || !onReject}
              variant="ghost"
              className="flex items-center gap-1.5"
              style={{ color: '#666' }}
            >
              <X size={14} /> Skip
            </Button>
          </div>
        )}

        <button
          onClick={() => setShowTrail((v) => !v)}
          className="text-[11px] mt-6 self-start"
          style={{ color: '#555', fontFamily: 'var(--font-mono)' }}
        >
          {showTrail ? '▾' : '▸'} see AI's thinking
        </button>
        {showTrail && <IterationTrail actionId={action.id} />}
      </div>

      {undoState && undoRemaining > 0 && (
        <div className="fixed bottom-6 right-6 flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg"
          style={{ background: '#16161a', border: '1px solid #2a2a32', color: '#e8e6e2' }}>
          <span className="text-[12px]">Reply sent ({Math.ceil(undoRemaining / 1000)}s)</span>
          <button onClick={handleUndo} className="text-[12px] font-semibold" style={{ color: '#3b7ef8' }}>
            Undo
          </button>
        </div>
      )}
    </aside>
  )
}
```

- [ ] **Step 3: Update inbox route to use new onApprove signature**

Open `app/src/routes/$businessCode/inbox.tsx`. Find where `ActionDetailPanel` is rendered. Change `onApprove` / `onEdit` handlers so `onApprove` now takes `(action, reply)`:

```tsx
onApprove={async (action, reply) => {
  await approveAction(action.id, { reply })
  // invalidate/refetch inbox list
}}
```

Where `approveAction` is the existing server fn that hits `POST /agent/actions/{id}/approve` — it now takes a body. Update `app/src/lib/inbox-server-fns.ts`:

```ts
export async function approveAction(actionId: string, body?: { reply?: string }): Promise<void> {
  const r = await fetch(`${AGENTS_BASE_URL}/agent/actions/${actionId}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
  if (!r.ok) throw new Error(`Approve failed: ${r.status}`)
}
```

Remove any `editAction` client fn / usage that calls `/edit`.

- [ ] **Step 4: Run tests + typecheck**

Run: `cd app && pnpm vitest run && pnpm tsc --noEmit`
Expected: no type errors, all tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/src/components/inbox/action-detail-panel.tsx app/src/routes/$businessCode/inbox.tsx app/src/lib/inbox-server-fns.ts
git commit -m "feat(inbox): Send+undo toast, progressive trail, escalation summary surface"
```

---

## Task 20: Frontend — IterationTrail component

**Files:**
- Create: `app/src/components/inbox/iteration-trail.tsx`

- [ ] **Step 1: Write component**

```tsx
// app/src/components/inbox/iteration-trail.tsx
import React from 'react'
import { fetchIterations } from '#/lib/inbox-server-fns'

interface TrailEntry {
  stage: string
  draft?: { reply?: string } | null
  verdict?: { verdict?: string; reason?: string } | null
  gate_results?: Record<string, unknown>
  latency_ms?: number | null
}

interface IterationTrailProps {
  actionId: string
}

export function IterationTrail({ actionId }: IterationTrailProps) {
  const [entries, setEntries] = React.useState<TrailEntry[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let active = true
    fetchIterations(actionId)
      .then((raw) => {
        if (active) setEntries(raw as TrailEntry[])
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : String(e))
      })
    return () => { active = false }
  }, [actionId])

  if (error) return <p className="text-[11px]" style={{ color: '#ef4444' }}>{error}</p>
  if (!entries) return <p className="text-[11px]" style={{ color: '#555', fontFamily: 'var(--font-mono)' }}>loading…</p>
  if (entries.length === 0) return <p className="text-[11px]" style={{ color: '#555', fontFamily: 'var(--font-mono)' }}>no iterations</p>

  return (
    <div className="flex flex-col gap-3 mt-2 text-[11px]" style={{ fontFamily: 'var(--font-mono)', color: '#888' }}>
      {entries.map((e, i) => (
        <div key={i} className="border-l-2 pl-3" style={{ borderColor: '#2a2a32' }}>
          <div className="flex items-center gap-2">
            <span style={{ color: '#c8c5c0' }}>[{e.stage}]</span>
            {e.verdict?.verdict && (
              <span style={{ color: verdictColor(e.verdict.verdict) }}>{e.verdict.verdict}</span>
            )}
            {typeof e.latency_ms === 'number' && (
              <span style={{ color: '#555' }}>{e.latency_ms}ms</span>
            )}
          </div>
          {e.verdict?.reason && <div style={{ color: '#888' }}>{e.verdict.reason}</div>}
          {e.draft?.reply && (
            <div className="mt-1" style={{ color: '#aaa' }}>
              {e.draft.reply.length > 200 ? e.draft.reply.slice(0, 200) + '…' : e.draft.reply}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function verdictColor(v: string): string {
  switch (v) {
    case 'pass': return '#00c97a'
    case 'revise': return '#e8c07d'
    case 'rewrite': return '#e8c07d'
    case 'escalate': return '#ef4444'
    default: return '#888'
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `cd app && pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/src/components/inbox/iteration-trail.tsx
git commit -m "feat(inbox): IterationTrail component with lazy fetch + verdict coloring"
```

---

## Task 21: Frontend — undo timing test

**Files:**
- Create: `app/src/__tests__/undo-timing.test.ts`

- [ ] **Step 1: Write test**

```ts
// app/src/__tests__/undo-timing.test.ts
import { describe, it, expect, vi } from 'vitest'

describe('undo fetch', () => {
  it('calls POST /unsend with correct path', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => '' })
    ;(globalThis as any).fetch = fetchMock
    const { unsendAction } = await import('#/lib/inbox-server-fns')
    await unsendAction('a1')
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/agent/actions/a1/unsend'), expect.objectContaining({ method: 'POST' }))
  })

  it('throws on non-OK response', async () => {
    ;(globalThis as any).fetch = vi.fn().mockResolvedValue({ ok: false, status: 409, text: async () => 'expired' })
    const { unsendAction } = await import('#/lib/inbox-server-fns')
    await expect(unsendAction('a1')).rejects.toThrow(/409/)
  })
})
```

- [ ] **Step 2: Run — expected PASS**

Run: `cd app && pnpm vitest run src/__tests__/undo-timing.test.ts`
Expected: 2 passed.

- [ ] **Step 3: Commit**

```bash
git add app/src/__tests__/undo-timing.test.ts
git commit -m "test(inbox): unsendAction fetch path + error surfacing"
```

---

## Task 22: .env.example and documentation

**Files:**
- Create or modify: `agents/.env.example`

- [ ] **Step 1: Check current file**

Run: `cat agents/.env.example 2>/dev/null || echo "no file"`

- [ ] **Step 2: Add MANAGER_ENABLED entry**

Append to `agents/.env.example` (create if missing):

```env
# When true, requests go through the Manager supervisor layer
# (mechanical gates + LLM verdict over Jual's draft, with one
# bounded revision + text-only rewrite fallback before escalating
# to human approval). See docs/superpowers/specs/2026-04-24-manager-brain-agent-design.md
MANAGER_ENABLED=false
```

- [ ] **Step 3: Commit**

```bash
git add agents/.env.example
git commit -m "docs(env): document MANAGER_ENABLED flag"
```

---

## Task 23: End-to-end smoke test

**Files:**
- Create: `agents/tests/test_manager_e2e.py`

- [ ] **Step 1: Write end-to-end test**

```python
# agents/tests/test_manager_e2e.py
"""Full graph integration test — all nodes wired, mocked LLMs, in-memory DB stub."""
import pytest
from langchain_core.messages import HumanMessage
from app.schemas.agent_io import StructuredReply, ManagerVerdict, ManagerCritique, FactRef


class _SequentialJualLLM:
    """Returns different payloads on successive calls (v1 draft, v2 redraft)."""
    def __init__(self, payloads):
        self._payloads = list(payloads)
        self._idx = 0
    def bind_tools(self, tools): return self
    def with_structured_output(self, schema):
        outer = self
        class _W:
            async def ainvoke(self, h):
                pl = outer._payloads[outer._idx]
                outer._idx += 1
                return StructuredReply.model_validate(pl)
        return _W()
    async def ainvoke(self, history):
        import json
        from langchain_core.messages import AIMessage
        pl = self._payloads[self._idx]
        self._idx += 1
        return AIMessage(content=json.dumps(pl))


class _SequentialManagerLLM:
    def __init__(self, verdicts):
        self._verdicts = list(verdicts)
        self._idx = 0
    def with_structured_output(self, schema):
        outer = self
        class _W:
            async def ainvoke(self, prompt):
                if schema.__name__ == "ManagerVerdict":
                    v = outer._verdicts[outer._idx]
                    outer._idx += 1
                    return v
                # Manager rewrite uses StructuredReply schema
                return StructuredReply(
                    reply="manager rewrite",
                    facts_used=[FactRef(kind="product", id="p1")],
                )
        return _W()


@pytest.mark.asyncio
async def test_revise_then_pass_ends_auto_sent(monkeypatch):
    import app.agents.manager as mgr

    monkeypatch.setattr(mgr, "_load_shared_context_impl", lambda s: {
        "business_context": "Business: Test",
        "memory_block": "",
        "valid_fact_ids": {"product:p1"},
    })
    writes = []
    class _Session:
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def add(self, r): writes.append(r)
        def commit(self): pass
    monkeypatch.setattr("app.agents.manager_terminal.SessionLocal", _Session)
    monkeypatch.setattr("app.agents.manager_terminal._enqueue_memory_write", lambda *a, **k: None)

    # v1 has unaddressed Q → gate 3 forces revise
    v1 = {"reply": "RM10", "confidence": 0.8, "reasoning": "r",
          "addressed_questions": [], "unaddressed_questions": ["stock?"],
          "facts_used": [{"kind": "product", "id": "p1"}], "needs_human": False}
    # v2 resolves unaddressed
    v2 = {"reply": "RM10, 5 in stock", "confidence": 0.9, "reasoning": "r",
          "addressed_questions": ["harga?", "stock?"], "unaddressed_questions": [],
          "facts_used": [{"kind": "product", "id": "p1"}], "needs_human": False}

    jual_llm = _SequentialJualLLM([v1, v2])
    manager_llm = _SequentialManagerLLM([
        # First evaluate (on v1): gate 3 fires BEFORE LLM — this verdict is never consumed.
        ManagerVerdict(verdict="revise", reason="unused"),
        # Second evaluate (on v2): gates pass, LLM says pass
        ManagerVerdict(verdict="pass", reason="all addressed"),
    ])

    graph = mgr.build_manager_graph(jual_llm=jual_llm, manager_llm=manager_llm)
    result = await graph.ainvoke({
        "messages": [HumanMessage(content="harga ondeh? ada stock?")],
        "business_id": "biz1",
        "customer_id": "c1",
        "customer_phone": "60123",
        "revision_count": 0,
        "iterations": [],
    })
    assert result["final_action"] == "auto_send"
    row = writes[0]
    assert row.status.value == "AUTO_SENT"
    # Two iteration entries: jual_v1 + jual_v2
    assert len(row.iterations) == 2
    assert row.iterations[0]["stage"] == "jual_v1"
    assert row.iterations[1]["stage"] == "jual_v2"


@pytest.mark.asyncio
async def test_rewrite_then_escalate_when_rewrite_hallucinates(monkeypatch):
    import app.agents.manager as mgr
    import app.agents.manager_rewrite as mrw

    monkeypatch.setattr(mgr, "_load_shared_context_impl", lambda s: {
        "business_context": "Business: Test",
        "memory_block": "",
        "valid_fact_ids": {"product:p1"},
    })
    writes = []
    class _Session:
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def add(self, r): writes.append(r)
        def commit(self): pass
    monkeypatch.setattr("app.agents.manager_terminal.SessionLocal", _Session)
    monkeypatch.setattr("app.agents.manager_terminal._enqueue_memory_write", lambda *a, **k: None)

    # v1 has a hallucinated fact → gate 2 says rewrite
    v1 = {"reply": "RM5 for ghost", "confidence": 0.9, "reasoning": "r",
          "addressed_questions": ["harga?"], "unaddressed_questions": [],
          "facts_used": [{"kind": "product", "id": "ghost"}], "needs_human": False}

    jual_llm = _SequentialJualLLM([v1])

    # Manager rewrite ALSO hallucinates — gates_only_check must escalate
    class _RewriteHallucinateLLM:
        def __init__(self): self._call = 0
        def with_structured_output(self, schema):
            parent = self
            class _W:
                async def ainvoke(self, prompt):
                    parent._call += 1
                    if schema.__name__ == "ManagerVerdict":
                        return ManagerVerdict(verdict="rewrite", reason="gate:ungrounded_fact:product:ghost")
                    # Rewrite: still hallucinates
                    return StructuredReply(
                        reply="rewrite text",
                        facts_used=[FactRef(kind="product", id="phantom")],
                    )
            return _W()

    graph = mgr.build_manager_graph(jual_llm=jual_llm, manager_llm=_RewriteHallucinateLLM())
    result = await graph.ainvoke({
        "messages": [HumanMessage(content="harga?")],
        "business_id": "biz1",
        "customer_id": "c1",
        "customer_phone": "60123",
        "revision_count": 0,
        "iterations": [],
    })
    assert result["final_action"] == "escalate"
    row = writes[0]
    assert row.status.value == "PENDING"
```

- [ ] **Step 2: Run — expected PASS**

Run: `cd agents && pytest tests/test_manager_e2e.py -v`
Expected: 2 passed.

- [ ] **Step 3: Run full agents suite + app suite**

Run:
```bash
cd agents && pytest tests/ -v
cd ../app && pnpm vitest run && pnpm tsc --noEmit
```
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add agents/tests/test_manager_e2e.py
git commit -m "test(manager): E2E revise→pass and rewrite→escalate scenarios"
```

---

## Manual QA checklist (after all tasks)

Not automated — run through after flag flip:

- [ ] Set `MANAGER_ENABLED=true` in `agents/.env`, run `./scripts/dev.sh env` to reload.
- [ ] Send a factual buyer message ("berapa harga X?") with grounded product data → expect auto-send.
- [ ] Send a refund request → expect escalation with "Refund, complaint, or sensitive issue" summary.
- [ ] Open the inbox, click PENDING item — verify the Send button is the dominant action.
- [ ] Click Send — verify 5-second undo toast appears. Click Undo — verify action returns to PENDING.
- [ ] Send again, let timer expire — verify `finalReply` persists and no undo available.
- [ ] Expand "see AI's thinking" — verify iteration trail loads with stages + verdicts.
- [ ] Set `MANAGER_ENABLED=false`, confirm legacy path still functions for a simple message.

---

## Out of scope (tracked for later)

- Keyboard shortcuts for Send/Skip on approval card.
- Escalation-rate dashboard.
- Budget caps on Manager LLM spend per business.
- Multi-specialist supervisor dispatch (second specialist arrives, then expand).
- Calibration analysis job over accumulated Jual-v1 `confidence` telemetry.
