# Finance Agent — Cost Data + Real Margin (MVP)

**Date:** 2026-04-25
**Status:** Design approved, ready for implementation plan
**Scope:** Subset 1 of 4 of the broader "financing agents" idea. Covers cost data foundation and a real-margin agent that warns when an order's apparent profit is actually a loss. Sales analytics, sales prediction, and cash-position forecasting are explicitly out of scope and will be brainstormed as separate specs.

## Problem

The platform currently records `Product.price`, `Order.unitPrice`, `Order.totalAmount`, and `Order.qty`, but no cost data. Operators see revenue and assume "untung" (profit), but real margin after platform fees, packaging, and transport is often negative — especially on low-ticket items with flat-rate shipping. There is no way today for the platform to compute or surface this.

## Goals

1. Capture per-product COGS and packaging cost, per-business platform fee and default transport cost, and per-order transport cost.
2. Compute real margin deterministically on every paid order.
3. Push a `FinanceAlert` to the Inbox when an order is a loss, or when cost data is missing so margin cannot be computed.
4. Provide a chat-reachable Finance agent that answers margin and loss questions over existing data (read-only).

## Non-goals

- Sales forecasting or trend prediction.
- Cash-position forecasting.
- External marketplace fees (Shopee, TikTok). The platform fee modeled here is Pisang Biru's own cut.
- Bulk cost imports.
- Historical backfill of margins for orders paid before this ships (a one-off recompute task can be added later if needed).

## Architecture

```
Order PAID  ──▶  Celery: check_order_margin(order_id)
                        │
                        ├─ compute_margin()  (pure function)
                        ├─ UPDATE order.realMargin, order.marginStatus
                        └─ INSERT FinanceAlert (LOSS or MISSING_DATA)
                                               │
                                               ▼
                                        Inbox "Finance" tab

Operator chat ──▶ manager.py routes finance keywords
                        │
                        ▼
                  finance.py (LangGraph agent)
                        │
                        └─ read-only DB tools (get_order_margin, list_loss_orders, ...)
```

## Data Model (Prisma, `public` schema)

All new tables and columns live in `public` and are owned by the Prisma migrator, per `CLAUDE.md`. No `agents` schema changes.

### Product (extend)

```prisma
cogs           Decimal? @db.Decimal(10, 2)   // unit cost of goods
packagingCost  Decimal? @db.Decimal(10, 2)   // per-unit packaging
```

Both nullable. Missing values cause `MarginStatus = MISSING_DATA` for any order using the product.

### Business (extend)

```prisma
platformFeePct       Decimal @default(0.05) @db.Decimal(5, 4)  // 0.0500 = 5%
defaultTransportCost Decimal @default(0)    @db.Decimal(10, 2)
```

Default for `platformFeePct` seeded from `PLATFORM_FEE_PCT` env var on Business create (env-default at app layer; column default is the safety net). Per-Business override is a single field, lets operations negotiate per-business pricing later without a schema change.

### Order (extend)

```prisma
transportCost Decimal?      @db.Decimal(10, 2)
realMargin    Decimal?      @db.Decimal(10, 2)
marginStatus  MarginStatus?
```

`transportCost` is auto-filled from `Business.defaultTransportCost` at Order create time, editable by the operator on the Order detail page until status reaches `PAID`. After paid it is locked (admin-only edit). `realMargin` and `marginStatus` are caches — set by the worker.

```prisma
enum MarginStatus { OK LOSS MISSING_DATA }
```

### FinanceAlert (new)

```prisma
model FinanceAlert {
  id          String           @id @default(cuid())
  businessId  String
  business    Business         @relation(fields: [businessId], references: [id], onDelete: Cascade)
  orderId     String?
  productId   String?
  kind        FinanceAlertKind
  marginValue Decimal?         @db.Decimal(10, 2)
  message     String
  resolvedAt  DateTime?
  createdAt   DateTime         @default(now())
  updatedAt   DateTime         @updatedAt

  @@map("finance_alert")
  @@index([businessId, resolvedAt])
  @@schema("public")
}

enum FinanceAlertKind { LOSS MISSING_DATA }
```

A `LOSS` alert is keyed by `orderId`; a `MISSING_DATA` alert is keyed by `productId`. Dedupe on insert: skip if an unresolved alert already exists for the same `(orderId, kind=LOSS)` or `(productId, kind=MISSING_DATA)`.

## Margin Formula

```
revenue       = order.totalAmount
cogs_total    = product.cogs * order.qty
pack_total    = product.packagingCost * order.qty
transport     = order.transportCost
platform_fee  = revenue * business.platformFeePct
real_margin   = revenue - cogs_total - pack_total - transport - platform_fee
```

Status decision:

- If any of `cogs`, `packagingCost`, `transportCost` is null → `MISSING_DATA`, `realMargin = null`.
- Else if `real_margin < 0` → `LOSS`.
- Else → `OK`.

Implementation lives in `agents/app/agents/finance/margin.py` as a pure function:

```python
def compute_margin(order, product, business) -> tuple[Decimal | None, MarginStatus]
```

No DB calls, no I/O, easy to unit test. All arithmetic uses `decimal.Decimal`; result is `quantize(Decimal("0.01"))`. No floats anywhere in the path.

## Worker Hook

**Trigger:** Order transitions to `PAID`. Hooked next to existing payment-callback side-effects in the payment gateway path.

**Task:** `agents/app/worker/finance_check.py::check_order_margin(order_id)` (Celery).

**Steps:**

1. Load Order joined with Product and Business in a single query.
2. Call `compute_margin()`.
3. Update `order.realMargin` and `order.marginStatus`.
4. Branch on status:
   - `OK`: done.
   - `LOSS`: insert `FinanceAlert(kind=LOSS, orderId=order.id, marginValue=real_margin, message="Order {short_id}: real margin RM{m} (loss)")`. Dedupe on `(orderId, kind=LOSS, resolvedAt IS NULL)`.
   - `MISSING_DATA`: insert `FinanceAlert(kind=MISSING_DATA, productId=product.id, message="Product '{name}' missing: {fields}")` listing exactly which fields are null. Dedupe on `(productId, kind=MISSING_DATA, resolvedAt IS NULL)`.

**Idempotency:** keyed by orderId. Re-running always overwrites `realMargin` and `marginStatus`. Alerts dedupe so re-runs do not multiply rows.

**No LLM in this path.** Deterministic compute only.

## Finance Agent (chat)

**File:** `agents/app/agents/finance.py`. Auto-registered via `AGENT_META` (existing registry pattern in `agents/app/agents/registry.py`).

```python
AGENT_META = {
    "id": "finance",
    "name": "Finance Assistant",
    "role": "Margin analysis, loss alerts, sales costs Q&A",
    "icon": "calculator",
}
```

**Graph:** LangGraph `StateGraph` mirroring `customer_support.py` shape. State carries `business_id`, `messages`, `structured_reply`. Output uses existing `StructuredReply` and `ManagerCritique` schemas. Per-reply LLM confidence score is included (project convention).

**Tools (all read-only):**

- `get_product_costs(product_id)` — returns cogs, packagingCost, list of missing fields.
- `get_order_margin(order_id)` — returns realMargin, marginStatus, full breakdown.
- `list_loss_orders(days=30, limit=20)` — orders with `marginStatus = LOSS` in the window.
- `list_missing_data_products()` — products with any null cost field.
- `product_margin_summary(product_id, days=30)` — aggregate over the window: revenue total, real-margin total, margin %, n_orders.
- `top_losers(days=30, limit=5)` — products ranked by worst aggregate margin.

No write tools. If the user asks to set costs in chat, the agent replies with a link to the product edit page.

**Manager routing:** add finance keywords (`margin`, `untung`, `profit`, `loss`, `kos`, `fee`, `transport`, `rugi`) to `manager.py` route table; hand off to `finance` agent.

## UI Surfaces

The Sales page already exists and is the right home for per-order margin display. No new top-level pages for MVP.

1. **Product form** (Next.js): add `cogs` and `packagingCost` inputs, optional, non-negative Decimal validation.
2. **Business settings**: add `platformFeePct` (rendered as `%`) and `defaultTransportCost` fields. Create the page if it does not exist yet.
3. **Order detail page**: show `transportCost` (editable until status=PAID; admin-only afterward) and a margin badge — green `OK`, red `LOSS`, grey `MISSING DATA`.
4. **Sales page (existing)**: add a `Real Margin` column and a "Loss only" filter chip.
5. **Inbox**: add a `Finance` tab listing `FinanceAlert` rows newest-first. Row click navigates to the related order or product. A "Resolve" button sets `resolvedAt = now()`.
6. **Dashboard chat**: finance agent is reachable through the existing chat via manager routing. No new entry point.

## Testing

**Unit (`agents/tests/`):**

- `test_margin.py` — `compute_margin()`: `OK`, `LOSS`, `MISSING_DATA` for each null field, decimal precision (no float drift), zero-qty edge, `platformFeePct=0` edge, large `qty` boundary.

**Worker:**

- `test_finance_check.py` — task fires on PAID transition, writes `realMargin` and `marginStatus`, inserts LOSS alert, deduplicates LOSS and MISSING_DATA alerts, idempotent re-run overwrites cached values.

**Agent:**

- `test_finance_agent.py` — each tool returns correct rows from seeded DB. Manager routes representative phrases ("untung minggu ni?", "margin for X", "which products losing money") to the `finance` agent. Agent never attempts a write.

**Integration (`tests/`):**

- Seed: one business, two products (one with full costs, one missing `cogs`), three orders (profit, loss, missing-data). Trigger the payment-paid path. Assert `Order.realMargin` populated correctly, `FinanceAlert` rows created with the expected `kind`, Sales page query exposes the margin column.

**Frontend:**

- Component tests: Product form new fields validate non-negative Decimal. Order detail margin badge renders all three `MarginStatus` states. Sales page "Loss only" filter works.

**Out of scope for tests:** load tests, predictive forecasting, multi-currency.

## Migration & Rollout

1. Hand-write a Prisma migration adding the columns, enums, and `finance_alert` table; apply with `prisma migrate dev` after explicit user approval per `CLAUDE.md`.
2. Deploy worker code with the hook gated behind feature flag `FINANCE_AUTO_CHECK_ENABLED` (default `false`) so worker can be deployed before the schema is ready.
3. Run a one-off backfill task `recompute_all_paid_margins(business_id)` on demand — not automatic, operator-triggered.
4. Enable the feature flag.
5. Register the `finance` agent in the registry and merge the manager routing change.

## Risks & Open Questions

- **Operator tolerance for missing-data nags.** If many products lack costs at launch, the Inbox will fill with `MISSING_DATA` alerts. Mitigation: dedupe per product, "Resolve" action, and the agent can summarize "you have 12 products missing costs" rather than listing each.
- **Decimal precision in JS frontend.** API responses must serialize `Decimal` as strings, not numbers, to avoid float rounding in the browser.
- **transportCost lock semantics.** Locking after PAID is the cautious default; if it turns out operators routinely correct shipping post-paid, relax to "always editable, recompute on save." Defer until we hear from real usage.

## Follow-up specs (deferred)

- Sales analytics agent (trends, top products, period comparisons) — needs only Order data, can run in parallel.
- Sales forecasting (time-series prediction).
- Cash-position forecasting (depends on margin data from this spec).
- External marketplace fee modeling (Shopee, TikTok).
