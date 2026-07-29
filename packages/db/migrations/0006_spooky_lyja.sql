-- V1-18 (PR 1a) — the per-kid routine config: `profiles.routine_config`, a nullable JSONB holding the
-- ordered activity keys the kid works through (weigh-in pinned first, then their sequence). NULL → the
-- app resolves the default routine (ships dark), so no backfill. Metadata-only ADD COLUMN: nullable, no
-- default, no index (nothing queries INTO it — a knowing exception to the typed-columns rule, see
-- docs/tech-debt.md + the promotion trigger). No table rewrite, no NOT NULL, Squawk-green. No app code
-- reads the column here — the DAL/render land in PR 1b, so there is no deploy-order window.
--
-- Bound lock acquisition + statement runtime before the DDL (AGENTS.md DB rules). drizzle-kit migrate
-- wraps each file in a transaction, so these apply to it. IF NOT EXISTS makes the ADD re-run-safe.
SET lock_timeout = '5s';--> statement-breakpoint
SET statement_timeout = '60s';--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "routine_config" jsonb;
