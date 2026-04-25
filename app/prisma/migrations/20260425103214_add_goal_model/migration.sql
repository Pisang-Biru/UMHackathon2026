-- CreateEnum
CREATE TYPE "GoalStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "goal" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "status" "GoalStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "goal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "goal_businessId_deletedAt_status_createdAt_idx" ON "goal"("businessId", "deletedAt", "status", "createdAt");

-- AddForeignKey
ALTER TABLE "goal" ADD CONSTRAINT "goal_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

