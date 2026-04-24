-- AlterTable
ALTER TABLE "agent_action" ADD COLUMN "viewedAt" TIMESTAMP(3);
ALTER TABLE "agent_action" ADD COLUMN "agentType" TEXT NOT NULL DEFAULT 'support';
