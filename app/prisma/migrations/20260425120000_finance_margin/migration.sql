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
