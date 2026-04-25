-- CreateEnum
CREATE TYPE "AgentRunStatus" AS ENUM ('OK', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "agent_run" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "agentType" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "status" "AgentRunStatus" NOT NULL DEFAULT 'OK',
    "durationMs" INTEGER,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "cachedTokens" INTEGER,
    "costUsd" DECIMAL(10,6),
    "payload" JSONB NOT NULL DEFAULT '{}',
    "refTable" TEXT,
    "refId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_run_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_run_businessId_agentType_createdAt_idx" ON "agent_run"("businessId", "agentType", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "agent_run_refTable_refId_key" ON "agent_run"("refTable", "refId");

-- AddForeignKey
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
