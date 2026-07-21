-- V1-1c — constraint relaxation to unblock metric-only / boolean check-in inserts
-- (spec.md §4). METADATA-ONLY: relaxes `entries.kind` to NULLABLE (the sole thing blocking a
-- kind-less check-in) and adds the discriminant invariant `activity_type_id IS NOT NULL` (V1-1b
-- backfilled it on every row). A kind=NULL row passes the retained entries_kind_check (NULL IN
-- (...) is NULL → pass) and entries_shape_check (NULL when value_num is set, which every seeded
-- numeric metric carries; a text-only metric would need V1-1d's drop). NO app-code change; the
-- legacy `kind`/`movement_name`
-- columns + the entries_kind_check/entries_shape_check guards are RETAINED (they still guard the
-- live dual-writer) — the physical DROP COLUMN + CHECK drops are the destructive contract V1-1d,
-- a later Squawk-gated deploy. Backward-compatible: no column/data is removed, so this is safe to
-- race the concurrent Vercel deploy (expand-before-deploy ordering).
-- Bound lock acquisition + statement runtime before any DDL (AGENTS.md DB rules).
-- drizzle-kit migrate wraps each file in a transaction, so these apply to it.
SET lock_timeout = '5s';--> statement-breakpoint
SET statement_timeout = '60s';--> statement-breakpoint
ALTER TABLE "entries" ALTER COLUMN "kind" DROP NOT NULL;--> statement-breakpoint
-- Enforce the discriminant invariant activity_type_id NOT NULL the expand-safe way (AGENTS.md):
-- CHECK ... NOT VALID (no full-table lock on ADD), then VALIDATE against the V1-1b-backfilled
-- rows (all of which already carry an activity_type_id). Mirrors V1-1a's household_id pattern;
-- the drizzle column stays nullable so the snapshot stays simple (the CHECK is absent from meta/).
ALTER TABLE "entries" ADD CONSTRAINT "entries_activity_type_id_not_null" CHECK ("activity_type_id" IS NOT NULL) NOT VALID;--> statement-breakpoint
ALTER TABLE "entries" VALIDATE CONSTRAINT "entries_activity_type_id_not_null";
