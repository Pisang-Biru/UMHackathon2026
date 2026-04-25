# Grounding Receipts Envelope — Design

## Problem

Manager escalates correct, well-grounded replies because `valid_fact_ids` is populated only from products at turn start (`agents/app/agents/manager.py:98`). Order, KB, and `memory:past_action` claims are ungrounded by construction — Gate 2 (`hallucinated_fact`) fires on every order or KB citation, sending the turn through `manager_rewrite`, which cannot reach a different conclusion without grounding either, and ends in `queue_for_human`.

Today's failure path, observed in the dashboard:

1. Buyer: "saya ada beli apa-apa ke harini?"
2. Jual calls `check_order_status` → tool returns `"no orders found for this phone"`
3. Jual drafts: "Tiada, saya tidak jumpa sebarang pesanan…" with `facts_used=[FactRef(kind="order", id="no orders found")]`
4. Gate 2: `order:no orders found` not in `valid_fact_ids` → `verdict=rewrite`, `reason_slug=ungrounded_fact:order:no orders found`
5. `manager_rewrite` produces equivalent text, same grounding gap → `gates_only_check` re-rejects → `final_action=escalate`

Root cause is structural, not a tool bug:

- Tools return raw strings; nothing certifies "this lookup actually happened, with this result."
- `valid_fact_ids` is a one-shot snapshot of products. Tool calls during the turn never enrich it.
- Negative results (empty lookup) have no representation as a citable fact.

## Goal

Make every retrieval tool emit a structured **grounding receipt** alongside its text. Harvest receipts after the Jual ReAct loop and merge them into `valid_fact_ids` so gates can verify claims against what tools actually saw — including citable negatives.

## Scope (this design)

In scope — retrieval tools (Option B from brainstorm):

- `check_order_status` — order lookups (positive + negative)
- `search_memory` — kb / product / past_action retrievals (positive + negative)

Out of scope (deferred, envelope designed to extend without changes):

- `create_payment_link` — action tool. Already grounded via existing `kind=product, id=<product_id>` convention. Receipt emission can be added later as `PaymentLinkReceipt(kind="payment_link", id=order_id)`.
- LLM-judged claim-vs-chunk relevance gate (KB/memory grounding verifies a chunk was retrieved AND cited as basis, but does not automatically check that the claim follows from the chunk content). Tracked as future work in Section 8.

## Design

### Section 1 — Envelope schema (discriminated union)

`agents/app/schemas/agent_io.py`:

```python
from typing import Annotated, Literal, Union
from pydantic import BaseModel, Field

class ProductReceipt(BaseModel):
    kind: Literal["product"] = "product"
    id: str  # product_id

class OrderReceipt(BaseModel):
    kind: Literal["order"] = "order"
    id: str  # order_id, OR f"none:{phone_key}" for citable negatives

class KbReceipt(BaseModel):
    kind: Literal["kb"] = "kb"
    id: str          # 8-char short id surfaced in formatter; what the LLM cites
    chunk_id: str    # full chunk pk, telemetry/debug only
    sim: float

class PastActionReceipt(BaseModel):
    kind: Literal["memory:past_action"] = "memory:past_action"
    id: str          # 8-char short id
    full_id: str
    sim: float

class PaymentLinkReceipt(BaseModel):  # not emitted in this iteration; reserved
    kind: Literal["payment_link"] = "payment_link"
    id: str

GroundingReceipt = Annotated[
    Union[ProductReceipt, OrderReceipt, KbReceipt, PastActionReceipt, PaymentLinkReceipt],
    Field(discriminator="kind"),
]
```

`FactRef` (LLM-emitted citation) unchanged — `kind: str`, `id: str`, both required.

### Section 2 — Tool signature: `content_and_artifact`

Tools migrate to `@tool(response_format="content_and_artifact")` and return `(text, [GroundingReceipt, ...])`.

Helpers (in `customer_support.py` near tool factories):

```python
def _safe_tool_return(text: str, receipts: list[GroundingReceipt]) -> tuple[str, list]:
    """Success path. Receipts MUST reflect data the tool actually saw."""
    return (text, receipts)

def _error_tool_return(err: str) -> tuple[str, list]:
    """Error path. NO receipts — Gate 5 will treat any downstream claim as ungrounded."""
    return (f"ERROR: {err}", [])
```

Rule: every `try/except` in a migrated tool returns through `_error_tool_return` on exception. Successful paths (including empty-result paths) return through `_safe_tool_return`.

#### Phone-key normalisation (negative-receipt round-trip)

```python
import re
def _phone_key(phone: str) -> str:
    """Lowercase digits-only key. Used both at receipt emission and gate lookup."""
    return re.sub(r"\D", "", (phone or "").lower())
```

Used identically in `check_order_status` (when emitting `OrderReceipt(id=f"none:{_phone_key(customer_phone)}")`) and anywhere the manager would synthesize the same id.

#### Migrated `check_order_status`

```python
@tool(response_format="content_and_artifact")
def check_order_status() -> tuple[str, list[GroundingReceipt]]:
    """... (docstring unchanged) ..."""
    if not customer_phone:
        return _error_tool_return("no phone on file for this buyer")
    try:
        with SessionLocal() as session:
            rows = (...).all()
        if not rows:
            return _safe_tool_return(
                "no orders found for this phone",
                [OrderReceipt(id=f"none:{_phone_key(customer_phone)}")],
            )
        return _safe_tool_return(
            _render_orders(rows),
            [OrderReceipt(id=order.id) for order, _ in rows],
        )
    except Exception as e:
        return _error_tool_return(str(e))
```

#### Migrated `search_memory`

Returns receipts for kb / product / past_action with 8-char short ids (see Section 3 for formatter changes). Empty result emits a `none:` receipt for the same `kind`:

```python
return _safe_tool_return(
    f"No results (kind={kind}).\n[id=none:{_query_hash8(query)}] for query \"{query}\"",
    [_none_receipt_for(kind, query)],
)
```

`product` results emit `ProductReceipt(id=<product_id>)`. `kb` and `past_action` emit `KbReceipt` / `PastActionReceipt` with short id.

#### Tool invocation loop change

In `customer_support.py:412-413`, replace:

```python
result = chosen.invoke(call["args"])
history.append(ToolMessage(content=str(result), tool_call_id=call["id"]))
```

with:

```python
# Tool invocation: pass the full ToolCall dict.
# - For @tool(response_format="content_and_artifact"): returns ToolMessage with .artifact populated.
# - For plain @tool: returns ToolMessage with .artifact=None.
# Single convention covers both during the migration window.
tool_msg = chosen.invoke(call)
history.append(tool_msg)
```

The `unknown tool` branch keeps its explicit `ToolMessage(...)` construction since no tool is invoked.

### Section 3 — Formatter surfaces short ids

`agents/app/memory/formatter.py:format_search_results` rewrites to surface a stable, citable short id per hit. Tool factory wraps the raw repo hits into both the rendered text and the receipt list, so id derivation lives in one place.

Render shape:

```
Found 3 results (kind=kb):
[id=ab12cd34 sim=0.82] <content>
[id=ef34gh78 sim=0.71] <content>
...
```

Empty:
```
No results (kind=kb).
[id=none:<query_hash8>] for query "<query text>"
```

Short-id derivation: `hashlib.sha1(full_chunk_id.encode()).hexdigest()[:8]`. Within a single tool result the formatter asserts uniqueness; on collision (paranoid case) it bumps to 12 chars for that result.

The LLM cites `FactRef(kind="kb", id="ab12cd34")`. Receipt carries the same id plus `chunk_id` (full) for telemetry.

### Section 4 — Harvest node

New node `harvest_receipts` inserted post-Jual on both first-draft and revise paths. Skipped on the rewrite path (rewrite has no tools).

Manager state additions (`agents/app/agents/manager.py`):

```python
class ManagerState(TypedDict):
    ...
    valid_fact_ids: set[str]
    preloaded_fact_ids: set[str]      # NEW — snapshot of pre-tool-call ids (just products today)
    last_harvested_msg_index: int     # NEW — cursor; init 0
```

`load_context` now also writes `preloaded_fact_ids = set(valid_ids)` (same content as `valid_fact_ids` at turn start).

Harvest node:

```python
async def harvest_receipts(state: ManagerState) -> dict:
    msgs = state["messages"]
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

Idempotent + O(Δmessages). Re-running across revise iterations advances the cursor and never re-scans old messages.

Graph wiring:

```
load_context → dispatch_jual → harvest_receipts → manager_evaluator → {finalize | dispatch_jual_revise → harvest_receipts → manager_evaluator | manager_rewrite → gates_only_check → ... | queue_for_human}
```

### Section 5 — Gate behavior

Gate 2 (`hallucinated_fact`) — code unchanged at `manager_gates.py:54-64`. Its meaning sharpens: with a populated `valid_fact_ids`, it now fails only on truly fabricated ids, not on every kind that was never registered.

Gate 5 (factual question without grounding) — revised at `manager_gates.py:84-103` to distinguish two failure modes:

```python
buyer_msg = _last_human_text(messages)
if FACTUAL_Q_RE.search(buyer_msg):
    if not draft.facts_used:
        preloaded = state.get("preloaded_fact_ids", set())
        added_this_turn = state["valid_fact_ids"] - preloaded
        had_retrieval = bool(added_this_turn)
        slug = "uncited_tool_result" if had_retrieval else "ungrounded_factual_answer"
        return GateResult(
            verdict="revise" if revision_count == 0 else "rewrite",
            gate_num=5,
            reason_slug=slug + ("_persists" if revision_count > 0 else ""),
            critique=ManagerCritique(missing_facts=[f"grounded data for: {buyer_msg[:80]}"]) if revision_count == 0 else None,
            passed_gates=passed,
        )
    # facts_used non-empty AND Gate 2 already validated all of them — pass
passed.append("factual_q_grounded")
```

`run_gates` signature gains `state: ManagerState | dict` (or just the two extra fields) so it can read `preloaded_fact_ids`.

Truth table the revised gates implement:

| Buyer asks factual Q | Tool fired | Tool errored | facts_used | Verdict | Slug |
|---|---|---|---|---|---|
| yes | no | — | empty | revise/rewrite | `ungrounded_factual_answer` |
| yes | yes | no | empty | revise/rewrite | `uncited_tool_result` |
| yes | yes | yes (no receipt) | empty | revise/rewrite | `ungrounded_factual_answer` |
| yes | yes | no | matches receipt | pass | — |
| yes | yes | no | mismatch (hallucinated) | rewrite (Gate 2) | `ungrounded_fact:<k>:<id>` |

Today's screenshot case (negative order lookup) lands in row 4 → pass.

### Section 6 — Test plan

Unit tests (`agents/tests/`):

- `test_tool_envelope.py` — schema round-trip, discriminator behavior.
- `test_check_order_status_envelope.py` —
  - happy path: orders found → `OrderReceipt(id=<order_id>)` per row, text rendered as before.
  - negative: no orders → single `OrderReceipt(id=f"none:{_phone_key(phone)}")`.
  - error: simulated `Exception` in `SessionLocal` → returns `("ERROR: …", [])`.
  - phone-key round-trip: `+60 12-345 6789` and `60123456789` produce same key.
- `test_search_memory_envelope.py` — kb / product / past_action positive paths each produce expected receipt kind; empty path emits `none:` receipt; formatter render contains `[id=…]` markers; short-id collisions bump to 12 chars.
- `test_manager_gates.py` — extend with Gate 5 truth table above, including `uncited_tool_result` slug.
- `test_harvest_receipts.py` —
  - cursor advances correctly across revise loop, no double-harvest.
  - mixed migrated + unmigrated tools (artifact + plain string) coexist; harvest no-ops on plain.
  - artifact with multiple receipts merges all ids.

Integration (`test_manager_e2e.py` extension):

- Reproduce screenshot scenario end-to-end. Buyer asks "ada saya beli barang ke harini?", `check_order_status` returns no rows. Assert: `final_action == "auto_send"`, reply contains negative phrasing, no escalation.
- Buyer asks "macam mana nak refund?" with no kb hit above sim threshold → `none:<hash>` receipt → revised reply still grounded → either auto_send (if Jual handles gracefully) or escalate (if no policy).

E2E (`test_e2e.py` if present): assert `agent_events` populated with the envelope-driven slugs (`uncited_tool_result` distinguishable from `ungrounded_factual_answer`).

### Section 7 — Rollout / migration order

Strict ordering — each step ships independently, system stays green between steps:

1. **Schema-only**: add `GroundingReceipt` discriminated union to `schemas/agent_io.py`. No behavior change. Test imports.
2. **Manager state additions**: `preloaded_fact_ids`, `last_harvested_msg_index`. Populated in `load_context` but unread. Test no regression in existing manager_e2e.
3. **Harvest node + graph rewiring**: insert `harvest_receipts` post-Jual. With no migrated tools yet, `msg.artifact` is always None → harvest is a no-op. Test no regression.
4. **Tool invocation convention**: change `customer_support.py:412-413` to `chosen.invoke(call)` returning a `ToolMessage`. Verify: plain @tool still produces correct ToolMessage (artifact=None). Run existing manager_e2e + customer_support tests.
5. **Migrate `check_order_status`**: switch to `content_and_artifact`. Today's screenshot bug fixes here. Run e2e screenshot reproduction.
6. **Gate 5 update**: distinguish `uncited_tool_result` from `ungrounded_factual_answer`.
7. **Bundle: formatter rewrite + `search_memory` migration**. Shipped as one change, not two.

   Why bundled: step 7's formatter surfaces `[id=ab12cd34]` markers in the LLM-visible text. The moment those markers appear, Jual will start citing `FactRef(kind="kb", id="ab12cd34")`. If receipts aren't registered in the same release, Gate 2 fails every kb citation as ungrounded — same failure class this whole design is fixing, just relocated to KB. Short-id derivation (`sha1(chunk_id)[:8]`) is shared between the formatter render and the tool's receipt emission, so the two are one logical change anyway.

Steps 1–4 are pure plumbing with zero behavior change. Steps 5–8 each have observable behavior — ship one at a time, watch dashboard for slug distribution shift.

### Section 8 — Future work (out of scope)

- **Claim-vs-chunk relevance gate.** KB/memory grounding currently verifies a specific retrieved chunk was cited as basis. It does not automatically verify the claim follows from the chunk content. A second LLM-judged check (`KbReceipt.content` carried on the receipt, gate prompt: "does claim X follow from any of these chunks?") would close this gap. Cost: extra LLM call in the hot path; defer until evaluator-spot-checks show this failure mode in production.
- **Migrate `create_payment_link` to emit `PaymentLinkReceipt(kind="payment_link", id=order_id)`.** Today's `kind=product` convention covers the price/qty surface; payment-link migration matters when the agent paraphrases post-action state ("RM150 link created" — qty × unit_price needs grounding to the actual order, not just the product).
- **Persist receipts on agent_events** so the dashboard can show "what evidence backed this reply" alongside the existing latency/verdict panels.

## Honest scope comment (to land in `manager_gates.py`)

```python
# kb / memory:past_action grounding verifies a specific retrieved chunk was
# cited as basis. Relevance of claim to chunk content is NOT checked
# automatically — that's delegated to manager_evaluator's content judgment.
# A future LLM-judged relevance gate (claim-vs-content) would close this gap.
# See docs/superpowers/specs/2026-04-25-grounding-receipts-envelope-design.md §8.
```
