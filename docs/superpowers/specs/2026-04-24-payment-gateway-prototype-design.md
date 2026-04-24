# Payment Gateway Prototype Design

Date: 2026-04-24
Status: Draft

## Problem

Support agent currently answers questions but cannot close sales. A buyer saying "I want 3 pisang" gets a polite acknowledgement, not a way to pay. To demonstrate the agent as a revenue-driver in the hackathon, we need a fake-but-realistic payment loop: agent issues link, buyer pays, seller sees the sale in-app.

No real payment provider. Mock end-to-end.

## Goals

1. Agent detects purchase intent and returns a `/pay/<orderId>` URL inside its reply.
2. Buyer opens link, fills name + contact, clicks "Pay" → order marked `PAID`.
3. Seller sees a "Sale confirmed" notification in the inbox.
4. Agent dashboard gets a Sales tab showing orders for that agent.

Non-goals: real payment providers, webhooks, refunds, multi-product carts, email/SMS delivery.

## Data Model

`app/prisma/schema.prisma`:

```prisma
enum OrderStatus {
  PENDING_PAYMENT
  PAID
  CANCELLED
}

model Order {
  id              String      @id @default(cuid())
  businessId      String
  business        Business    @relation(fields: [businessId], references: [id], onDelete: Cascade)
  productId       String
  product         Product     @relation(fields: [productId], references: [id])
  agentType       String?     // null if not agent-attributed
  qty             Int
  unitPrice       Decimal     @db.Decimal(10, 2)
  totalAmount     Decimal     @db.Decimal(10, 2)
  status          OrderStatus @default(PENDING_PAYMENT)
  buyerName       String?
  buyerContact    String?
  paidAt          DateTime?
  acknowledgedAt  DateTime?
  createdAt       DateTime    @default(now())
  updatedAt       DateTime    @updatedAt

  @@map("order")
  @@index([businessId, status])
}
```

`Product` gains reverse relation `orders Order[]`.

`unitPrice` and `totalAmount` snapshotted at creation so later price edits don't rewrite history. `agentType` is nullable because future code paths (manual order entry) may not attribute to an agent.

## Agent Tool Integration (Python)

`agents/app/db.py`: add `Order` + `OrderStatus` SQLAlchemy model matching the Prisma schema.

`agents/app/agents/customer_support.py`:

- New tool function:

  ```python
  def create_payment_link(product_id: str, qty: int) -> str:
      # validate product belongs to business, stock >= qty
      # insert Order row (PENDING_PAYMENT) with agentType='support'
      # return f"{APP_URL}/pay/{order_id}"
  ```

- LangGraph change: `draft_reply` node becomes tool-capable. Use LangChain `bind_tools(llm, [create_payment_link])`. Add a `tool_loop` node that executes tool calls and feeds results back to the LLM until the model produces a final reply. Loop bounded to max 3 tool calls per turn.

- System prompt update: add a section instructing the LLM — "If the buyer states a clear intent to purchase a specific product and quantity, call `create_payment_link(productId, qty)`. Include the returned URL verbatim in your reply."

- Confidence + auto_send / queue_approval logic unchanged: reply text (now possibly containing URL) is stored on `AgentAction.draftReply` / `finalReply` as today. Seller can still edit the draft before approval; editing the URL out is valid.

- `APP_URL` read from env (default `http://localhost:3000` for local dev).

## Public Payment Route

`app/src/routes/pay/$orderId.tsx` — no auth, no BusinessStrip, no Sidebar.

Loader: calls `fetchPublicOrder({ orderId })` (public server fn, no session check). 404 page if not found.

Page states:

- `PENDING_PAYMENT`: summary card (business name, product name, qty, unit price, total), buyer form (name required, contact required — both `length ≥ 1` after trim), big "Pay RMx.xx" button. Submit calls `submitMockPayment({ orderId, buyerName, buyerContact })`.
- `PAID`: green check, "Payment confirmed", transaction id (order id), amount, buyer name, paidAt. "The seller has been notified."
- `CANCELLED`: red banner, "This order has been cancelled."

Client state between submit and server response: disable button, show "Processing…". On error, inline error message + re-enable button.

## Server Fns

`app/src/lib/order-server-fns.ts`:

```ts
fetchPublicOrder({ orderId }):
  no session required
  returns { order: OrderSerialized, product: { id, name }, businessName: string } | null

submitMockPayment({ orderId, buyerName, buyerContact }):
  no session required
  validates: order exists, status === PENDING_PAYMENT, trim(name).length>=1, trim(contact).length>=1
  transaction: SELECT … FOR UPDATE on order row; if already PAID → throw "Already paid"
  updates: status=PAID, paidAt=now(), buyerName, buyerContact
  returns OrderSerialized

acknowledgeOrder({ orderId }):
  session required, business owner only
  sets acknowledgedAt = now() if null; idempotent if already acknowledged
  returns OrderSerialized

fetchAgentSales({ businessId, agentType, rangeDays }):
  session required, business owner only
  returns { totals: { count, revenue }, rows: OrderSerialized[] }
```

`OrderSerialized` converts `Decimal` fields (`unitPrice`, `totalAmount`) via `.toNumber()` — same pattern as `product-server-fns.ts` and the existing `serializeAction` in agent-server-fns.

## Inbox Merge

`app/src/lib/inbox-logic.ts`: new discriminated union.

```ts
type InboxItem =
  | { kind: 'action', action: InboxAction }
  | { kind: 'order', order: InboxOrder }

interface InboxOrder {
  id: string
  businessId: string
  productName: string
  qty: number
  totalAmount: number
  buyerName: string | null
  buyerContact: string | null
  status: 'PAID' | 'CANCELLED' | 'PENDING_PAYMENT'
  paidAt: Date | null
  acknowledgedAt: Date | null
  createdAt: Date
}
```

`matchesItemTab(item, tab, now)` drives tab semantics:

- `mine`: action (PENDING) OR order (PAID && !acknowledgedAt)
- `recent`: within 7 days AND (action.status !== AUTO_SENT) for actions; order within 7 days AND status ∈ {PAID, CANCELLED} (not PENDING_PAYMENT)
- `unread`: action viewedAt === null AND action.status !== AUTO_SENT; order acknowledgedAt === null AND status === PAID

`app/src/lib/inbox-server-fns.ts`:

- `fetchInbox` queries both tables, filters per tab, merges by createdAt desc, returns `InboxItem[]`.
- `fetchTabCounts` computes counts from the same merged logic.

## Frontend Inbox Rendering

`app/src/routes/$businessCode/inbox.tsx` state changes from `InboxAction[]` → `InboxItem[]`.

New components:

- `components/inbox/order-inbox-card.tsx`: list row for `kind: 'order'`. Green accent, 💰 icon, "Sale confirmed", product name × qty, RM total, buyer name, relative paidAt.
- `components/inbox/order-detail-panel.tsx`: right panel when an order is selected. Shows full order, buyer contact, paidAt timestamp, total, and a "Dismiss" button calling `acknowledgeOrder`.

Selection handling in the page:

- Action selected → existing `ActionDetailPanel`.
- Order selected → `OrderDetailPanel`.
- Opening an unacknowledged order auto-calls `acknowledgeOrder` (mirrors the `markAsViewed` pattern on actions).

Grouping:

- Orders render in a top "Sales" group (independent of agent grouping).
- Actions continue to group by `agentType` beneath.

## Sales Tab in Agent Dashboard

`app/src/components/agents/agent-tab-bar.tsx`: extend `AgentTab` with `'sales'`.

`app/src/components/agents/sales-tab.tsx`:

- 2 stat cards: "Total sales" (count), "Revenue" (RM total, range).
- Range selector: 7d / 30d / All (mirrors Budget tab).
- Filter pills: All / Paid / Pending / Cancelled.
- Table: Date | Buyer | Product | Qty | Total | Status. Null buyer name rendered as `—`.
- Row click: no-op for now (no order detail route outside inbox). Can add later.

`app/src/routes/$businessCode/agents/$agentType.tsx`:

- Lazy-load sales data on tab entry (same pattern as Runs / Budget).
- `fetchAgentSales` called with the current `rangeDays`.

## Error Handling

- Tool validation: unknown productId / insufficient stock → tool returns error string; LLM apologizes, no URL generated. Confidence lowered or unchanged — existing threshold still routes to auto_send or queue_approval.
- Public order 404: dedicated "Order not found" page at `/pay/$orderId` when loader returns null.
- `submitMockPayment` double-click: transaction with status check; second call sees `status !== PENDING_PAYMENT` → throws "Already paid"; client shows that error, user can refresh to see PAID view.
- Deleted product referenced by an order: order keeps `productId` but Prisma relation allows null at read time only if we use `onDelete: SetNull` — instead, block product delete when orders exist OR soft-handle missing product in UI as "(deleted product)". Decision: allow deletion but UI renders fallback.

## Testing

- `app/src/__tests__/order-logic.test.ts`: pure helpers — `formatOrderTotal`, `paymentUrl`, `matchesItemTab` cases for each tab × item kind.
- `app/src/__tests__/inbox-logic.test.ts`: extend with merged-item cases.
- Python agent tool: manual smoke test (trigger a buy phrase, verify order row + URL).

## Environment

- `APP_URL` env var in `agents/.env` (e.g. `http://localhost:3000`).
- Same value available to the TS side if ever needed for absolute URLs — not required for the payment route since the page is rendered server-side by TanStack from the same origin.

## Summary of File Changes

New:
- `app/prisma/schema.prisma` additions (Order model, enum, Product relation)
- `app/src/routes/pay/$orderId.tsx`
- `app/src/lib/order-server-fns.ts`
- `app/src/lib/order-logic.ts`
- `app/src/components/inbox/order-inbox-card.tsx`
- `app/src/components/inbox/order-detail-panel.tsx`
- `app/src/components/agents/sales-tab.tsx`
- `app/src/__tests__/order-logic.test.ts`
- Prisma migration folder (generated)

Modified:
- `app/src/lib/inbox-logic.ts` — add `InboxItem`, `InboxOrder`, `matchesItemTab`
- `app/src/lib/inbox-server-fns.ts` — fetchInbox + fetchTabCounts return merged items
- `app/src/routes/$businessCode/inbox.tsx` — render mixed items, order selection, acknowledge flow
- `app/src/__tests__/inbox-logic.test.ts` — update for merged items
- `app/src/components/agents/agent-tab-bar.tsx` — add 'sales' tab
- `app/src/routes/$businessCode/agents/$agentType.tsx` — handle 'sales' tab
- `agents/app/db.py` — add Order model + enum
- `agents/app/agents/customer_support.py` — tool-capable LangGraph + system prompt
- `agents/.env.example` (if present) — document `APP_URL`

## Out of Scope / Follow-ups

1. Real payment provider (Stripe, Billplz, etc.) — webhook signing, retry, idempotency.
2. Email or SMS dispatch of payment link to buyer outside the app.
3. Multi-product / cart orders.
4. Seller-initiated refund / cancel from the inbox.
5. Buyer login and order history page.
6. Rate limiting on the public `/pay` route.
