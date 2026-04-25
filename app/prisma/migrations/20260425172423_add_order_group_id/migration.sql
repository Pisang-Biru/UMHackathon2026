-- AlterTable
ALTER TABLE "order" ADD COLUMN "groupId" TEXT;

-- CreateIndex
CREATE INDEX "order_groupId_idx" ON "order"("groupId");
