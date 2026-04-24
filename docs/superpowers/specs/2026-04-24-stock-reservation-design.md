# Stock Reservation on Order Create

## Problem

Current flow checks `product.stock >= qty` at order creation but never decrements. Stock only decrements at payment confirm (`submitMockPayment`). Two buyers can create PENDING_PAYMENT orders past available stock; first to pay wins, second fails at pay confirm with "Out of stock". Poor UX — buyer completes checkout form, then error.

## Goal

Prevent oversell at checkout time, not payment time. Order creation atomically reserves stock. Unpaid orders expire after 30 minutes and restore stock.

## Non-Goals

- No separate `reserved` column. Single `stock` column repurposed as "available".
- No migration of existing PENDING_PAYMENT orders. Expire job handles them.
- No retry/reminder flow for abandoned carts.

## Design

### Model

`Product.stock` semantics change from "physical count" to "available count". Reservation is implicit: stock decrement at order create, restore on cancel/expire, no change at payment (already reserved).

### Order creation — reserve

Location: `agents/app/agents/customer_support.py::_create_order`.

Replace precheck-then-insert with atomic guarded decrement:

```python
from sqlalchemy import update

rows = session.execute(
    update(Product)
    .where(
        Product.id == product_id,
        Product.businessId == business_id,
        Product.stock >= qty,
    )
    .values(stock=Product.stock - qty)
).rowcount

if rows == 0:
    raise ValueError("Insufficient stock")

# then insert Order with status=PENDING_PAYMENT, commit
```

Concurrent creates serialized by row-level update. If two calls race past stock, one sees `rowcount=0` and raises. Order insert happens only after successful reservation, same transaction.

### Payment — no stock change

Location: `app/src/lib/order-server-fns.ts::submitMockPayment`.

Remove the `tx.product.updateMany` decrement block added in prior fix. Stock is already reserved at create. Transaction only flips `PENDING_PAYMENT → PAID` and sets `paidAt`, `buyerName`, `buyerContact`. `enqueueProductReindex` remains — memory index refreshes after payment to reflect final state.

### Expire job — restore

New celery task `expire_pending_orders` in `agents/app/worker/tasks.py`. Runs every `ORDER_EXPIRY_CHECK_INTERVAL_SEC` (default 300s) via beat schedule.

Logic:

```
cutoff = now - ORDER_EXPIRY_MINUTES minutes
stale = SELECT id, productId, qty FROM order
         WHERE status='PENDING_PAYMENT' AND createdAt < cutoff

for each stale:
  in transaction:
    affected = UPDATE order SET status='CANCELLED'
               WHERE id=? AND status='PENDING_PAYMENT'    -- guard
    if affected == 1:
      UPDATE product SET stock = stock + qty WHERE id=?
      enqueue reindex(productId)
```

Status guard prevents double-restore if the order was paid or cancelled between SELECT and UPDATE.

Reindex reuses existing `embed_product` celery task from `agents/app/worker/tasks.py`. Enqueue directly via `embed_product.delay(product_id)` after commit — no HTTP round-trip needed since we're already inside the worker.

### Config

Env vars in `agents/app/worker/celery_app.py`:

- `ORDER_EXPIRY_MINUTES` — default `30`, age threshold for auto-cancel
- `ORDER_EXPIRY_CHECK_INTERVAL_SEC` — default `300`, beat schedule interval

Add beat entry:

```python
"expire-pending-orders": {
    "task": "app.worker.tasks.expire_pending_orders",
    "schedule": float(os.environ.get("ORDER_EXPIRY_CHECK_INTERVAL_SEC", "300")),
},
```

### Agent product listing

`_load_business_context` reads `product.stock` and reports to LLM. Semantic shift to "available" is correct by construction — buyer-facing stock should exclude held reservations. No code change.

## Edge Cases

- **Existing PENDING_PAYMENT orders at deploy time**: created under old model, no stock held. Expire job will cancel them after 30 min; stock restore increments beyond physical count. Acceptable for hackathon mock (single demo DB, easy reset). Not migrating.
- **Payment after expiry window but before job runs**: order still `PENDING_PAYMENT`, payment succeeds, flips to PAID. Expire job skips (status no longer matches guard). Correct.
- **Manual cancel path**: none exists today. When added later, must also restore stock using the same guarded pattern.
- **Clock skew**: `createdAt` from DB `now()`, `cutoff` from celery worker clock. Acceptable for 30-min windows.

## Testing

Python (`agents/tests/`):

- `_create_order` success: stock decrements by qty, order created.
- `_create_order` oversell: qty > stock → raises `Insufficient stock`, no order created, stock unchanged.
- `_create_order` concurrency: simulate two sessions racing past stock, only one succeeds.
- `expire_pending_orders`: stale PENDING → CANCELLED, stock restored, reindex triggered.
- `expire_pending_orders`: PAID order past cutoff → untouched.
- `expire_pending_orders`: recent PENDING (< cutoff) → untouched.

TypeScript (`app/src/__tests__/`):

- `submitMockPayment`: updates order status only, does not mutate `product.stock`.

## Out of Scope

- Manual cancel UI/API.
- Buyer-facing countdown timer on pay page.
- Per-business expiry override.
- Soft-reserve preview (show "X reserved" to owner).
