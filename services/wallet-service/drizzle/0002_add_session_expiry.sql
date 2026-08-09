-- RA-3/M1: a session id is now a bearer capability for the session routes, so
-- it must expire (7-day sliding window). Add expires_at NOT NULL.
--
-- Backfill any pre-existing rows to created_at + 7 days so the ADD COLUMN does
-- not fail on a non-empty table and no legacy session is immortal; new inserts
-- always set expires_at explicitly. (The spend_ledger table already exists from
-- 0001 — drizzle-kit re-emitted it here from a stale snapshot; that create is
-- dropped and only the session change is kept.)
ALTER TABLE "wallet_sessions"
  ADD COLUMN IF NOT EXISTS "expires_at" timestamp with time zone;
--> statement-breakpoint
UPDATE "wallet_sessions"
  SET "expires_at" = "created_at" + interval '7 days'
  WHERE "expires_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "wallet_sessions"
  ALTER COLUMN "expires_at" SET NOT NULL;
