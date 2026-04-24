# Manager Brain Agent — Design

**Date:** 2026-04-24
**Status:** Approved (brainstorm complete)
**Branch (at time of writing):** `atan`

## Problem

Today, `customer_support` (branded "Jual") drafts buyer replies and routes on a self-reported `confidence` float. Below threshold, drafts go straight to a human approval queue. This wastes the operator's time on replies that an LLM could refine further, and the float-based routing signal is unreliable (LLM self-confidence is miscalibrated — scores cluster 0.7-0.9 regardless of draft quality).

We want a "brain" layer (**Manager**) that sits between Jual and the approval queue:

- Evaluates Jual's draft with mechanical gates first, then a discrete-verdict LLM call.
- Asks Jual to revise **once** if the draft has specific fixable issues.
- Rewrites directly (text-only, no tools) if revision fails.
- Escalates to the human operator only when even the rewrite can't be trusted.

The operator is a student; escalations must feel rare and high-signal.

## Non-goals

- No ralph-style indefinite loop. Revision is bounded at one pass.
- No multi-specialist supervisor. Jual is the only specialist today; Manager always dispatches to Jual.
- No migration of Jual's name or tool surface. "Jual" is a brand label; module stays `customer_support.py`.
- No replacement of `confidence` DB column. Kept as Jual-v1 self-report for telemetry only.
- No UI for side-by-side v1/v2/rewrite comparison. Progressive disclosure covers this.

## Guiding principles

1. **Reject numeric LLM self-confidence as a routing signal.** Use discrete verdicts + structural self-reports + mechanical gates. Rationale in `memory/feedback_llm_confidence_scores.md`.
2. **Lean permissive.** Escalation target ~5-10% of turns. Operator time is a first-class constraint. Rationale in `memory/project_operator_persona.md`.
3. **Bound iteration.** One revise pass max, then rewrite, then escalate. No graph recursion.
4. **Fail loud on invariants.** Missing drafts, unresolved final replies → raise, log, don't ship empty strings to buyers.
5. **Memory reflects reality.** Only sent replies enter memory. Drafts awaiting approval don't.

---

## Section 1 — Architecture

**New module:** `agents/app/agents/manager.py`. Uses compiled `customer_support` subgraph.

**Schemas module:** `agents/app/schemas/agent_io.py` — `StructuredReply`, `ManagerCritique`, `ManagerVerdict`, `FactRef`, `IterationEntry`. Both `customer_support.py` and `manager.py` import from here.

### ManagerState (TypedDict)

- shared: `business_id`, `business_context`, `customer_id`, `customer_phone`, `memory_block`, `messages`
- `valid_fact_ids: set[str]` — populated by `load_shared_context` from products/orders/kb/memory
- `jual_draft: StructuredReply | None`
- `verdict: Literal["pass","revise","rewrite","escalate"] | None`
- `critique: ManagerCritique | None`
- `gate_results: dict | None`
- `revision_count: int` (starts 0)
- `iterations: list[IterationEntry]` — audit trail
- `final_reply: str | None`
- `final_action: Literal["auto_send","escalate"] | None`

### Nodes

| Node | Writes to state | Notes |
|------|-----------------|-------|
| `load_shared_context` | `business_context`, `memory_block`, `valid_fact_ids` | Single pass, shared across subgraph |
| `dispatch_jual` | `jual_draft`; appends `{stage:"jual_v1", draft}` iteration | Invokes Jual with `revision_mode="draft"` |
| `dispatch_jual_revise` | `jual_draft` overwrite; `revision_count += 1`; appends `{stage:"jual_v2", draft}` | Invokes Jual with `revision_mode="redraft"`, `previous_draft`, `critique` |
| `evaluate` | `verdict`, `critique`, `gate_results`; mutates **most-recent** iteration entry's `verdict`/`gate_results` — does NOT append | Gates first, LLM if gates pass |
| `manager_rewrite` | `final_reply`; appends `{stage:"manager_rewrite", draft}` iteration | Text-only, no tools |
| `gates_only_check` | Sets `final_action_hint` | Mechanical gates only on rewrite, no LLM |
| `finalize` (auto-send) | Writes AgentAction row with `iterations` JSONB, `status=AUTO_SENT` | Only DB write on happy path |
| `queue_for_human` | Writes AgentAction row with `iterations` JSONB, `status=PENDING` | Only DB write on escalate path |

### Routing

`route_verdict` is a **conditional edge function**, not a node. Registered via `add_conditional_edges("evaluate", route_verdict, {...})`.

```python
def route_verdict(state):
    v = state["verdict"]
    if v == "pass":     return "finalize"
    if v == "revise":
        if state["revision_count"] >= 1:
            return "manager_rewrite"
        return "dispatch_jual_revise"
    if v == "rewrite":  return "manager_rewrite"
    if v == "escalate": return "queue_for_human"
```

One-pass bound is a first-class invariant via `revision_count`, not graph topology.

### Evaluator output contract

```python
class EvaluateResult(TypedDict):
    verdict: Literal["pass","revise","rewrite","escalate"]
    critique: ManagerCritique | None   # ONLY when verdict == "revise"
    gate_results: dict
```

### Jual subgraph contract (refactor of `customer_support`)

`SupportAgentState` adds: `revision_mode: Literal["draft","redraft"]`, `previous_draft: StructuredReply | None`, `critique: ManagerCritique | None`. Internal entry router branches on `revision_mode`:

- `"draft"` → existing path (`load_context` → `load_memory` → `draft_reply`)
- `"redraft"` → `redraft_reply` directly (Manager pre-loaded context/memory into state)

### DB persistence rule

`iterations` lives in state during execution. Written to `AgentAction.iterations` JSONB **only** by `finalize` or `queue_for_human`. No intermediate writes.

### Deferred

Evaluator LLM prompt tunes toward permissive `pass` — target ~5-10% escalation rate. Prompt-engineering detail handled in Section 3.

---

## Section 2 — Schemas

```python
# agents/app/schemas/agent_io.py
from typing import Literal
from pydantic import BaseModel, Field


class FactRef(BaseModel):
    """Identity key is (kind, id). Gate check uses f'{kind}:{id}' composite."""
    kind: Literal["product", "order", "kb", "memory"]
    id: str   # all IDs stringified at boundary


class StructuredReply(BaseModel):
    reply: str
    # legacy telemetry — NOT used for routing. Optional to tolerate prompt drift.
    confidence: float = Field(default=0.5, ge=0.0, le=1.0)
    reasoning: str = ""
    # structural fields drive Manager gates + verdict
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
    critique: ManagerCritique | None = None   # populated only when verdict == "revise"
    reason: str = Field(description="One-sentence audit justification")


class IterationEntry(BaseModel):
    stage: Literal["jual_v1", "jual_v2", "manager_rewrite"]
    draft: StructuredReply | None = None
    verdict: ManagerVerdict | None = None
    gate_results: dict = Field(default_factory=dict)
    latency_ms: int | None = None
```

### Fact-id gating convention

`load_shared_context` populates:

```python
state["valid_fact_ids"] = (
    {f"product:{p.id}" for p in products}
    | {f"order:{o.id}" for o in orders}
    | {f"kb:{c.id}" for c in kb_chunks}
    | {f"memory:{m.id}" for m in memories}
)
```

Gate check:

```python
for fact in draft.facts_used:
    if f"{fact.kind}:{fact.id}" not in state["valid_fact_ids"]:
        return fail  # hallucinated reference
```

### Migration

- Move inline `StructuredReply` from `customer_support.py:32-35` into `agents/app/schemas/agent_io.py`.
- Update imports in `customer_support.py` + `tests/test_json_parsing.py`.
- `AgentAction.confidence` column stays (telemetry from `StructuredReply.confidence`).
- New Alembic migration `0002_agent_action_iterations.py`:

  ```python
  op.add_column(
      "AgentAction",
      sa.Column(
          "iterations",
          postgresql.JSONB(),
          nullable=False,
          server_default=sa.text("'[]'::jsonb"),
      ),
  )
  ```

  NOT NULL + default `[]` eliminates null-guard branches.

- JSONB serialization: `[entry.model_dump(mode="json") for entry in state["iterations"]]`.

---

## Section 3 — Manager evaluator

Single `evaluate` node. Gates first; if all pass, LLM verdict.

### 3.1 Mechanical gates

First match wins. Flat table, no special-casing.

| # | Gate | Condition | Verdict | Reason slug |
|---|------|-----------|---------|-------------|
| 1 | `needs_human_flag` | `draft.needs_human is True` | `escalate` | `jual_self_flagged` |
| 2 | `hallucinated_fact` | any fact where `f"{kind}:{id}" ∉ valid_fact_ids` | `rewrite` | `ungrounded_fact:{kind}:{id}` |
| 3 | `unaddressed_first_pass` | `unaddressed_questions` non-empty AND `revision_count == 0` | `revise` | `jual_self_reported_gap` |
| 4 | `unaddressed_after_revise` | `unaddressed_questions` non-empty AND `revision_count >= 1` | `rewrite` | `revise_failed_to_close_gaps` |
| 5a | `ungrounded_factual_q_v1` | factual-Q regex AND `facts_used` empty AND `revision_count == 0` | `revise` | `ungrounded_factual_answer` |
| 5b | `ungrounded_factual_q_v2` | factual-Q regex AND `facts_used` empty AND `revision_count >= 1` | `rewrite` | `ungrounded_factual_answer_persists` |

### 3.2 Factual-question heuristic

```python
FACTUAL_Q_RE = re.compile(
    r"\b(harga|price|stock|ada\s|berapa|bila|macam\s+mana|bagaimana|mana|"
    r"how\s+much|available|when|order|cost)\b",
    re.IGNORECASE,
)
```

`\s` after `ada` avoids false match on idioms like "terima kasih ada jumpa lagi". Documented as tunable.

### 3.3 LLM verdict prompt

```python
def build_evaluator_prompt(state: ManagerState, draft: StructuredReply) -> str:
    parts = [
        SYSTEM_PREAMBLE,
        f"# Context\nBusiness: {state['business_context']}",
        f"\n# Memory\n{state['memory_block']}",
        f"\n# Conversation (last 6 turns — 3 buyer / 3 assistant max)\n{format_recent(state['messages'], n=6)}",
        f'\n# The specific message Jual is replying to\n"{extract_last_buyer_msg(state["messages"])}"',
        f"\n# Jual's draft\nReply: {draft.reply}\nAddressed: {draft.addressed_questions}\n"
        f"Facts used: {[f.model_dump() for f in draft.facts_used]}",
    ]
    if state["revision_count"] >= 1:
        prior = state["iterations"][-2].verdict.critique   # v1's critique
        parts.append(
            "\n# This is a REVISED draft (v2).\n"
            f"The original critique was:\n{prior.model_dump_json(indent=2)}\n"
            "Check specifically: did Jual address each point? "
            "If yes → lean pass. If Jual introduced new problems while fixing old → rewrite. "
            "Do NOT emit 'revise' — already revised once."
        )
    parts.append(VERDICT_CRITERIA_BLOCK)
    parts.append(
        "Always populate `reason` with a one-sentence justification — "
        "even on pass (e.g., 'all questions addressed with grounded facts')."
    )
    return "\n".join(parts)
```

`VERDICT_CRITERIA_BLOCK` is a static string constant containing the four-outcome taxonomy + permissive-lean rule + escalate-is-rare target.

### 3.4 Evaluator node (async, immutable state updates)

```python
async def evaluate(state: ManagerState) -> dict:
    draft = state["jual_draft"]
    gate_result = run_gates(
        draft,
        valid_fact_ids=state["valid_fact_ids"],
        revision_count=state["revision_count"],
        messages=state["messages"],
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
        verdict_obj = await manager_llm.with_structured_output(ManagerVerdict).ainvoke(prompt)
        via = "llm"
    latency_ms = int((time.monotonic() - t0) * 1000)

    current = state["iterations"][-1]
    updated = current.model_copy(update={
        "verdict": verdict_obj,
        "gate_results": gate_result.as_dict(),
        "latency_ms": (current.latency_ms or 0) + latency_ms,
    })

    _log.info("evaluator_decision", extra={
        "verdict": verdict_obj.verdict,
        "via": via,
        "revision_count": state["revision_count"],
        "stage": current.stage,
        "reason": verdict_obj.reason,
    })

    return {
        "iterations": [*state["iterations"][:-1], updated],
        "verdict": verdict_obj.verdict,
        "critique": verdict_obj.critique,
    }
```

No in-place mutation. `gate_results` lives on the iteration entry, not duplicated top-level.

### 3.5 Tests — `tests/test_manager_evaluator.py`

- Each gate row triggers its verdict deterministically (LLM monkeypatched to raise).
- Gate precedence: `needs_human` > hallucinated > unaddressed > factual-ground.
- `revision_count` flip: same input → `revise` at 0, `rewrite` at 1.
- LLM path: fake structured-output returns each of four verdicts.
- `gate_results` always populated on iteration entry after evaluate runs.
- Prompt-construction test: `build_evaluator_prompt` with `revision_count=1` contains `"REVISED draft"` AND the prior critique's JSON.
- State-shape test: `evaluate` returns new list for `iterations`; original reference unchanged.

---

## Section 4 — Jual subgraph refactor

### 4.1 State additions

```python
class SupportAgentState(TypedDict):
    # ...existing fields...
    revision_mode: Literal["draft", "redraft"]          # default "draft"
    previous_draft: StructuredReply | None
    critique: ManagerCritique | None
    structured_reply: StructuredReply | None            # full typed output
```

Existing `draft_reply`, `confidence`, `reasoning` stay (populated from `structured_reply` for back-compat). `action`, `action_id` removed — Manager owns terminal actions.

### 4.2 Entry router

```python
def _entry_route(state: SupportAgentState) -> Literal["load_context", "skip_to_draft"]:
    if state.get("revision_mode") == "redraft":
        return "skip_to_draft"
    return "load_context"
```

- `"draft"` → `load_context` → `load_memory` → `draft_reply` → END
- `"redraft"` → `redraft_reply` → END

### 4.3 `redraft_reply` node

Single LLM call, no tools. Uses `with_structured_output` directly.

```python
async def redraft_reply(state: SupportAgentState) -> dict:
    prev = state["previous_draft"]
    critique = state["critique"]
    system_prompt = SYSTEM_TEMPLATE.format(
        context=state["business_context"],
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
    history = [
        SystemMessage(content=system_prompt),
        *state["messages"],
        revision_instruction,
    ]
    response = await llm.with_structured_output(StructuredReply).ainvoke(history)
    return {
        "structured_reply": response,
        "draft_reply": response.reply,
        "confidence": response.confidence,
        "reasoning": response.reasoning,
    }
```

### 4.4 Draft-mode changes

`draft_reply` node keeps its tool loop but:

1. Emits new `StructuredReply` schema with all structural fields.
2. Populates `state["structured_reply"]` (typed) in addition to flat fields.
3. `SYSTEM_TEMPLATE` prompt rewritten with new JSON schema:

```
After any tool calls, respond with valid JSON only matching this schema:
{
  "reply": "<your reply — include payment URL verbatim when generated>",
  "confidence": <float 0.0-1.0>,
  "reasoning": "<one sentence>",
  "addressed_questions": ["<buyer Q you answered>", ...],
  "unaddressed_questions": ["<buyer Q you did NOT answer>", ...],
  "facts_used": [{"kind": "product|order|kb|memory", "id": "<id>"}, ...],
  "needs_human": <true only if refund/complaint/out-of-scope>
}

Rules:
- If you call create_payment_link, add {"kind":"product","id":"<product_id>"} to facts_used.
- If you call check_order_status, add {"kind":"order","id":"<order_id>"} for each order mentioned.
- Put skipped buyer questions verbatim in unaddressed_questions.
- needs_human=true only for: refund, complaint, shipping dispute, sensitive topic.
```

### 4.5 NL fallback disposition

**Drop NL fallback.** `_try_parse_nl_reply`, `_NL_REPLY_RE`, `nl_fallback_instruction` deleted. Current two-stage retry becomes: JSON retry once; on failure, return a synthesized draft with `needs_human=True`:

```python
try:
    response = await llm.ainvoke(history + [json_retry_instruction])
    retry_parsed = _try_parse_json_reply(response.content if isinstance(response.content, str) else "")
    if retry_parsed is not None:
        return _unpack(retry_parsed)
except Exception:
    pass

fallback = StructuredReply(
    reply="Sorry, I need someone to look at this properly. A human will reply shortly.",
    confidence=0.0,
    reasoning="JSON parsing failed twice",
    needs_human=True,
)
return _unpack(fallback)
```

Manager gate 1 escalates this deterministically.

### 4.6 Graph wiring

```python
graph.add_node("draft_reply", draft_reply)
graph.add_node("redraft_reply", redraft_reply)
graph.add_node("load_context", load_context)
graph.add_node("load_memory", _load_memory_node)
# removed: route_decision, auto_send, queue_approval

graph.add_conditional_edges(START, _entry_route, {
    "load_context": "load_context",
    "skip_to_draft": "redraft_reply",
})
graph.add_edge("load_context", "load_memory")
graph.add_edge("load_memory", "draft_reply")
graph.add_edge("draft_reply", END)
graph.add_edge("redraft_reply", END)
```

Jual becomes a pure draft-producer.

### 4.7 Router change

`agents/app/routers/agent.py` invokes `manager_graph` instead of `customer_support_graph`. HTTP boundary unchanged — Manager's `finalize`/`queue_for_human` populate the same fields.

### 4.8 Tests

- `tests/test_json_parsing.py` — drop NL-fallback tests, add parse-failure-escalation test.
- New `tests/test_redraft_mode.py` — entry router branches correctly; redraft uses `previous_draft` + `critique`; does NOT re-run `load_context`/`load_memory`; output schema valid.

---

## Section 5 — Manager terminal nodes + persistence

### 5.1 Terminal nodes

```python
async def finalize(state: ManagerState) -> dict:
    final_reply = _resolve_final_reply(state)
    jual_v1_confidence = _jual_v1_confidence(state)
    draft_for_history = _jual_v1_reply(state)
    action_id = generate_cuid()
    last_verdict = state["iterations"][-1].verdict

    with SessionLocal() as session:
        record = AgentAction(
            id=action_id,
            businessId=state["business_id"],
            customerMsg=_last_buyer_text(state["messages"]),
            draftReply=draft_for_history,
            finalReply=final_reply,
            confidence=jual_v1_confidence,
            reasoning=last_verdict.reason if last_verdict else "",
            status=AgentActionStatus.AUTO_SENT,
            iterations=[e.model_dump(mode="json") for e in state["iterations"]],
        )
        session.add(record)
        session.commit()
    _enqueue_memory_write(state, action_id, final_reply)
    return {"final_action": "auto_send", "action_id": action_id}


async def queue_for_human(state: ManagerState) -> dict:
    action_id = generate_cuid()
    best_draft = _pick_best_draft_for_human(state)
    escalation_summary = _build_escalation_summary(state)
    jual_v1_confidence = _jual_v1_confidence(state)
    draft_for_history = _jual_v1_reply(state)

    with SessionLocal() as session:
        record = AgentAction(
            id=action_id,
            businessId=state["business_id"],
            customerMsg=_last_buyer_text(state["messages"]),
            draftReply=draft_for_history,
            finalReply=None,
            confidence=jual_v1_confidence,
            reasoning=escalation_summary,
            status=AgentActionStatus.PENDING,
            iterations=[e.model_dump(mode="json") for e in state["iterations"]],
        )
        session.add(record)
        session.commit()
    # NO memory write here — deferred until student approves (5.7)
    return {"final_action": "escalate", "action_id": action_id, "best_draft": best_draft}
```

### 5.2 Helpers

```python
def _by_stage(state: ManagerState) -> dict[str, IterationEntry]:
    return {e.stage: e for e in state["iterations"]}


def _resolve_final_reply(state: ManagerState) -> str:
    resolved = (
        state.get("final_reply")
        or (state["jual_draft"].reply if state.get("jual_draft") else None)
        or (state["iterations"][-1].draft.reply
            if state["iterations"] and state["iterations"][-1].draft else None)
    )
    if not resolved:
        _log.error("finalize_no_reply", extra={"iterations": [e.stage for e in state["iterations"]]})
        raise RuntimeError("finalize reached without a resolvable reply")
    return resolved


def _jual_v1_reply(state: ManagerState) -> str:
    entry = _by_stage(state).get("jual_v1")
    return entry.draft.reply if entry and entry.draft else ""


def _jual_v1_confidence(state: ManagerState) -> float:
    entry = _by_stage(state).get("jual_v1")
    return entry.draft.confidence if entry and entry.draft else 0.0


def _pick_best_draft_for_human(state: ManagerState) -> str:
    """Preference order:
      1. manager_rewrite if all facts grounded
      2. jual_v2
      3. jual_v1
    Skip manager_rewrite if hallucinated (gate-2 escalation path).
    """
    by_stage = _by_stage(state)
    valid_ids = state.get("valid_fact_ids", set())

    rewrite = by_stage.get("manager_rewrite")
    if rewrite and rewrite.draft:
        if all(f"{f.kind}:{f.id}" in valid_ids for f in rewrite.draft.facts_used):
            return rewrite.draft.reply

    for stage in ("jual_v2", "jual_v1"):
        entry = by_stage.get(stage)
        if entry and entry.draft:
            return entry.draft.reply

    _log.warning("no_draft_for_escalation", extra={"iterations": [e.stage for e in state["iterations"]]})
    return ""
```

### 5.3 `gates_only_check` node (after `manager_rewrite`)

Mechanical only. No LLM. No recursion.

```python
async def gates_only_check(state: ManagerState) -> dict:
    rewrite_draft = state["iterations"][-1].draft
    for fact in rewrite_draft.facts_used:
        if f"{fact.kind}:{fact.id}" not in state["valid_fact_ids"]:
            return {"final_action_hint": "escalate", "final_reply": rewrite_draft.reply}
    if rewrite_draft.needs_human:
        return {"final_action_hint": "escalate", "final_reply": rewrite_draft.reply}
    return {"final_action_hint": "auto_send", "final_reply": rewrite_draft.reply}
```

Conditional edge from `gates_only_check` routes to `finalize` or `queue_for_human` based on `final_action_hint`.

### 5.4 Escalation summary humanization

```python
def _humanize_reason(reason: str) -> str:
    if not reason.startswith("gate:"):
        return reason
    slug = reason[len("gate:"):]

    if slug == "jual_self_flagged":
        return "Refund, complaint, or sensitive issue — needs your call."
    if slug == "jual_self_reported_gap":
        return "Buyer asked something I couldn't answer."
    if slug == "revise_failed_to_close_gaps":
        return "Tried twice but couldn't cover everything the buyer asked."
    if slug == "ungrounded_factual_answer":
        return "Factual question I didn't have data to answer."
    if slug == "ungrounded_factual_answer_persists":
        return "Couldn't find data for this even after revising."
    if slug.startswith("ungrounded_fact:"):
        return "Referenced something I couldn't verify — please double-check."

    _log.warning("unknown_gate_slug", extra={"slug": slug})
    return "Needs your review."


def _build_escalation_summary(state: ManagerState) -> str:
    last_verdict = state["iterations"][-1].verdict
    if last_verdict and last_verdict.verdict == "escalate":
        return _humanize_reason(last_verdict.reason)
    return "Rewrite referenced a fact I couldn't verify — please review."
```

### 5.5 Shared utility — `agents/app/utils/messages.py`

```python
def last_buyer_text(messages: list[BaseMessage]) -> str:
    if not messages:
        return ""
    for msg in reversed(messages):
        if isinstance(msg, HumanMessage) and isinstance(msg.content, str):
            return msg.content
    return ""
```

Imported as `_last_buyer_text` by `manager.py`. Replaces inline duplication in `customer_support.py`.

### 5.6 Router response + iterations endpoint

Default `/agent/reply` response shape:

```python
{
    "action_id": "...",
    "status": "AUTO_SENT" | "PENDING",
    "final_reply": "..." | null,
    "best_draft": "..." | null,
    "escalation_summary": "..." | null,
}
```

New `GET /agent/actions/{action_id}/iterations` returns the JSONB array with `Cache-Control: private, max-age=3600, immutable`.

### 5.7 Approval endpoint — deferred memory write

`POST /agent/actions/{action_id}/approve` flips status to `HUMAN_SENT`, sets `finalReply = body.final_reply`, **schedules delayed memory enqueue with a 10-second countdown** (supports undo). Never writes memory synchronously for escalated actions.

### 5.8 Tests — `tests/test_manager_terminal.py`

Listed in Section 7.5.

---

## Section 6 — Frontend approval card

### 6.1 Changes to `app/src/components/inbox/action-detail-panel.tsx`

- Remove `conf {confidence.toFixed(2)}` label suffix.
- Header text: `"I need your input on this one"` when `status === 'PENDING'`.
- Add "why I need you" line directly under header, showing `escalationSummary` (one sentence, warm/muted color).
- Draft block header: just `Suggested reply`. No confidence, no v1/v2 badge.
- Seed textarea with `action.bestDraft ?? action.draftReply` (migration-friendly fallback).

### 6.2 `InboxAction` type additions — `app/src/lib/inbox-logic.ts`

```ts
export interface InboxAction {
  // ...existing...
  bestDraft: string | null         // null for AUTO_SENT
  escalationSummary: string | null // null for AUTO_SENT
}
```

### 6.3 Primary action — Send + undo toast

Single dominant `Send` button (full-width, taller, thumb-zone). No confirm dialog. On click: calls existing edit/approve endpoint, shows 5-second undo toast. Undo calls `POST /agent/actions/{id}/unsend`.

### 6.4 Undo endpoint

```python
@router.post("/agent/actions/{action_id}/unsend")
async def unsend_action(action_id: str):
    with SessionLocal() as session:
        action = session.query(AgentAction).filter_by(id=action_id).first()
        if not action or action.status != AgentActionStatus.HUMAN_SENT:
            raise HTTPException(400)
        if (now() - action.updatedAt) > timedelta(seconds=10):
            raise HTTPException(409, "window expired")
        action.status = AgentActionStatus.PENDING
        action.finalReply = None
        session.commit()
    _revoke_memory_task(action_id)   # or cancel deferred enqueue timer
    return {"ok": True}
```

Implementation choice: **approval endpoint delays the Celery enqueue itself by 10s** (not the task). If unsend fires, timer cancelled — memory never writes.

### 6.5 Progressive-disclosure trail

New component `app/src/components/inbox/iteration-trail.tsx`:

- Collapsed link at panel bottom: `▸ see AI's thinking`.
- Lazy-fetches `GET /agent/actions/{id}/iterations` on first expand. Browser honors `immutable` Cache-Control.
- Renders each entry as a compact row: stage label + verdict + one-line reason + truncated draft text.
- Muted colors, monospace, no prominent styling.

### 6.6 Tests

- `app/src/__tests__/inbox-logic.test.ts` — `bestDraft` fallback; `escalationSummary` display condition.
- New `app/src/__tests__/undo-timing.test.ts` — undo within 10s restores PENDING; after 10s returns 409.

### 6.7 Out of scope

- Side-by-side v1/v2/rewrite comparison UI.
- Keyboard shortcuts (J/K nav, Enter to send).
- Escalation-rate dashboard.

---

## Section 7 — Rollout, observability, file inventory

### 7.1 Feature flag

`MANAGER_ENABLED` in `agents/.env` (default `"false"`). Router switches graph at process start:

```python
_MANAGER = os.environ.get("MANAGER_ENABLED", "false").lower() == "true"

async def _get_graph():
    return manager_graph if _MANAGER else customer_support_graph
```

Jual's new state fields are Optional with defaults — legacy path still works.

Kill switch: flip env → `./scripts/dev.sh env` reloads agents container.

### 7.2 Migration ordering

1. Apply `0002_agent_action_iterations.py` (safe pre-flag).
2. Deploy code with `MANAGER_ENABLED=false`.
3. Staging smoke test with flag on.
4. Prod flip.

No backfill — default `[]` on historical rows.

### 7.3 Observability

Structured log events:

| Event | Emitter | Fields |
|-------|---------|--------|
| `manager_turn_start` | `load_shared_context` | business_id, customer_phone, valid_fact_id_count |
| `jual_draft_complete` | dispatch nodes | stage, latency_ms, unaddressed_count, facts_used_count, needs_human |
| `evaluator_decision` | `evaluate` | verdict, via, revision_count, stage, reason |
| `manager_rewrite_complete` | `manager_rewrite` | latency_ms, facts_used_count |
| `gates_only_outcome` | `gates_only_check` | outcome, reason_slug |
| `manager_turn_terminal` | `finalize` / `queue_for_human` | action_id, final_action, total_latency_ms, iteration_count |
| `unknown_gate_slug` | `_humanize_reason` | slug |
| `finalize_no_reply` | `_resolve_final_reply` | iteration_stages |
| `no_draft_for_escalation` | `_pick_best_draft_for_human` | iteration_stages |

Metrics (when aggregation is wired):

- `manager.verdict.count{verdict}`
- `manager.escalation.rate` — alert if 24h rolling > 25%
- `manager.latency_ms{stage}`
- `manager.gate.trigger.count{gate}`

### 7.4 File inventory

**New:**

```
agents/app/schemas/__init__.py
agents/app/schemas/agent_io.py
agents/app/agents/manager.py
agents/app/utils/__init__.py
agents/app/utils/messages.py
agents/alembic/versions/0002_agent_action_iterations.py
agents/tests/test_manager_evaluator.py
agents/tests/test_redraft_mode.py
agents/tests/test_manager_terminal.py
app/src/components/inbox/iteration-trail.tsx
app/src/__tests__/undo-timing.test.ts
```

**Modified:**

```
agents/app/agents/customer_support.py
agents/app/routers/agent.py
agents/app/db.py                           # iterations column; HUMAN_SENT enum if missing
agents/app/worker/tasks.py                 # deferred memory enqueue
agents/tests/test_json_parsing.py
app/src/lib/inbox-logic.ts
app/src/lib/inbox-server-fns.ts
app/src/components/inbox/action-detail-panel.tsx
app/src/routes/$businessCode/inbox.tsx
app/src/__tests__/inbox-logic.test.ts
agents/.env.example
```

**Untouched:**

```
agents/app/memory/**
agents/app/agents/base.py
Payment flow, order creation, order lookup tool
```

### 7.5 Test strategy

| Layer | Coverage |
|-------|----------|
| Pydantic schemas | JSON round-trip, composite-key fact validation, legacy-field defaults |
| Manager gates | Each gate deterministic, precedence order, revision_count flip 5a→5b |
| Manager LLM verdict | Monkeypatched structured-output returns each verdict; prompt contains revision context when `revision_count≥1` |
| Jual redraft mode | Entry router branches; `load_context`/`load_memory` skipped; output schema valid |
| Manager terminal | Both paths write single row; memory enqueue only on finalize; `_pick_best_draft_for_human` skips hallucinated rewrite; `_resolve_final_reply` raises on empty; every gate slug humanizes |
| Graph integration (E2E) | Mocked LLMs, seeded business+product, asserts PENDING action with iterations JSONB populated |
| Router | `MANAGER_ENABLED=false` → legacy graph; `=true` → manager_graph |
| Approval flow | `POST /approve` flips status, delays memory enqueue; `POST /unsend` cancels within 10s, 409 after |
| Frontend | `bestDraft` fallback; `escalationSummary` display; undo timing |

### 7.6 Deferred

- Multi-specialist supervisor dispatch (only Jual exists today).
- Escalation-rate dashboard UI.
- Keyboard shortcuts on approval card.
- Calibration analysis job over Jual-v1 confidence telemetry.
- Budget caps on Manager LLM spend.

---

## Open questions / future work

- **Budget guardrails:** Each buyer turn now costs 2-4 LLM calls (Jual draft + evaluator ± revise + ± rewrite). Need a per-business or per-day spend cap before wider rollout.
- **Calibration over time:** Once Jual-v1 `confidence` telemetry accumulates, build a job to bucket it against Manager verdicts and check whether Jual's self-score correlates with being overridden. Confirms or refutes the Q3 anti-pattern in production data.
- **Prompt iteration on permissiveness:** Target escalation rate is a prompt-engineering dial, not a code dial. Track weekly escalation rate; if it's stuck above 15%, tighten `VERDICT_CRITERIA_BLOCK`.
