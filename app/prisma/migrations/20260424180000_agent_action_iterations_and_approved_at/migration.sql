-- Baseline: columns added out-of-band; recorded here so migrate dev sees a clean history.
ALTER TABLE "agent_action"
  ADD COLUMN IF NOT EXISTS "iterations" JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMPTZ;
