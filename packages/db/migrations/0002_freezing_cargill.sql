-- V1-1b — generalize `entries` toward the full activity model (spec.md §4), additive
-- + backfill (expand). Adds the generalized FK columns (session_id / activity_type_id /
-- movement_id / metric_key) + value_text/context/scheme, backfills the v0 rows, and adds
-- the AT-MOST-ONE tagged-union CHECK. The legacy `kind`/`movement_name`/`entries_shape_check`
-- STAY (dropping them is the destructive contract V1-1c, a separate deploy). No data dropped.
-- Bound lock acquisition + statement runtime before any DDL (AGENTS.md DB rules).
-- drizzle-kit migrate wraps each file in a transaction, so these apply to it.
-- DELIBERATE DEVIATION (V1-1 decision 3, deferred CI/Squawk+Neon infra): the covering
-- indexes below are created inline / NON-concurrently — safe here because `entries` holds
-- only the handful of v0 seed/dev rows. The CONCURRENTLY + transaction-stripping runner
-- infra remains out of scope until the deferred CI-infra PR.
SET lock_timeout = '5s';--> statement-breakpoint
SET statement_timeout = '60s';--> statement-breakpoint
ALTER TABLE "entries" ADD COLUMN "session_id" bigint;--> statement-breakpoint
ALTER TABLE "entries" ADD COLUMN "activity_type_id" bigint;--> statement-breakpoint
ALTER TABLE "entries" ADD COLUMN "movement_id" bigint;--> statement-breakpoint
ALTER TABLE "entries" ADD COLUMN "metric_key" text;--> statement-breakpoint
ALTER TABLE "entries" ADD COLUMN "value_text" text;--> statement-breakpoint
ALTER TABLE "entries" ADD COLUMN "context" text;--> statement-breakpoint
ALTER TABLE "entries" ADD COLUMN "scheme" text;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_activity_type_id_activity_types_id_fk" FOREIGN KEY ("activity_type_id") REFERENCES "public"."activity_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_movement_id_movements_id_fk" FOREIGN KEY ("movement_id") REFERENCES "public"."movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_metric_key_metric_definitions_key_fk" FOREIGN KEY ("metric_key") REFERENCES "public"."metric_definitions"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_entries_session" ON "entries" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "idx_entries_activity_type" ON "entries" USING btree ("activity_type_id");--> statement-breakpoint
CREATE INDEX "idx_entries_movement" ON "entries" USING btree ("movement_id");--> statement-breakpoint
CREATE INDEX "idx_entries_metric_key" ON "entries" USING btree ("metric_key");--> statement-breakpoint
-- ── Hand-added minimal catalog seed + v0-entry backfill + tagged-union CHECK ─────────
-- Runs AFTER the generated DDL so it doesn't perturb the drizzle snapshot (meta/). All
-- steps are idempotent (ON CONFLICT DO NOTHING / WHERE … IS NULL guards) — re-run safe.
--
-- 1. Ensure the 'lb' unit exists — it's the FK target of the catalog rows below. Units are a
--    reference table seeded from @mat-plan/shared UNITS by db:seed; seed the one this backfill
--    depends on here too (ON CONFLICT DO NOTHING) so the migration is self-sufficient at
--    migrate time (same self-contained-dependency pattern as V1-1a's root household seed).
INSERT INTO "units" ("code", "label") VALUES ('lb', 'Pounds')
ON CONFLICT ("code") DO NOTHING;--> statement-breakpoint
-- 2. Seed the 3 minimal catalog rows the backfill + DAL reference (mirrors @mat-plan/shared
--    CATALOG_ACTIVITY_TYPE_SEED_ROWS / CATALOG_METRIC_DEFINITION_SEED_ROWS). The FULL catalog
--    lands at V1-2, which reuses these exact keys + public_ids (ON CONFLICT → no dup).
INSERT INTO "activity_types" ("public_id", "key", "label", "category", "input_shape", "default_unit") VALUES
	('019826b4-0000-7000-8000-000000000020', 'weigh_in', 'Weigh-in', 'measurement', 'single_metric', 'lb'),
	('019826b4-0000-7000-8000-000000000021', 'sc_lift', 'S&C lift', 'strength', 'set_list', NULL)
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
INSERT INTO "metric_definitions" ("public_id", "key", "label", "unit", "value_type", "aggregation") VALUES
	('019826b4-0000-7000-8000-000000000030', 'bodyweight', 'Bodyweight', 'lb', 'number', 'last')
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
-- 3. Create a movement per DISTINCT legacy strength movement_name. slug MUST match the DAL's
--    movementSlug() (@mat-plan/shared): lower + collapse whitespace runs to '_'. public_id uses
--    gen_random_uuid() (no in-DB UUIDv7 fn on PG16/Neon) for this one-time backfill; new movements
--    the DAL creates get a proper client UUIDv7 (newId()).
INSERT INTO "movements" ("public_id", "slug", "name", "is_bodyweight")
SELECT gen_random_uuid(),
	lower(regexp_replace(btrim("movement_name"), '\s+', '_', 'g')),
	"movement_name",
	false
FROM (
	SELECT DISTINCT "movement_name"
	FROM "entries"
	WHERE "kind" = 'strength' AND "movement_name" IS NOT NULL AND "deleted_at" IS NULL
) d
ON CONFLICT ("slug") DO NOTHING;--> statement-breakpoint
-- 4a. Backfill bodyweight rows → weigh_in activity + bodyweight metric (movement_id stays NULL).
UPDATE "entries" SET
	"activity_type_id" = (SELECT "id" FROM "activity_types" WHERE "key" = 'weigh_in'),
	"metric_key" = 'bodyweight'
WHERE "kind" = 'bodyweight' AND "activity_type_id" IS NULL;--> statement-breakpoint
-- 4b. Backfill strength rows → sc_lift activity + matched movement (metric_key stays NULL).
UPDATE "entries" AS e SET
	"activity_type_id" = (SELECT "id" FROM "activity_types" WHERE "key" = 'sc_lift'),
	"movement_id" = m."id"
FROM "movements" m
WHERE m."slug" = lower(regexp_replace(btrim(e."movement_name"), '\s+', '_', 'g'))
	AND e."kind" = 'strength' AND e."activity_type_id" IS NULL;--> statement-breakpoint
-- 5. Add the AT-MOST-ONE tagged-union CHECK (decision 1: boolean/timing activities reference
--    NEITHER a movement nor a metric, so it's at-most-one, not XOR). Expand-safe: NOT VALID skips
--    the full-table scan on ADD, then VALIDATE checks the just-backfilled rows (all conform).
ALTER TABLE "entries" ADD CONSTRAINT "entries_value_source_check" CHECK ("movement_id" IS NULL OR "metric_key" IS NULL) NOT VALID;--> statement-breakpoint
ALTER TABLE "entries" VALIDATE CONSTRAINT "entries_value_source_check";
