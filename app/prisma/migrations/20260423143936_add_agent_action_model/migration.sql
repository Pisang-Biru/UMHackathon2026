/*
  Warnings:

  - Added the required column `userId` to the `business` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "AgentActionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'AUTO_SENT');

-- AlterTable
ALTER TABLE "business" ADD COLUMN     "userId" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "agent_action" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "customerMsg" TEXT NOT NULL,
    "draftReply" TEXT NOT NULL,
    "finalReply" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL,
    "reasoning" TEXT NOT NULL,
    "status" "AgentActionStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_action_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "business" ADD CONSTRAINT "business_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_action" ADD CONSTRAINT "agent_action_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
