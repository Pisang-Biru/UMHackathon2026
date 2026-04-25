# Sales Page — Design Spec

**Date:** 2026-04-25
**Status:** Approved (pending implementation)
**Scope:** New per-business Sales page that summarizes paid orders with KPIs, charts, a searchable/sortable table, and CSV export.

---

## 1. Goals

Give each business a single page to:

- See revenue performance at a glance (KPI cards).
- Visualize trend over time and top-performing products.
- Browse every paid order with search, sort, and CSV export.

Read-only. No order mutation from this page.

## 2. Non-goals

- No agent attribution column.
- No pagination (all paid orders fit comfortably for current scale; revisit if any business exceeds ~1k paid orders).
- No write actions (refunds, status edits, etc.).
- No chart library dependency — match existing `dashboard/charts.tsx` pure-CSS bar style.

## 3. Route

**File:** `app/src/routes/$businessCode/sales.tsx`

Loader pattern mirrors `app/src/routes/$businessCode/products.tsx`:

1. `fetchBusinesses()` — resolve businesses for current user.
2. Find current by `params.businessCode`. Redirect to first business if not found, or to `/` if user has no businesses.
3. Parallel fetch:
   - `fetchSales({ data: { businessId, range: 'all' } })`
   - `fetchSidebarAgents({ data: { businessId } })`
4. Returns `{ businesses, current, initialSales, sidebarAgents }`.

## 4. Sidebar nav

Add new entry to `NAV_ITEMS` in `app/src/components/sidebar.tsx`:

```ts
{ icon: TrendingUp, label: 'Sales', route: 'sales' }
```

Slot after Products. Import `TrendingUp` from `lucide-react`.

## 5. Server functions

**File:** `app/src/lib/sales-server-fns.ts`

### 5.1 `fetchSales`

**Input:** `{ businessId: string, range: 'today' | 'week' | 'month' | 'all' }`

**Behavior:**

1. Resolve range → date bounds based on `createdAt` (per Q5 decision):
   - `today` → start of today (local server tz) → now
   - `week` → 7 days ago → now
   - `month` → 30 days ago → now
   - `all` → no lower bound
2. Query `prisma.order.findMany` where:
   - `businessId = X`
   - `status = 'PAID'`
   - `createdAt >= bound` (skip if `all`)
   - `include: { product: { select: { name: true } } }`
   - `orderBy: { createdAt: 'desc' }`
3. Compute and return `{ orders, kpis, series, topProducts }` (shapes below).

### 5.2 Return shape

```ts
type SalesPayload = {
  orders: Array<{
    id: string
    createdAt: Date
    paidAt: Date | null
    productId: string
    productName: string
    qty: number
    unitPrice: number
    totalAmount: number
    buyerName: string | null
    buyerContact: string | null
  }>
  kpis: {
    revenue: number          // sum(totalAmount)
    orderCount: number       // rows.length
    avgOrderValue: number    // revenue / orderCount, 0 if empty
    topProduct: { name: string; revenue: number } | null
  }
  series: Array<{ bucket: string; revenue: number }>  // for trend chart
  topProducts: Array<{ name: string; revenue: number }> // top 5, desc
}
```

All `Decimal` fields converted to `number` on server before returning (matches existing `product-server-fns.ts` pattern).

### 5.3 Series bucket strategy

| Range  | Bucket size | Bucket label format | Bucket count          |
|--------|-------------|---------------------|-----------------------|
| today  | hour        | `HH:00`             | 24                    |
| week   | day         | `Mon`, `Tue`, …     | 7                     |
| month  | day         | `Apr 12`            | ~30                   |
| all    | week        | `Apr 14`            | (earliest order → now)|

Buckets that contain zero orders still appear with `revenue: 0` (so chart has continuous axis).

### 5.4 `topProducts` computation

Group `orders` by `productId`, sum `totalAmount`, sort desc, take top 5. Return `{ name, revenue }[]`.

## 6. Components

New directory: `app/src/components/sales/`

### 6.1 `kpi-cards.tsx`

Props: `{ revenue, orderCount, avgOrderValue, topProduct }`.

4-card row. Each card matches existing `dashboard/stat-card.tsx` visual style (dark bg, mono uppercase label, large value). Cards:

1. **Revenue** — currency-formatted total.
2. **Orders** — integer count.
3. **Avg Order Value** — currency.
4. **Top Product** — product name (small) + revenue (currency).

Empty state: top product card shows "—" when `topProduct === null`.

### 6.2 `range-tabs.tsx`

Segmented control with 4 options: Today / Week / Month / All. Controlled component:

```ts
type Range = 'today' | 'week' | 'month' | 'all'
function RangeTabs({ value, onChange }: { value: Range; onChange: (r: Range) => void }): JSX.Element
```

Visual: pill-group, active tab uses accent color (`#3b7ef8`).

### 6.3 `sales-charts.tsx`

Two-card flex row. Cards reuse the `ChartCard` shell pattern from `dashboard/charts.tsx` (rounded, dark, mono uppercase title).

**Left card — Revenue Trend (~60% width):**
Vertical CSS bars. Each bar height = `(bucket.revenue / max) * 100%`. X-axis labels under bars (every Nth label if too crowded). Tooltip on hover showing bucket label + currency value.

**Right card — Top Products (~40% width):**
Horizontal bar list. Each row: product name (left), bar (middle, width proportional to top revenue), revenue label (right).

Empty state: "No sales in this range" centered in card.

### 6.4 `sales-table.tsx`

Columns: Date (`createdAt`, formatted) · Order ID (first 8 chars of cuid) · Product · Qty · Unit Price · Total · Buyer (`buyerName` over `buyerContact`, stacked, both nullable shown as "—") · Paid At.

Features:

- Header click toggles sort asc → desc → none for that column. Only one active sort column at a time.
- Search input above table filters rows where buyer name OR product name contains query (case-insensitive substring).
- Sort + search are pure client-side over `orders` state.

Matches dark visual style of `products/product-table.tsx`.

### 6.5 `export-csv-button.tsx`

Top-right header button. On click:

1. Take currently visible rows (post-search, post-sort).
2. Serialize to CSV with header row: `Date,Order ID,Product,Qty,Unit Price,Total,Buyer Name,Buyer Contact,Paid At`.
3. Trigger download as `sales-{businessCode}-{YYYY-MM-DD}.csv` via Blob + temporary `<a>` element.

No server endpoint — pure client-side CSV from already-loaded data.

## 7. Page layout

```
┌────────────────────────────────────────────────────────────┐
│ Sales                              [Range tabs] [Export]   │  Header
├────────────────────────────────────────────────────────────┤
│ [Revenue] [Orders] [AOV] [Top Product]                     │  KPI row
├────────────────────────────────────────────────────────────┤
│ ┌────────────────────────┐ ┌─────────────────────────────┐ │
│ │ Revenue Trend (60%)    │ │ Top Products (40%)          │ │  Charts
│ └────────────────────────┘ └─────────────────────────────┘ │
├────────────────────────────────────────────────────────────┤
│ [Search…]                                                  │
│ ┌────────────────────────────────────────────────────────┐ │
│ │ Sales table                                            │ │
│ └────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────┘
```

Page shell (BusinessStrip + Sidebar + main column) matches `products.tsx` exactly.

## 8. Data flow

1. **Initial:** loader fetches with `range='all'`. Page state seeded from `initialSales`.
2. **Range change:** user clicks `RangeTabs` → call `fetchSales({ businessId, range })` → replace `orders`, `kpis`, `series`, `topProducts` in state. Show subtle loading state on KPI/chart cards during fetch.
3. **Search:** pure client-side `useMemo` filter over `orders`.
4. **Sort:** pure client-side `useMemo` sort over filtered rows.
5. **Export:** snapshot current `displayedRows` → CSV download.

## 9. Error handling

- Server function errors propagate to TanStack Router's error boundary (existing pattern).
- Empty data: KPI cards show 0 / "—"; charts show empty state; table shows "No sales yet" row.
- CSV export with zero rows: button disabled.

## 10. Files touched

**New:**

- `app/src/routes/$businessCode/sales.tsx`
- `app/src/lib/sales-server-fns.ts`
- `app/src/components/sales/kpi-cards.tsx`
- `app/src/components/sales/range-tabs.tsx`
- `app/src/components/sales/sales-charts.tsx`
- `app/src/components/sales/sales-table.tsx`
- `app/src/components/sales/export-csv-button.tsx`

**Modified:**

- `app/src/components/sidebar.tsx` — add Sales nav item.

**Generated (by router):**

- `app/src/routeTree.gen.ts` — auto-regenerated when sales route added.

## 11. Testing

Follow existing test conventions in `app/src/__tests__/` and `tests/`:

- Unit-test server bucket logic (especially edge cases: empty range, single order, range boundaries).
- Unit-test CSV serializer (commas in buyer names → quoted properly).
- Smoke-test route render with empty + populated data.

No DB schema changes → no migration needed.
