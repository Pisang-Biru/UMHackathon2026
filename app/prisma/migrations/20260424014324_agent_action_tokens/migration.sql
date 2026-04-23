-- AlterTable
ALTER TABLE "agent_action" ADD COLUMN "inputTokens" INTEGER,
ADD COLUMN "outputTokens" INTEGER,
ADD COLUMN "cachedTokens" INTEGER,
ADD COLUMN "costUsd" NUMERIC(10,6);
