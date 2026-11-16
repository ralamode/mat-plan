-- FAM-1 step 3 — every item gets a tracking type, the built-ins are typed once, and a session may be
-- a template `workout`. Plan: docs/plans/fam-1-family-program.md §2, §3 (row "3"), D1, D6, D25.
--
-- WHAT THIS ADDS
--   1. movements.tracking_type text NOT NULL DEFAULT 'weight_reps' + movements_tracking_type_check,
--      pinned to shared TRACKING_TYPES by db:verify. A constant default is metadata-only (PG 11+):
--      no table rewrite.
--   2. A ONE-TIME typing of the built-in items, by slug (D25: a first typing, not a retype). Guarded
--      three ways, so a re-run changes nothing: only global rows (household_id IS NULL), only rows
--      still at the default, only the slugs listed. A household's own row with a seeded slug is never
--      touched. Every built-in not listed is a loaded lift and keeps the default. One VALUES list, so
--      the slugs and their types cannot drift apart inside this file; db:verify runs THIS statement,
--      read from this file, and proves it equals MOVEMENT_SEED_ROWS' trackingType.
--   3. sessions_session_type_check re-created to admit 'workout' (D6). Widening only: every existing
--      row passes.
--
-- ORDER ON A FRESH DATABASE: the UPDATE meets an empty table and the seed (which runs after migrate
-- in migrate.yml and db:verify) inserts the built-ins already typed. On production the UPDATE types
-- them and the seed's ON CONFLICT DO NOTHING leaves them alone.
--
-- LOCKS: both tables are small (the seeded catalog of 35 global items plus each household's own; one
-- sessions row per logged strength day). Production row counts were NOT measured for this PR; nobody
-- logs in the app yet (the milestone's rule). Both tables are locked up front, movements then sessions,
-- the order the strength writer and the export already take them in, so no statement below upgrades a
-- lock mid-file. The CHECKs take the small-table route: a NOT VALID → VALIDATE split in one file is
-- one transaction and buys nothing (0013's header; AGENTS.md).
--
-- DEPLOY WINDOW: until this file applies, new code's `insert into movements` names tracking_type and
-- fails 42703 (findOrCreateMovement → insertMovementOwnedBy; the seed). No movement read uses a bare
-- select. Merge when nobody is logging; recovery is to re-dispatch migrate.yml (docs/runbooks.md).
SET lock_timeout = '5s';--> statement-breakpoint
SET statement_timeout = '60s';--> statement-breakpoint
LOCK TABLE "movements", "sessions" IN ACCESS EXCLUSIVE MODE;--> statement-breakpoint
ALTER TABLE "movements" ADD COLUMN IF NOT EXISTS "tracking_type" text DEFAULT 'weight_reps' NOT NULL;--> statement-breakpoint
-- Small table, locked above; every row holds the default, which the CHECK accepts.
-- squawk-ignore constraint-missing-not-valid
ALTER TABLE "movements" ADD CONSTRAINT "movements_tracking_type_check" CHECK ("movements"."tracking_type" in ('check', 'count', 'reps', 'weight_reps', 'duration', 'time_sets', 'distance'));--> statement-breakpoint
-- fam-1-3:typing (db:verify reads the statement after this marker; keep it one statement)
UPDATE "movements" AS m SET "tracking_type" = v.tracking_type, "updated_at" = now() FROM (VALUES ('box_jump', 'reps'), ('pull-up', 'reps'), ('nordic_ham_curl', 'reps'), ('pallof_press', 'reps'), ('dips', 'reps'), ('med-ball_slam', 'reps'), ('ab_rollout', 'reps'), ('push-ups', 'reps'), ('leg_raises', 'reps'), ('v-sit_crunches', 'reps'), ('inverted_rows', 'reps'), ('single-leg_hip_thrusts', 'reps'), ('hollow-body_hold', 'time_sets'), ('broad_jump', 'distance')) AS v(slug, tracking_type) WHERE m.slug = v.slug AND m.household_id IS NULL AND m.tracking_type = 'weight_reps';--> statement-breakpoint
ALTER TABLE "sessions" DROP CONSTRAINT "sessions_session_type_check";--> statement-breakpoint
-- Small table, locked above; a strict superset of the CHECK just dropped, so every row passes.
-- squawk-ignore constraint-missing-not-valid
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_session_type_check" CHECK ("sessions"."session_type" in ('strength', 'conditioning', 'skill', 'push', 'pull', 'legs', 'core', 'workout'));
