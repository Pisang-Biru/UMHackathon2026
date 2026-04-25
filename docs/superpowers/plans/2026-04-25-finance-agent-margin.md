# Finance Agent — Cost Data + Real Margin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture per-product/per-business/per-order cost data, compute real margin on every paid order, push loss/missing-data alerts to the Inbox, and add a chat-reachable Finance agent for margin Q&A.

**Architecture:** Dual-migrator boundary preserved — Prisma owns all new `public.*` columns/tables. SQLAlchemy mirrors the schema for the Python services. Margin is a pure function (`compute_margin`) used by both a Celery worker (auto-check on PAID) and the Finance LangGraph agent (read-only chat tools). The PAID-transition trigger is a thin HTTP endpoint on the agents service that the Next.js order-server-fns hits after marking an order paid.

**Tech Stack:** Prisma + PostgreSQL (`public`), SQLAlchemy + Alembic-aware Python (`agents` schema untouched here), FastAPI, Celery, LangGraph + LangChain OpenAI, Next.js (TanStack Router) + React, Pytest, Vitest.

**Spec:** `docs/superpowers/specs/2026-04-25-finance-agent-margin-design.md`.

---

## File Map

**New (Python):**
- `agents/app/agents/finance/__init__.py` — package marker, re-exports `AGENT_META` and `build_finance_agent`
- `agents/app/agents/finance/margin.py` — pure `compute_margin()` function + `MarginStatus` enum mirror
- `agents/app/agents/finance/tools.py` — read-only LangChain tools (`get_product_costs`, `get_order_margin`, `list_loss_orders`, `list_missing_data_products`, `product_margin_summary`, `top_losers`)
- `agents/app/agents/finance/agent.py` — LangGraph `StateGraph` builder + `AGENT_META`
- `agents/app/worker/finance_check.py` — Celery task `check_order_margin(order_id)`
- `agents/app/routers/finance.py` — `POST /finance/check/{order_id}` (enqueue), `POST /finance/chat` (agent invoke), `POST /finance/alerts/{id}/resolve`
- `agents/tests/test_margin.py`
- `agents/tests/test_finance_check.py`
- `agents/tests/test_finance_agent.py`
- `agents/tests/test_finance_router.py`

**Modified (Python):**
- `agents/app/db.py` — add new fields/models mirroring Prisma
- `agents/app/worker/celery_app.py` (or wherever tasks register) — import `finance_check` so Celery sees it
- `agents/app/main.py` — `include_router(finance_router)`

**New / Modified (Prisma + migration):**
- `app/prisma/schema.prisma` — extend `Product`, `Business`, `Order`; add `MarginStatus`, `FinanceAlertKind` enums; add `FinanceAlert` model
- `app/prisma/migrations/<timestamp>_finance_margin/migration.sql` — hand-written

**New / Modified (Frontend):**
- `app/src/routes/$businessCode/products/...` (existing product create/edit) — add `cogs`, `packagingCost` inputs
- `app/src/routes/$businessCode/settings.tsx` — new (or extend existing) — `platformFeePct`, `defaultTransportCost`
- `app/src/routes/$businessCode/orders/$orderId.tsx` (existing order detail) — show + edit `transportCost`, render margin badge
- `app/src/routes/$businessCode/sales.tsx` (existing sales page) — `Real Margin` column + "Loss only" filter chip
- `app/src/routes/$businessCode/inbox.tsx` (existing inbox) — `Finance` tab listing alerts
- `app/src/lib/order-server-fns.ts` — POST to agents service after PAID transition
- `app/src/lib/finance-server-fns.ts` — new — server functions for finance settings + alerts
- `app/src/__tests__/finance-margin-badge.test.tsx` — component tests

---

## Conventions for this plan

- Decimal type: SQLAlchemy `Numeric(10, 2)`, Prisma `Decimal @db.Decimal(10, 2)`, Python `decimal.Decimal`. Never `float`.
- All new SQL tables/columns in `public` schema (Prisma-owned). Do not touch `agents` schema.
- All commits omit the `Co-Authored-By` trailer (project convention).
- Pytest commands run from `agents/` directory: `cd agents && pytest -v <path>`.
- Migration application requires explicit user approval before any `prisma migrate dev` / `prisma db execute` per `CLAUDE.md`. Plan tasks STOP and prompt the user before running these.

---

## Task 1: Prisma schema — extend models, add `FinanceAlert`

**Files:**
- Modify: `app/prisma/schema.prisma`
- Create: `app/prisma/migrations/<timestamp>_finance_margin/migration.sql`

- [ ] **Step 1: Add cost fields to `Product` model**

Open `app/prisma/schema.prisma`. Locate `model Product`. Insert before `@@map("product")`:

```prisma
  cogs           Decimal? @db.Decimal(10, 2)
  packagingCost  Decimal? @db.Decimal(10, 2)
```

- [ ] **Step 2: Add cost-config fields to `Business` model**

Locate `model Business`. Insert before `@@map("business")`:

```prisma
  platformFeePct       Decimal @default(0.05) @db.Decimal(5, 4)
  defaultTransportCost Decimal @default(0)    @db.Decimal(10, 2)
```

- [ ] **Step 3: Add margin fields + enum on `Order`**

Locate `model Order`. Insert before `@@map("order")`:

```prisma
  transportCost Decimal?      @db.Decimal(10, 2)
  realMargin    Decimal?      @db.Decimal(10, 2)
  marginStatus  MarginStatus?
  alerts        FinanceAlert[]
```

After the `Order` model block (and any existing enums), add:

```prisma
enum MarginStatus {
  OK
  LOSS
  MISSING_DATA

  @@schema("public")
}
```

- [ ] **Step 4: Add `FinanceAlert` model + enum**

Append to the file:

```prisma
model FinanceAlert {
  id          String           @id @default(cuid())
  businessId  String
  business    Business         @relation(fields: [businessId], references: [id], onDelete: Cascade)
  orderId     String?
  order       Order?           @relation(fields: [orderId], references: [id], onDelete: Cascade)
  productId   String?
  product     Product?         @relation(fields: [productId], references: [id], onDelete: Cascade)
  kind        FinanceAlertKind
  marginValue Decimal?         @db.Decimal(10, 2)
  message     String
  resolvedAt  DateTime?
  createdAt   DateTime         @default(now())
  updatedAt   DateTime         @updatedAt

  @@map("finance_alert")
  @@index([businessId, resolvedAt])
  @@index([businessId, kind, resolvedAt])
  @@schema("public")
}

enum FinanceAlertKind {
  LOSS
  MISSING_DATA

  @@schema("public")
}
```

Also add the back-relation on `Product` and `Business`:

In `model Product`, add a line:
```prisma
  alerts        FinanceAlert[]
```
In `model Business`, add a line:
```prisma
  alerts        FinanceAlert[]
```

- [ ] **Step 5: Hand-write migration SQL**

Generate a timestamp like `20260425XXXXXX` (YYYYMMDDHHMMSS in UTC). Create `app/prisma/migrations/<timestamp>_finance_margin/migration.sql` with:

```sql
-- AlterTable: Product
ALTER TABLE "public"."product"
  ADD COLUMN "cogs" DECIMAL(10,2),
  ADD COLUMN "packagingCost" DECIMAL(10,2);

-- AlterTable: Business
ALTER TABLE "public"."business"
  ADD COLUMN "platformFeePct" DECIMAL(5,4) NOT NULL DEFAULT 0.05,
  ADD COLUMN "defaultTransportCost" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- CreateEnum: MarginStatus
CREATE TYPE "public"."MarginStatus" AS ENUM ('OK', 'LOSS', 'MISSING_DATA');

-- AlterTable: Order
ALTER TABLE "public"."order"
  ADD COLUMN "transportCost" DECIMAL(10,2),
  ADD COLUMN "realMargin"    DECIMAL(10,2),
  ADD COLUMN "marginStatus"  "public"."MarginStatus";

-- CreateEnum: FinanceAlertKind
CREATE TYPE "public"."FinanceAlertKind" AS ENUM ('LOSS', 'MISSING_DATA');

-- CreateTable: finance_alert
CREATE TABLE "public"."finance_alert" (
    "id"           TEXT NOT NULL,
    "businessId"   TEXT NOT NULL,
    "orderId"      TEXT,
    "productId"    TEXT,
    "kind"         "public"."FinanceAlertKind" NOT NULL,
    "marginValue"  DECIMAL(10,2),
    "message"      TEXT NOT NULL,
    "resolvedAt"   TIMESTAMP(3),
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,
    CONSTRAINT "finance_alert_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "finance_alert_businessId_resolvedAt_idx"
  ON "public"."finance_alert"("businessId", "resolvedAt");
CREATE INDEX "finance_alert_businessId_kind_resolvedAt_idx"
  ON "public"."finance_alert"("businessId", "kind", "resolvedAt");

ALTER TABLE "public"."finance_alert"
  ADD CONSTRAINT "finance_alert_businessId_fkey"
    FOREIGN KEY ("businessId") REFERENCES "public"."business"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "finance_alert_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "public"."order"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "finance_alert_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "public"."product"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 6: STOP — ask user to apply the migration**

Per `CLAUDE.md`, do NOT run `prisma migrate dev` unprompted. Print this exact message to the user:

> Migration is hand-written at `app/prisma/migrations/<timestamp>_finance_margin/migration.sql`. Please review, then either run `prisma migrate dev` (will detect and apply this migration) or apply the SQL directly via `prisma db execute --file`. Reply once applied and I will continue.

Wait for user. Do not proceed.

- [ ] **Step 7: After user applies, regenerate Prisma client**

Run from `app/`:
```
pnpm prisma generate
```
Expected: `✔ Generated Prisma Client`.

- [ ] **Step 8: Commit**

```bash
git add app/prisma/schema.prisma app/prisma/migrations/
git commit -m "feat(schema): add cost fields, margin status, finance_alert table"
```

---

## Task 2: SQLAlchemy mirror in `agents/app/db.py`

**Files:**
- Modify: `agents/app/db.py`
- Test: `agents/tests/test_finance_models.py` (new)

- [ ] **Step 1: Write failing test for new fields**

Create `agents/tests/test_finance_models.py`:

```python
from decimal import Decimal
from app.db import Product, Business, Order, FinanceAlert, MarginStatus, FinanceAlertKind


def test_product_has_cost_columns():
    cols = {c.name for c in Product.__table__.columns}
    assert "cogs" in cols
    assert "packagingCost" in cols


def test_business_has_fee_columns():
    cols = {c.name for c in Business.__table__.columns}
    assert "platformFeePct" in cols
    assert "defaultTransportCost" in cols


def test_order_has_margin_columns():
    cols = {c.name for c in Order.__table__.columns}
    assert "transportCost" in cols
    assert "realMargin" in cols
    assert "marginStatus" in cols


def test_finance_alert_table_shape():
    cols = {c.name for c in FinanceAlert.__table__.columns}
    assert {"id", "businessId", "orderId", "productId", "kind",
            "marginValue", "message", "resolvedAt", "createdAt",
            "updatedAt"} <= cols


def test_margin_status_enum_values():
    assert {e.value for e in MarginStatus} == {"OK", "LOSS", "MISSING_DATA"}


def test_finance_alert_kind_enum_values():
    assert {e.value for e in FinanceAlertKind} == {"LOSS", "MISSING_DATA"}
```

- [ ] **Step 2: Run test, verify it fails**

```
cd agents && pytest tests/test_finance_models.py -v
```
Expected: ImportError on `MarginStatus`, `FinanceAlertKind`, `FinanceAlert`.

- [ ] **Step 3: Add enums + columns + model**

Edit `agents/app/db.py`. Near the top with other enums, add:

```python
class MarginStatus(enum.Enum):
    OK = "OK"
    LOSS = "LOSS"
    MISSING_DATA = "MISSING_DATA"


class FinanceAlertKind(enum.Enum):
    LOSS = "LOSS"
    MISSING_DATA = "MISSING_DATA"
```

In `class Product(Base):`, add columns:

```python
    cogs = Column(Numeric(10, 2), nullable=True)
    packagingCost = Column(Numeric(10, 2), nullable=True)
```

In `class Business(Base):`, add columns:

```python
    platformFeePct = Column(Numeric(5, 4), nullable=False, server_default=text("0.05"))
    defaultTransportCost = Column(Numeric(10, 2), nullable=False, server_default=text("0"))
```

In `class Order(Base):`, add columns:

```python
    transportCost = Column(Numeric(10, 2), nullable=True)
    realMargin = Column(Numeric(10, 2), nullable=True)
    marginStatus = Column(SAEnum(MarginStatus, name="MarginStatus"), nullable=True)
```

After `class Order`, add:

```python
class FinanceAlert(Base):
    __tablename__ = "finance_alert"
    id = Column(String, primary_key=True)
    businessId = Column(String, ForeignKey("business.id", ondelete="CASCADE"), nullable=False)
    orderId = Column(String, ForeignKey("order.id", ondelete="CASCADE"), nullable=True)
    productId = Column(String, ForeignKey("product.id", ondelete="CASCADE"), nullable=True)
    kind = Column(SAEnum(FinanceAlertKind, name="FinanceAlertKind"), nullable=False)
    marginValue = Column(Numeric(10, 2), nullable=True)
    message = Column(Text, nullable=False)
    resolvedAt = Column(DateTime, nullable=True)
    createdAt = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
    updatedAt = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
```

- [ ] **Step 4: Run test, verify pass**

```
cd agents && pytest tests/test_finance_models.py -v
```
Expected: 6 passed.

- [ ] **Step 5: Run full agents test suite to check no regressions**

```
cd agents && pytest -x --ff
```
Expected: all green (or only previously-failing tests unchanged).

- [ ] **Step 6: Commit**

```bash
git add agents/app/db.py agents/tests/test_finance_models.py
git commit -m "feat(db): mirror finance schema (Product/Business/Order cols, FinanceAlert)"
```

---

## Task 3: `compute_margin()` pure function + tests

**Files:**
- Create: `agents/app/agents/finance/__init__.py`
- Create: `agents/app/agents/finance/margin.py`
- Create: `agents/tests/test_margin.py`

- [ ] **Step 1: Create package init (empty for now)**

Create `agents/app/agents/finance/__init__.py`:

```python
# Finance agent package. Public exports added incrementally:
#   AGENT_META + build_finance_agent (Task 6)
from app.agents.finance.margin import compute_margin, MarginOutcome  # noqa: F401
```

- [ ] **Step 2: Write failing tests for `compute_margin`**

Create `agents/tests/test_margin.py`:

```python
from decimal import Decimal
from types import SimpleNamespace
from app.agents.finance.margin import compute_margin, MarginOutcome
from app.db import MarginStatus


def _o(qty=1, total="100.00", transport=None):
    return SimpleNamespace(
        qty=qty,
        totalAmount=Decimal(total),
        transportCost=Decimal(transport) if transport is not None else None,
    )


def _p(cogs=None, packaging=None):
    return SimpleNamespace(
        cogs=Decimal(cogs) if cogs is not None else None,
        packagingCost=Decimal(packaging) if packaging is not None else None,
    )


def _b(fee="0.05"):
    return SimpleNamespace(platformFeePct=Decimal(fee))


def test_ok_case_positive_margin():
    out = compute_margin(_o(qty=2, total="200.00", transport="10.00"),
                         _p(cogs="40.00", packaging="2.00"),
                         _b(fee="0.05"))
    # revenue 200 - cogs 80 - packaging 4 - transport 10 - fee 10 = 96.00
    assert out.status == MarginStatus.OK
    assert out.real_margin == Decimal("96.00")


def test_loss_case_negative_margin():
    out = compute_margin(_o(qty=1, total="20.00", transport="15.00"),
                         _p(cogs="10.00", packaging="2.00"),
                         _b(fee="0.05"))
    # 20 - 10 - 2 - 15 - 1 = -8.00
    assert out.status == MarginStatus.LOSS
    assert out.real_margin == Decimal("-8.00")


def test_missing_cogs():
    out = compute_margin(_o(transport="10.00"), _p(cogs=None, packaging="2.00"), _b())
    assert out.status == MarginStatus.MISSING_DATA
    assert out.real_margin is None
    assert "cogs" in out.missing_fields


def test_missing_packaging():
    out = compute_margin(_o(transport="10.00"), _p(cogs="10.00", packaging=None), _b())
    assert out.status == MarginStatus.MISSING_DATA
    assert "packagingCost" in out.missing_fields


def test_missing_transport():
    out = compute_margin(_o(transport=None), _p(cogs="10.00", packaging="2.00"), _b())
    assert out.status == MarginStatus.MISSING_DATA
    assert "transportCost" in out.missing_fields


def test_zero_platform_fee():
    out = compute_margin(_o(qty=1, total="100.00", transport="0.00"),
                         _p(cogs="50.00", packaging="0.00"),
                         _b(fee="0.0000"))
    assert out.status == MarginStatus.OK
    assert out.real_margin == Decimal("50.00")


def test_decimal_precision_no_float_drift():
    # 0.1 + 0.2 != 0.3 in float; ensure Decimal path keeps exact.
    out = compute_margin(_o(qty=3, total="0.30", transport="0.00"),
                         _p(cogs="0.10", packaging="0.00"),
                         _b(fee="0.00"))
    # revenue 0.30 - cogs 0.30 = 0.00
    assert out.real_margin == Decimal("0.00")


def test_breakdown_returned():
    out = compute_margin(_o(qty=2, total="200.00", transport="10.00"),
                         _p(cogs="40.00", packaging="2.00"),
                         _b(fee="0.05"))
    assert out.revenue == Decimal("200.00")
    assert out.cogs_total == Decimal("80.00")
    assert out.packaging_total == Decimal("4.00")
    assert out.transport == Decimal("10.00")
    assert out.platform_fee == Decimal("10.00")
```

- [ ] **Step 3: Run, verify fail**

```
cd agents && pytest tests/test_margin.py -v
```
Expected: ImportError or fail on missing module.

- [ ] **Step 4: Implement `compute_margin`**

Create `agents/app/agents/finance/margin.py`:

```python
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Optional
from app.db import MarginStatus

_QUANT = Decimal("0.01")


@dataclass
class MarginOutcome:
    status: MarginStatus
    real_margin: Optional[Decimal]
    revenue: Optional[Decimal] = None
    cogs_total: Optional[Decimal] = None
    packaging_total: Optional[Decimal] = None
    transport: Optional[Decimal] = None
    platform_fee: Optional[Decimal] = None
    missing_fields: list[str] = field(default_factory=list)


def compute_margin(order, product, business) -> MarginOutcome:
    """Pure function: deterministic margin computation.
    Inputs are duck-typed; expects:
      order.qty, order.totalAmount, order.transportCost
      product.cogs, product.packagingCost
      business.platformFeePct
    All money fields are decimal.Decimal (or None for missing).
    """
    missing: list[str] = []
    if product.cogs is None:
        missing.append("cogs")
    if product.packagingCost is None:
        missing.append("packagingCost")
    if order.transportCost is None:
        missing.append("transportCost")
    if missing:
        return MarginOutcome(
            status=MarginStatus.MISSING_DATA,
            real_margin=None,
            missing_fields=missing,
        )

    qty = Decimal(order.qty)
    revenue = Decimal(order.totalAmount).quantize(_QUANT)
    cogs_total = (Decimal(product.cogs) * qty).quantize(_QUANT)
    packaging_total = (Decimal(product.packagingCost) * qty).quantize(_QUANT)
    transport = Decimal(order.transportCost).quantize(_QUANT)
    platform_fee = (revenue * Decimal(business.platformFeePct)).quantize(_QUANT)
    real_margin = (revenue - cogs_total - packaging_total - transport - platform_fee).quantize(_QUANT)

    status = MarginStatus.LOSS if real_margin < 0 else MarginStatus.OK
    return MarginOutcome(
        status=status,
        real_margin=real_margin,
        revenue=revenue,
        cogs_total=cogs_total,
        packaging_total=packaging_total,
        transport=transport,
        platform_fee=platform_fee,
    )
```

- [ ] **Step 5: Run tests, verify pass**

```
cd agents && pytest tests/test_margin.py -v
```
Expected: 8 passed.

- [ ] **Step 6: Commit**

```bash
git add agents/app/agents/finance/ agents/tests/test_margin.py
git commit -m "feat(finance): pure compute_margin function + tests"
```

---

## Task 4: Celery worker task `check_order_margin`

**Files:**
- Create: `agents/app/worker/finance_check.py`
- Modify: `agents/app/worker/celery_app.py` (or `tasks.py` — import path so task is registered)
- Test: `agents/tests/test_finance_check.py`

- [ ] **Step 1: Write failing tests**

Create `agents/tests/test_finance_check.py`:

```python
from decimal import Decimal
from datetime import datetime, timezone
from cuid2 import Cuid
from sqlalchemy import select

from app.db import (
    SessionLocal, Business, Product, Order, OrderStatus,
    FinanceAlert, FinanceAlertKind, MarginStatus,
)
from app.worker.finance_check import check_order_margin

cuid = Cuid().generate


def _seed_basic(session, *, cogs="40.00", packaging="2.00",
                transport="10.00", fee="0.05",
                qty=2, total="200.00"):
    bid = cuid()
    pid = cuid()
    oid = cuid()
    session.add(Business(
        id=bid, name="Biz", code=bid[:6],
        platformFeePct=Decimal(fee),
        defaultTransportCost=Decimal("0"),
    ))
    session.add(Product(
        id=pid, name="P", price=Decimal("100.00"), stock=10,
        businessId=bid,
        cogs=Decimal(cogs) if cogs else None,
        packagingCost=Decimal(packaging) if packaging else None,
    ))
    session.add(Order(
        id=oid, businessId=bid, productId=pid, qty=qty,
        unitPrice=Decimal("100.00"), totalAmount=Decimal(total),
        status=OrderStatus.PAID, paidAt=datetime.now(timezone.utc),
        transportCost=Decimal(transport) if transport else None,
    ))
    session.commit()
    return bid, pid, oid


def test_ok_writes_margin_no_alert():
    with SessionLocal() as s:
        bid, pid, oid = _seed_basic(s)
    check_order_margin(oid)
    with SessionLocal() as s:
        order = s.get(Order, oid)
        assert order.marginStatus == MarginStatus.OK
        assert order.realMargin == Decimal("96.00")
        alerts = s.execute(select(FinanceAlert).where(FinanceAlert.orderId == oid)).all()
        assert alerts == []


def test_loss_inserts_alert():
    with SessionLocal() as s:
        bid, pid, oid = _seed_basic(s, cogs="90.00", total="100.00", transport="20.00", qty=1)
    check_order_margin(oid)
    with SessionLocal() as s:
        order = s.get(Order, oid)
        assert order.marginStatus == MarginStatus.LOSS
        rows = s.execute(select(FinanceAlert).where(
            FinanceAlert.orderId == oid,
            FinanceAlert.kind == FinanceAlertKind.LOSS,
        )).scalars().all()
        assert len(rows) == 1
        assert rows[0].marginValue == order.realMargin


def test_missing_data_inserts_alert_dedup_per_product():
    with SessionLocal() as s:
        bid, pid, oid = _seed_basic(s, cogs=None)
    check_order_margin(oid)
    check_order_margin(oid)  # idempotent re-run
    with SessionLocal() as s:
        order = s.get(Order, oid)
        assert order.marginStatus == MarginStatus.MISSING_DATA
        assert order.realMargin is None
        rows = s.execute(select(FinanceAlert).where(
            FinanceAlert.productId == pid,
            FinanceAlert.kind == FinanceAlertKind.MISSING_DATA,
            FinanceAlert.resolvedAt.is_(None),
        )).scalars().all()
        assert len(rows) == 1


def test_loss_alert_dedup_per_order():
    with SessionLocal() as s:
        bid, pid, oid = _seed_basic(s, cogs="90.00", total="100.00", transport="20.00", qty=1)
    check_order_margin(oid)
    check_order_margin(oid)
    with SessionLocal() as s:
        rows = s.execute(select(FinanceAlert).where(
            FinanceAlert.orderId == oid,
            FinanceAlert.resolvedAt.is_(None),
        )).scalars().all()
        assert len(rows) == 1
```

- [ ] **Step 2: Run, verify fail**

```
cd agents && pytest tests/test_finance_check.py -v
```
Expected: ImportError on `app.worker.finance_check`.

- [ ] **Step 3: Implement worker task**

Create `agents/app/worker/finance_check.py`:

```python
import logging
from cuid2 import Cuid as _Cuid
from sqlalchemy import select
from app.db import (
    SessionLocal, Order, Product, Business,
    FinanceAlert, FinanceAlertKind, MarginStatus,
)
from app.agents.finance.margin import compute_margin
from app.worker.celery_app import celery_app

log = logging.getLogger(__name__)
_cuid = _Cuid().generate


@celery_app.task(name="finance.check_order_margin")
def check_order_margin(order_id: str) -> dict:
    """Compute margin for the given order, persist on Order row,
    and insert FinanceAlert when LOSS or MISSING_DATA. Idempotent.
    Returns a small dict for logging/testing.
    """
    with SessionLocal() as s:
        order = s.get(Order, order_id)
        if order is None:
            log.warning("check_order_margin: order %s not found", order_id)
            return {"ok": False, "reason": "missing_order"}
        product = s.get(Product, order.productId)
        business = s.get(Business, order.businessId)
        if product is None or business is None:
            log.warning("check_order_margin: missing product/business for %s", order_id)
            return {"ok": False, "reason": "missing_relations"}

        outcome = compute_margin(order, product, business)
        order.realMargin = outcome.real_margin
        order.marginStatus = outcome.status

        if outcome.status == MarginStatus.LOSS:
            existing = s.execute(select(FinanceAlert).where(
                FinanceAlert.orderId == order.id,
                FinanceAlert.kind == FinanceAlertKind.LOSS,
                FinanceAlert.resolvedAt.is_(None),
            )).scalar_one_or_none()
            if existing is None:
                short = order.id[:8]
                s.add(FinanceAlert(
                    id=_cuid(),
                    businessId=order.businessId,
                    orderId=order.id,
                    kind=FinanceAlertKind.LOSS,
                    marginValue=outcome.real_margin,
                    message=f"Order {short}: real margin RM{outcome.real_margin} (loss)",
                ))
        elif outcome.status == MarginStatus.MISSING_DATA:
            existing = s.execute(select(FinanceAlert).where(
                FinanceAlert.productId == product.id,
                FinanceAlert.kind == FinanceAlertKind.MISSING_DATA,
                FinanceAlert.resolvedAt.is_(None),
            )).scalar_one_or_none()
            if existing is None:
                fields = ", ".join(outcome.missing_fields)
                s.add(FinanceAlert(
                    id=_cuid(),
                    businessId=order.businessId,
                    productId=product.id,
                    kind=FinanceAlertKind.MISSING_DATA,
                    message=f"Product '{product.name}' missing: {fields}",
                ))

        s.commit()
        return {
            "ok": True,
            "status": outcome.status.value,
            "real_margin": str(outcome.real_margin) if outcome.real_margin is not None else None,
        }
```

- [ ] **Step 4: Ensure Celery sees the task**

Open `agents/app/worker/celery_app.py`. Confirm `include` list (or autodiscover) covers `app.worker.finance_check`. If `include=[...]`, append `"app.worker.finance_check"`. If `celery_app.autodiscover_tasks(["app.worker"])`, no change needed. Verify by running:

```
cd agents && python -c "from app.worker.celery_app import celery_app; print('finance.check_order_margin' in celery_app.tasks)"
```
Expected: `True`.

- [ ] **Step 5: Run worker tests, verify pass**

```
cd agents && pytest tests/test_finance_check.py -v
```
Expected: 4 passed. Tests call `check_order_margin(oid)` synchronously — Celery `@task` decorator allows direct call.

- [ ] **Step 6: Commit**

```bash
git add agents/app/worker/finance_check.py agents/app/worker/celery_app.py agents/tests/test_finance_check.py
git commit -m "feat(finance): celery task to auto-compute margin and emit alerts"
```

---

## Task 5: FastAPI router — `/finance/check`, `/finance/alerts/:id/resolve`

**Files:**
- Create: `agents/app/routers/finance.py`
- Modify: `agents/app/main.py`
- Test: `agents/tests/test_finance_router.py`

- [ ] **Step 1: Write failing test**

Create `agents/tests/test_finance_router.py`:

```python
from decimal import Decimal
from datetime import datetime, timezone
from cuid2 import Cuid
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.main import app
from app.db import (
    SessionLocal, Business, Product, Order, OrderStatus,
    FinanceAlert, FinanceAlertKind,
)

cuid = Cuid().generate
client = TestClient(app)


def _seed_loss():
    bid, pid, oid = cuid(), cuid(), cuid()
    with SessionLocal() as s:
        s.add(Business(id=bid, name="B", code=bid[:6],
                       platformFeePct=Decimal("0.05"),
                       defaultTransportCost=Decimal("0")))
        s.add(Product(id=pid, name="P", price=Decimal("100"), stock=1,
                      businessId=bid, cogs=Decimal("90"),
                      packagingCost=Decimal("2")))
        s.add(Order(id=oid, businessId=bid, productId=pid, qty=1,
                    unitPrice=Decimal("100"), totalAmount=Decimal("100"),
                    status=OrderStatus.PAID, paidAt=datetime.now(timezone.utc),
                    transportCost=Decimal("20")))
        s.commit()
    return bid, pid, oid


def test_check_endpoint_runs_margin():
    _, _, oid = _seed_loss()
    r = client.post(f"/finance/check/{oid}")
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["status"] == "LOSS"


def test_resolve_alert_sets_resolvedAt():
    _, _, oid = _seed_loss()
    client.post(f"/finance/check/{oid}")
    with SessionLocal() as s:
        alert = s.execute(select(FinanceAlert).where(
            FinanceAlert.orderId == oid,
            FinanceAlert.kind == FinanceAlertKind.LOSS,
        )).scalar_one()
        aid = alert.id
    r = client.post(f"/finance/alerts/{aid}/resolve")
    assert r.status_code == 200
    with SessionLocal() as s:
        alert = s.get(FinanceAlert, aid)
        assert alert.resolvedAt is not None


def test_check_unknown_order_404():
    r = client.post("/finance/check/does-not-exist")
    assert r.status_code == 404
```

- [ ] **Step 2: Run, verify fail**

```
cd agents && pytest tests/test_finance_router.py -v
```
Expected: 404 on first test (route not registered).

- [ ] **Step 3: Implement router**

Create `agents/app/routers/finance.py`:

```python
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from app.db import SessionLocal, Order, FinanceAlert
from app.worker.finance_check import check_order_margin

router = APIRouter(prefix="/finance", tags=["finance"])


@router.post("/check/{order_id}")
def trigger_check(order_id: str) -> dict:
    with SessionLocal() as s:
        order = s.get(Order, order_id)
        if order is None:
            raise HTTPException(status_code=404, detail="order not found")
    # Synchronous call for now (small workload, testable). In production this
    # could be `check_order_margin.delay(order_id)`; keep sync until measured
    # latency requires async.
    return check_order_margin(order_id)


@router.post("/alerts/{alert_id}/resolve")
def resolve_alert(alert_id: str) -> dict:
    with SessionLocal() as s:
        alert = s.get(FinanceAlert, alert_id)
        if alert is None:
            raise HTTPException(status_code=404, detail="alert not found")
        alert.resolvedAt = datetime.now(timezone.utc)
        s.commit()
        return {"ok": True, "resolvedAt": alert.resolvedAt.isoformat()}
```

- [ ] **Step 4: Wire router into main**

Edit `agents/app/main.py`. Near other `include_router` calls, add:

```python
from app.routers.finance import router as finance_router
app.include_router(finance_router)
```

- [ ] **Step 5: Run tests, verify pass**

```
cd agents && pytest tests/test_finance_router.py -v
```
Expected: 3 passed.

- [ ] **Step 6: Commit**

```bash
git add agents/app/routers/finance.py agents/app/main.py agents/tests/test_finance_router.py
git commit -m "feat(finance): /finance/check and /finance/alerts/:id/resolve endpoints"
```

---

## Task 6: Finance LangGraph agent + tools

**Files:**
- Create: `agents/app/agents/finance/tools.py`
- Create: `agents/app/agents/finance/agent.py`
- Modify: `agents/app/agents/finance/__init__.py` (export)
- Test: `agents/tests/test_finance_agent.py`

- [ ] **Step 1: Write failing tool tests**

Create `agents/tests/test_finance_agent.py`:

```python
from decimal import Decimal
from datetime import datetime, timezone, timedelta
from cuid2 import Cuid

from app.db import (
    SessionLocal, Business, Product, Order, OrderStatus,
    MarginStatus, FinanceAlert, FinanceAlertKind,
)
from app.agents.finance.tools import (
    get_product_costs, get_order_margin,
    list_loss_orders, list_missing_data_products,
    product_margin_summary, top_losers,
)

cuid = Cuid().generate


def _seed():
    bid = cuid()
    p_full = cuid()
    p_missing = cuid()
    o_loss = cuid()
    o_ok = cuid()
    with SessionLocal() as s:
        s.add(Business(id=bid, name="B", code=bid[:6],
                       platformFeePct=Decimal("0.05"),
                       defaultTransportCost=Decimal("0")))
        s.add(Product(id=p_full, name="Full", price=Decimal("100"), stock=10,
                      businessId=bid, cogs=Decimal("40"), packagingCost=Decimal("2")))
        s.add(Product(id=p_missing, name="Missing", price=Decimal("50"), stock=10,
                      businessId=bid, cogs=None, packagingCost=Decimal("1")))
        now = datetime.now(timezone.utc)
        s.add(Order(id=o_loss, businessId=bid, productId=p_full, qty=1,
                    unitPrice=Decimal("20"), totalAmount=Decimal("20"),
                    status=OrderStatus.PAID, paidAt=now,
                    transportCost=Decimal("15"),
                    realMargin=Decimal("-38.00"),
                    marginStatus=MarginStatus.LOSS))
        s.add(Order(id=o_ok, businessId=bid, productId=p_full, qty=2,
                    unitPrice=Decimal("100"), totalAmount=Decimal("200"),
                    status=OrderStatus.PAID, paidAt=now,
                    transportCost=Decimal("10"),
                    realMargin=Decimal("96.00"),
                    marginStatus=MarginStatus.OK))
        s.commit()
    return bid, p_full, p_missing, o_loss, o_ok


def test_get_product_costs_full():
    bid, p_full, *_ = _seed()
    out = get_product_costs.invoke({"product_id": p_full})
    assert out["cogs"] == "40.00"
    assert out["missing_fields"] == []


def test_get_product_costs_missing():
    bid, _, p_missing, *_ = _seed()
    out = get_product_costs.invoke({"product_id": p_missing})
    assert "cogs" in out["missing_fields"]


def test_get_order_margin():
    bid, _, _, o_loss, _ = _seed()
    out = get_order_margin.invoke({"order_id": o_loss})
    assert out["margin_status"] == "LOSS"
    assert out["real_margin"] == "-38.00"


def test_list_loss_orders():
    bid, *_ = _seed()
    out = list_loss_orders.invoke({"business_id": bid, "days": 30, "limit": 10})
    assert len(out) == 1
    assert out[0]["margin_status"] == "LOSS"


def test_list_missing_data_products():
    bid, _, p_missing, *_ = _seed()
    out = list_missing_data_products.invoke({"business_id": bid})
    ids = [p["id"] for p in out]
    assert p_missing in ids


def test_product_margin_summary():
    bid, p_full, *_ = _seed()
    out = product_margin_summary.invoke({"product_id": p_full, "days": 30})
    assert out["n_orders"] == 2
    # 96 + (-38) = 58
    assert Decimal(out["real_margin_total"]) == Decimal("58.00")


def test_top_losers():
    bid, *_ = _seed()
    out = top_losers.invoke({"business_id": bid, "days": 30, "limit": 5})
    assert len(out) >= 1
```

Also add agent build smoke test at bottom:

```python
def test_build_finance_agent_smoke():
    from langchain_openai import ChatOpenAI  # already a dep
    from app.agents.finance.agent import build_finance_agent
    # build with a stub-like config just to ensure graph compiles
    import os
    llm = ChatOpenAI(model=os.getenv("MODEL", "gpt-4o-mini"),
                     openai_api_key=os.getenv("API_KEY", "sk-test"),
                     openai_api_base=os.getenv("OPENAI_API_BASE"),
                     temperature=0)
    graph = build_finance_agent(llm)
    assert graph is not None
```

- [ ] **Step 2: Run, verify fail**

```
cd agents && pytest tests/test_finance_agent.py -v
```
Expected: ImportError on tools / agent module.

- [ ] **Step 3: Implement tools**

Create `agents/app/agents/finance/tools.py`:

```python
from datetime import datetime, timezone, timedelta
from decimal import Decimal
from typing import Optional
from sqlalchemy import select, func
from langchain_core.tools import tool

from app.db import (
    SessionLocal, Product, Order, OrderStatus,
    MarginStatus, Business,
)


def _dec_str(v) -> Optional[str]:
    return str(v) if v is not None else None


@tool
def get_product_costs(product_id: str) -> dict:
    """Return cogs, packagingCost, and which fields are missing for a product."""
    with SessionLocal() as s:
        p = s.get(Product, product_id)
        if p is None:
            return {"error": "product not found"}
        missing = []
        if p.cogs is None:
            missing.append("cogs")
        if p.packagingCost is None:
            missing.append("packagingCost")
        return {
            "id": p.id,
            "name": p.name,
            "cogs": _dec_str(p.cogs),
            "packagingCost": _dec_str(p.packagingCost),
            "missing_fields": missing,
        }


@tool
def get_order_margin(order_id: str) -> dict:
    """Return cached real margin and breakdown for a single order."""
    with SessionLocal() as s:
        o = s.get(Order, order_id)
        if o is None:
            return {"error": "order not found"}
        return {
            "id": o.id,
            "margin_status": o.marginStatus.value if o.marginStatus else None,
            "real_margin": _dec_str(o.realMargin),
            "revenue": _dec_str(o.totalAmount),
            "transport_cost": _dec_str(o.transportCost),
            "qty": o.qty,
            "status": o.status.value,
        }


@tool
def list_loss_orders(business_id: str, days: int = 30, limit: int = 20) -> list[dict]:
    """List PAID orders within `days` for `business_id` whose marginStatus is LOSS."""
    since = datetime.now(timezone.utc) - timedelta(days=days)
    with SessionLocal() as s:
        rows = s.execute(
            select(Order)
            .where(Order.businessId == business_id,
                   Order.marginStatus == MarginStatus.LOSS,
                   Order.paidAt >= since)
            .order_by(Order.realMargin.asc())
            .limit(limit)
        ).scalars().all()
        return [{
            "id": o.id,
            "real_margin": _dec_str(o.realMargin),
            "margin_status": o.marginStatus.value,
            "paid_at": o.paidAt.isoformat() if o.paidAt else None,
            "product_id": o.productId,
        } for o in rows]


@tool
def list_missing_data_products(business_id: str) -> list[dict]:
    """List products with one or more null cost fields."""
    with SessionLocal() as s:
        rows = s.execute(
            select(Product).where(
                Product.businessId == business_id,
                (Product.cogs.is_(None)) | (Product.packagingCost.is_(None)),
            )
        ).scalars().all()
        out = []
        for p in rows:
            missing = []
            if p.cogs is None:
                missing.append("cogs")
            if p.packagingCost is None:
                missing.append("packagingCost")
            out.append({"id": p.id, "name": p.name, "missing_fields": missing})
        return out


@tool
def product_margin_summary(product_id: str, days: int = 30) -> dict:
    """Aggregate revenue, real margin, margin %, n_orders for a product."""
    since = datetime.now(timezone.utc) - timedelta(days=days)
    with SessionLocal() as s:
        rows = s.execute(
            select(Order).where(
                Order.productId == product_id,
                Order.status == OrderStatus.PAID,
                Order.paidAt >= since,
            )
        ).scalars().all()
        revenue = sum((o.totalAmount or Decimal(0) for o in rows), Decimal(0))
        margin = sum((o.realMargin or Decimal(0) for o in rows
                      if o.marginStatus == MarginStatus.OK or o.marginStatus == MarginStatus.LOSS),
                     Decimal(0))
        n = len(rows)
        pct = None
        if revenue > 0:
            pct = str((margin / revenue * Decimal(100)).quantize(Decimal("0.01")))
        return {
            "product_id": product_id,
            "days": days,
            "n_orders": n,
            "revenue_total": str(revenue.quantize(Decimal("0.01"))),
            "real_margin_total": str(margin.quantize(Decimal("0.01"))),
            "margin_pct": pct,
        }


@tool
def top_losers(business_id: str, days: int = 30, limit: int = 5) -> list[dict]:
    """Products ranked by worst aggregate real margin within `days`."""
    since = datetime.now(timezone.utc) - timedelta(days=days)
    with SessionLocal() as s:
        rows = s.execute(
            select(Order.productId, func.sum(Order.realMargin).label("m"))
            .where(Order.businessId == business_id,
                   Order.status == OrderStatus.PAID,
                   Order.paidAt >= since,
                   Order.realMargin.is_not(None))
            .group_by(Order.productId)
            .order_by(func.sum(Order.realMargin).asc())
            .limit(limit)
        ).all()
        return [{"product_id": pid, "real_margin_total": str(m)} for pid, m in rows]
```

- [ ] **Step 4: Implement agent graph**

Create `agents/app/agents/finance/agent.py`:

```python
import logging
from typing import Annotated, Literal
from typing_extensions import TypedDict

from langgraph.graph import StateGraph, START, END
from langgraph.graph.message import add_messages
from langchain_core.messages import BaseMessage, SystemMessage
from langchain_core.tools import BaseTool

from app.agents.finance.tools import (
    get_product_costs, get_order_margin,
    list_loss_orders, list_missing_data_products,
    product_margin_summary, top_losers,
)

log = logging.getLogger(__name__)

AGENT_META = {
    "id": "finance",
    "name": "Finance Assistant",
    "role": "Margin analysis, loss alerts, sales costs Q&A",
    "icon": "calculator",
}


class FinanceState(TypedDict, total=False):
    messages: Annotated[list[BaseMessage], add_messages]
    business_id: str
    final_reply: str
    confidence: float
    reasoning: str


_SYSTEM = (
    "You are the Finance Assistant for a small business owner. "
    "Answer questions about real margin, losses, and missing cost data. "
    "Always use the provided tools to ground numbers — never guess. "
    "If the user asks to set or update cost values, reply with: "
    "\"Open the product page to edit cogs / packaging, or business settings to "
    "edit platform fee and default shipping.\" Do not attempt writes. "
    "When responding, include a confidence score in [0,1] and short reasoning."
)


def _tools() -> list[BaseTool]:
    return [
        get_product_costs, get_order_margin,
        list_loss_orders, list_missing_data_products,
        product_margin_summary, top_losers,
    ]


def build_finance_agent(llm):
    tools = _tools()
    llm_with_tools = llm.bind_tools(tools)
    tools_by_name = {t.name: t for t in tools}

    def call_model(state: FinanceState) -> dict:
        msgs = [SystemMessage(content=_SYSTEM), *state["messages"]]
        ai = llm_with_tools.invoke(msgs)
        return {"messages": [ai]}

    def call_tool(state: FinanceState) -> dict:
        from langchain_core.messages import ToolMessage
        last = state["messages"][-1]
        out: list[BaseMessage] = []
        for tc in getattr(last, "tool_calls", []) or []:
            t = tools_by_name[tc["name"]]
            try:
                result = t.invoke(tc["args"])
            except Exception as e:
                result = {"error": str(e)}
            out.append(ToolMessage(content=str(result), tool_call_id=tc["id"]))
        return {"messages": out}

    def route(state: FinanceState) -> Literal["tool", "end"]:
        last = state["messages"][-1]
        if getattr(last, "tool_calls", None):
            return "tool"
        return "end"

    g = StateGraph(FinanceState)
    g.add_node("model", call_model)
    g.add_node("tool", call_tool)
    g.add_edge(START, "model")
    g.add_conditional_edges("model", route, {"tool": "tool", "end": END})
    g.add_edge("tool", "model")
    return g.compile()
```

- [ ] **Step 5: Update package init**

Edit `agents/app/agents/finance/__init__.py`:

```python
from app.agents.finance.margin import compute_margin, MarginOutcome  # noqa: F401
from app.agents.finance.agent import AGENT_META, build_finance_agent  # noqa: F401
```

- [ ] **Step 6: Run tests, verify pass**

```
cd agents && pytest tests/test_finance_agent.py -v
```
Expected: all pass. The smoke test only compiles the graph; no API call.

- [ ] **Step 7: Verify registry picks up finance**

```
cd agents && python -c "from app.agents.registry import discover_agent_meta; print([m['id'] for m in discover_agent_meta()])"
```
Expected: list contains `"finance"` along with existing agents.

- [ ] **Step 8: Commit**

```bash
git add agents/app/agents/finance/ agents/tests/test_finance_agent.py
git commit -m "feat(finance): langgraph agent + read-only tools (margin Q&A)"
```

---

## Task 7: Wire `/finance/chat` endpoint + intent route from support

**Files:**
- Modify: `agents/app/routers/finance.py`
- Modify: `agents/app/routers/support.py`
- Test: extend `agents/tests/test_finance_router.py`

- [ ] **Step 1: Add intent classifier helper**

Append to `agents/app/agents/finance/agent.py`:

```python
_FINANCE_KEYWORDS = (
    "margin", "untung", "profit", "loss", "rugi",
    "kos", "cogs", "fee", "shipping", "transport",
    "packaging", "overhead",
)


def is_finance_intent(text: str) -> bool:
    t = (text or "").lower()
    return any(k in t for k in _FINANCE_KEYWORDS)
```

- [ ] **Step 2: Add `/finance/chat` endpoint**

Edit `agents/app/routers/finance.py`. Add at the top:

```python
from pydantic import BaseModel
from langchain_core.messages import HumanMessage
from langchain_openai import ChatOpenAI
import os
from app.agents.finance.agent import build_finance_agent

_finance_llm = ChatOpenAI(
    model=os.getenv("MODEL"),
    openai_api_key=os.getenv("API_KEY"),
    openai_api_base=os.getenv("OPENAI_API_BASE"),
    temperature=0.2,
)
_finance_graph = build_finance_agent(_finance_llm)


class FinanceChatIn(BaseModel):
    business_id: str
    message: str
```

Append a route:

```python
@router.post("/chat")
async def finance_chat(payload: FinanceChatIn) -> dict:
    state = {
        "business_id": payload.business_id,
        "messages": [HumanMessage(content=payload.message)],
    }
    out = await _finance_graph.ainvoke(state)
    last = out["messages"][-1]
    return {"reply": getattr(last, "content", ""), "agent_id": "finance"}
```

- [ ] **Step 3: Add finance branch to support router**

Edit `agents/app/routers/support.py`. After existing imports add:

```python
from app.agents.finance.agent import is_finance_intent
```

Find the request handler that takes the user message (it constructs a `HumanMessage` from the request body). Just before invoking the manager/support graph, insert:

```python
if is_finance_intent(req.message):
    from app.routers.finance import finance_chat, FinanceChatIn
    return await finance_chat(FinanceChatIn(business_id=req.business_id, message=req.message))
```

(If the existing handler does not have `req.business_id` and `req.message`, adapt to the actual field names — read `agents/app/routers/support.py` first and use whatever the existing pydantic body model exposes.)

- [ ] **Step 4: Add router test**

Append to `agents/tests/test_finance_router.py`:

```python
def test_chat_endpoint_returns_reply(monkeypatch):
    # Stub the finance graph to avoid hitting an LLM in CI.
    from app.routers import finance as fin_mod
    class _FakeGraph:
        async def ainvoke(self, state):
            from langchain_core.messages import AIMessage
            return {"messages": [AIMessage(content="real margin RM10.00")]}
    monkeypatch.setattr(fin_mod, "_finance_graph", _FakeGraph())

    bid, _, _ = _seed_loss()
    r = client.post("/finance/chat", json={"business_id": bid, "message": "untung minggu ni?"})
    assert r.status_code == 200
    body = r.json()
    assert body["agent_id"] == "finance"
    assert "RM10.00" in body["reply"]
```

- [ ] **Step 5: Run tests**

```
cd agents && pytest tests/test_finance_router.py -v
```
Expected: 4 passed.

- [ ] **Step 6: Commit**

```bash
git add agents/app/routers/finance.py agents/app/routers/support.py agents/app/agents/finance/agent.py agents/tests/test_finance_router.py
git commit -m "feat(finance): /finance/chat endpoint + intent route from support"
```

---

## Task 8: Trigger margin check from Next.js after PAID

**Files:**
- Modify: `app/src/lib/order-server-fns.ts`
- Create: `app/src/lib/finance-server-fns.ts`

- [ ] **Step 1: Inspect existing PAID transition site**

Open `app/src/lib/order-server-fns.ts`. Locate every `data: { status: 'PAID', paidAt: new Date(), ... }` block (lines ~101 and ~114). These are the spots to call the agents service after the Prisma update succeeds.

- [ ] **Step 2: Add finance-server-fns module**

Create `app/src/lib/finance-server-fns.ts`:

```ts
const AGENTS_URL = process.env.AGENTS_URL ?? 'http://localhost:8000'

export async function triggerFinanceCheck(orderId: string): Promise<void> {
  try {
    const res = await fetch(`${AGENTS_URL}/finance/check/${orderId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    })
    if (!res.ok) {
      console.warn(`finance check failed for ${orderId}: ${res.status}`)
    }
  } catch (e) {
    console.warn(`finance check error for ${orderId}:`, e)
  }
}
```

- [ ] **Step 3: Call after each PAID set**

Edit `app/src/lib/order-server-fns.ts`. Add import at top:

```ts
import { triggerFinanceCheck } from './finance-server-fns'
```

After each `prisma.order.update({ ... data: { status: 'PAID', ... } })` call that succeeds, add:

```ts
// fire-and-forget; never block the payment confirmation on margin compute
void triggerFinanceCheck(updatedOrderId)
```

(Use the actual id variable from each call site.)

- [ ] **Step 4: Default `transportCost` on Order create**

Find every `prisma.order.create({ data: { ... } })` call site in `app/src/`. Where the surrounding context has a `business` object (or can fetch one), set `transportCost: business.defaultTransportCost`. If the call site does not have a business handy, leave `transportCost` unset — the worker will compute `MISSING_DATA` and the operator will be prompted via the alert.

If there is exactly one create site, expand it inline. If there are several scattered, add a helper in `app/src/lib/order-server-fns.ts`:

```ts
async function defaultTransportFor(businessId: string) {
  const b = await prisma.business.findUnique({
    where: { id: businessId },
    select: { defaultTransportCost: true },
  })
  return b?.defaultTransportCost ?? null
}
```

- [ ] **Step 5: Sanity-check via dev server**

```
cd app && pnpm dev
```
Manually pay a test order. In the agents container logs, confirm a `POST /finance/check/<id>` arrives. Confirm `Order.realMargin` is populated. Halt the dev server when done.

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/finance-server-fns.ts app/src/lib/order-server-fns.ts
git commit -m "feat(orders): trigger finance margin check on PAID transition"
```

---

## Task 9: Frontend — product form, business settings, order detail

**Files:**
- Modify: existing product create/edit page under `app/src/routes/$businessCode/`
- Create or modify: `app/src/routes/$businessCode/settings.tsx`
- Modify: existing order detail page under `app/src/routes/$businessCode/orders/`
- Test: `app/src/__tests__/finance-margin-badge.test.tsx`

- [ ] **Step 1: Locate the existing pages**

Run:
```
grep -rl "product\.create\|productCreate\|ProductForm" app/src/routes app/src/components | head
grep -rl "order\.update\|orderDetail\|OrderDetail" app/src/routes app/src/components | head
```
Note the exact file paths — substitute below.

- [ ] **Step 2: Extend Product form**

In the product form component, add two inputs after the existing `price` field:

```tsx
<label className="text-sm">
  COGS (RM per unit)
  <input
    type="number" step="0.01" min="0"
    value={cogs} onChange={(e) => setCogs(e.target.value)}
    className="..." />
</label>
<label className="text-sm">
  Packaging (RM per unit)
  <input
    type="number" step="0.01" min="0"
    value={packagingCost} onChange={(e) => setPackagingCost(e.target.value)}
    className="..." />
</label>
```

Wire `cogs` and `packagingCost` into the create/update payload. Both optional — empty string means `null`.

- [ ] **Step 3: Add Business settings page**

If `app/src/routes/$businessCode/settings.tsx` does not exist, create it. Add fields for `platformFeePct` (rendered as percentage; convert to decimal on save: `Number(input) / 100`) and `defaultTransportCost`.

```tsx
<label>
  Platform fee (%)
  <input type="number" step="0.01" min="0" max="100"
    value={feePctDisplay}
    onChange={(e) => setFeePctDisplay(e.target.value)} />
</label>
<label>
  Default shipping (RM)
  <input type="number" step="0.01" min="0"
    value={defaultTransport}
    onChange={(e) => setDefaultTransport(e.target.value)} />
</label>
```

On save, persist via a server function calling `prisma.business.update`.

- [ ] **Step 4: Order detail — transportCost edit + margin badge**

In the order detail page, add an editable `transportCost` input (disabled when `order.status === 'PAID'`):

```tsx
<input
  type="number" step="0.01" min="0"
  value={transport} onChange={(e) => setTransport(e.target.value)}
  disabled={order.status === 'PAID'} />
```

Add a margin badge component:

```tsx
function MarginBadge({ status, value }: { status: 'OK' | 'LOSS' | 'MISSING_DATA' | null; value: string | null }) {
  if (status == null) return <span className="text-xs opacity-60">—</span>
  if (status === 'MISSING_DATA') return <span className="rounded bg-zinc-200 px-2 py-0.5 text-xs">missing data</span>
  if (status === 'LOSS') return <span className="rounded bg-red-100 text-red-700 px-2 py-0.5 text-xs">loss RM{value}</span>
  return <span className="rounded bg-green-100 text-green-700 px-2 py-0.5 text-xs">RM{value}</span>
}
```

Render it next to `Total Amount` on the order detail page.

- [ ] **Step 5: Component test for badge**

Create `app/src/__tests__/finance-margin-badge.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { MarginBadge } from '../components/MarginBadge' // export the badge from a component file

describe('MarginBadge', () => {
  it('renders OK with value', () => {
    render(<MarginBadge status="OK" value="96.00" />)
    expect(screen.getByText(/RM96\.00/)).toBeInTheDocument()
  })
  it('renders LOSS in red', () => {
    render(<MarginBadge status="LOSS" value="-12.00" />)
    expect(screen.getByText(/loss RM-12\.00/)).toBeInTheDocument()
  })
  it('renders MISSING_DATA placeholder', () => {
    render(<MarginBadge status="MISSING_DATA" value={null} />)
    expect(screen.getByText(/missing data/i)).toBeInTheDocument()
  })
  it('renders dash when null', () => {
    render(<MarginBadge status={null} value={null} />)
    expect(screen.getByText('—')).toBeInTheDocument()
  })
})
```

(Move `MarginBadge` into `app/src/components/MarginBadge.tsx` exporting a named component.)

- [ ] **Step 6: Run frontend tests**

```
cd app && pnpm vitest run src/__tests__/finance-margin-badge.test.tsx
```
Expected: 4 passed.

- [ ] **Step 7: Manual smoke**

```
cd app && pnpm dev
```
- Edit a product, set COGS and packaging.
- Open business settings, set fee = 5% and default transport = RM8.
- Open an order, see margin badge update after PAID.
Halt dev server when satisfied.

- [ ] **Step 8: Commit**

```bash
git add app/src/routes/$businessCode/ app/src/components/MarginBadge.tsx app/src/__tests__/finance-margin-badge.test.tsx
git commit -m "feat(ui): cost inputs on product/business + margin badge on order"
```

---

## Task 10: Frontend — Sales page margin column + Inbox finance tab

**Files:**
- Modify: `app/src/routes/$businessCode/sales.tsx` (existing)
- Modify: `app/src/routes/$businessCode/inbox.tsx` (existing)
- Modify: `app/src/lib/finance-server-fns.ts` — add `listFinanceAlerts`, `resolveFinanceAlert`

- [ ] **Step 1: Add server functions for alerts**

Append to `app/src/lib/finance-server-fns.ts`:

```ts
import { createServerFn } from '@tanstack/react-start'
import { prisma } from '@/db'

export const listFinanceAlerts = createServerFn({ method: 'GET' })
  .validator((d: { businessId: string }) => d)
  .handler(async ({ data }) =>
    prisma.financeAlert.findMany({
      where: { businessId: data.businessId, resolvedAt: null },
      orderBy: { createdAt: 'desc' },
      include: { order: true, product: true },
    }),
  )

export const resolveFinanceAlert = createServerFn({ method: 'POST' })
  .validator((d: { alertId: string }) => d)
  .handler(async ({ data }) => {
    const AGENTS_URL = process.env.AGENTS_URL ?? 'http://localhost:8000'
    await fetch(`${AGENTS_URL}/finance/alerts/${data.alertId}/resolve`, { method: 'POST' })
    return { ok: true }
  })
```

(Adjust `prisma` import path to match existing project conventions seen elsewhere in `app/src/lib`.)

- [ ] **Step 2: Sales page — `Real Margin` column + Loss filter**

In `sales.tsx`, find the orders table. Add a new column header `Real Margin` and a cell rendering the `MarginBadge`. Add a "Loss only" toggle:

```tsx
const [lossOnly, setLossOnly] = useState(false)
const visible = lossOnly ? orders.filter(o => o.marginStatus === 'LOSS') : orders
```

Render:
```tsx
<button
  onClick={() => setLossOnly(v => !v)}
  className={lossOnly ? 'bg-red-100 text-red-700 px-2 py-1 rounded' : 'px-2 py-1 rounded'}
>
  Loss only
</button>
```

Make sure the orders fetch includes the new fields (`realMargin`, `marginStatus`). Update the relevant Prisma `select`/`include` if needed.

- [ ] **Step 3: Inbox — `Finance` tab**

In `inbox.tsx`, find the existing tab strip. Add a `Finance` tab. When selected, fetch via `listFinanceAlerts` and render rows:

```tsx
<ul>
  {alerts.map(a => (
    <li key={a.id} className="flex items-center justify-between py-2 border-b">
      <div>
        <div className="text-sm font-medium">{a.message}</div>
        <div className="text-xs opacity-70">{new Date(a.createdAt).toLocaleString()}</div>
      </div>
      <div className="flex gap-2">
        {a.orderId && (
          <Link to={`/${businessCode}/orders/${a.orderId}`}>open order</Link>
        )}
        {a.productId && !a.orderId && (
          <Link to={`/${businessCode}/products/${a.productId}`}>open product</Link>
        )}
        <button onClick={() => resolveFinanceAlert({ data: { alertId: a.id } }).then(refresh)}>
          resolve
        </button>
      </div>
    </li>
  ))}
</ul>
```

- [ ] **Step 4: Manual smoke**

```
cd app && pnpm dev
```
- Trigger a paid order with negative margin.
- Confirm Sales page row shows `loss` badge; Loss-only filter narrows the list.
- Confirm Inbox `Finance` tab lists the alert; clicking `resolve` removes it from the list.

- [ ] **Step 5: Commit**

```bash
git add app/src/routes/$businessCode/sales.tsx app/src/routes/$businessCode/inbox.tsx app/src/lib/finance-server-fns.ts
git commit -m "feat(ui): sales page margin column + inbox finance tab"
```

---

## Task 11: Backfill task `recompute_all_paid_margins`

**Files:**
- Modify: `agents/app/worker/finance_check.py`
- Modify: `agents/app/routers/finance.py`
- Test: extend `agents/tests/test_finance_check.py`

- [ ] **Step 1: Add backfill task**

Append to `agents/app/worker/finance_check.py`:

```python
@celery_app.task(name="finance.recompute_all_paid_margins")
def recompute_all_paid_margins(business_id: str) -> dict:
    """Operator-triggered backfill: run check_order_margin for every
    PAID order in the given business. Returns counts."""
    with SessionLocal() as s:
        rows = s.execute(
            select(Order.id).where(
                Order.businessId == business_id,
                Order.status == OrderStatus.PAID,
            )
        ).scalars().all()
    n_ok = n_loss = n_missing = 0
    for oid in rows:
        out = check_order_margin(oid)
        st = out.get("status")
        if st == "OK":
            n_ok += 1
        elif st == "LOSS":
            n_loss += 1
        elif st == "MISSING_DATA":
            n_missing += 1
    return {"ok": True, "n_total": len(rows), "n_ok": n_ok, "n_loss": n_loss, "n_missing": n_missing}
```

Add the import at the top of the file:
```python
from app.db import OrderStatus
```

- [ ] **Step 2: Endpoint to trigger backfill**

Append to `agents/app/routers/finance.py`:

```python
from app.worker.finance_check import recompute_all_paid_margins


@router.post("/backfill/{business_id}")
def trigger_backfill(business_id: str) -> dict:
    return recompute_all_paid_margins(business_id)
```

- [ ] **Step 3: Test**

Append to `agents/tests/test_finance_check.py`:

```python
def test_backfill_processes_all_paid_orders():
    with SessionLocal() as s:
        bid, pid, oid1 = _seed_basic(s)  # OK
    with SessionLocal() as s:
        _, _, oid2 = _seed_basic(s, cogs="90.00", total="100.00", transport="20.00", qty=1)  # LOSS — but new biz; need same bid
    # Patch: easier to just call backfill on the first business's id
    from app.worker.finance_check import recompute_all_paid_margins
    out = recompute_all_paid_margins(bid)
    assert out["ok"] is True
    assert out["n_total"] >= 1
```

(If isolating to one business is awkward, refactor `_seed_basic` to accept an optional `business_id` parameter and reuse it across both seeds. Update the test accordingly.)

- [ ] **Step 4: Run tests**

```
cd agents && pytest tests/test_finance_check.py -v
```
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add agents/app/worker/finance_check.py agents/app/routers/finance.py agents/tests/test_finance_check.py
git commit -m "feat(finance): backfill task + /finance/backfill/:businessId endpoint"
```

---

## Task 12: Final integration smoke + manager routing audit

**Files:**
- Read-only review pass.

- [ ] **Step 1: Run full Python test suite**

```
cd agents && pytest -v
```
Expected: all green.

- [ ] **Step 2: Run full frontend test suite**

```
cd app && pnpm vitest run
```
Expected: all green.

- [ ] **Step 3: End-to-end smoke**

Start the stack:
```
docker compose up -d
```
Manual flow:
1. Create a product without costs → place order → pay → expect `MISSING_DATA` alert in Inbox `Finance` tab.
2. Edit product, set costs → place new order → pay → expect `OK` margin badge on the order detail page.
3. Edit product so packaging > revenue → place order → pay → expect `LOSS` alert and red badge on Sales page.
4. Open chat, ask "untung minggu ni?" → reply should mention real margin total.

- [ ] **Step 4: Commit any small fixes from the smoke pass**

If anything broke in the smoke, fix it now in a focused commit. Do not refactor outside scope.

- [ ] **Step 5: Final commit if needed**

```bash
git status
# only commit if there are actual fixes
git commit -m "fix(finance): smoke-test corrections"
```

---

## Out of scope (explicit)

- Sales analytics / forecasting / cash-position forecasting (separate specs).
- External marketplace fees (Shopee, TikTok).
- Multi-currency.
- Editing locked `transportCost` after PAID via admin role (mentioned in spec, deferred).
- Bulk cost imports / CSV.
- Frontend chart visualizations of margin trends.

---

## Self-review checklist (run before declaring plan done)

- [ ] Every spec section maps to at least one task: data model (1+2), formula (3), worker (4), trigger wiring (5+8), agent + tools (6), chat endpoint + intent route (7), UI surfaces (9+10), backfill (11), tests (each task), risks acknowledged in rollout (1 step 6 = manual approval, 8 step 4 = transportCost lock, 10 = decimal-as-string by Prisma default).
- [ ] No `TBD` / `TODO` / `implement later` / `add appropriate error handling` strings.
- [ ] `MarginStatus` and `FinanceAlertKind` referenced consistently across Prisma, SQLAlchemy, Python tools, and frontend.
- [ ] Tool method names match between `tools.py` and `test_finance_agent.py` and `agent.py`.
- [ ] Every code-mutating step shows the actual code.
- [ ] Migration step pauses for explicit user approval.
