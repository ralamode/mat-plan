-- Lane A tech-debt, PR 1 of 2: four CHECKs on populated tables, added NOT VALID (validated by a later
-- migration, in PR 2). Ledger: docs/tech-debt.md ("program_blocks.name has no length CHECK"; "A
-- logged quantity's CHECK admits NaN"). The maintainer chose two PRs for all four, and to include the
-- entries value (2026-11-16).
--
-- WHAT THIS ADDS
--   1. program_blocks_name_length_check: btrim >= 1 and <= 60 (PROGRAM_NAME_MAX), exactly
--      workouts_name_length_check's form, on every row.
--   2. ramp_targets_target_value_not_nan_check and 3. entry_set_quantities_value_num_not_nan_check:
--      `<> 'NaN'`, beside the existing `>= 0` checks, which admit NaN ('NaN' >= 0 is TRUE in Postgres).
--      numeric(8,3) already refuses Infinity, so NaN is the only special value.
--   4. entries_value_num_check: NULL, or >= 0 and not NaN. entries.value_num holds every reading an
--      entry logs (a weigh-in, a check-in, wake minutes, practice minutes), all non-negative today;
--      a signed metric must relax this first.
--
-- ⚠️ NOT VALID IS STILL ENFORCED: on every INSERT and on every UPDATE of an existing row, including a
-- soft delete or a restore, and on an INSERT ... ON CONFLICT DO NOTHING before the conflict check (the
-- seed). Only the scan of existing rows is skipped. So this merges only after a read-only production
-- read showed no existing row violating any of the four (the PR body records the result, never this
-- file: a migration is forward-only, so a fact written here is permanent). Every app writer already
-- produces accepted values (zod bounds and trims names, and refuses NaN and negatives).
--
-- LOCKS: each ADD CONSTRAINT takes ACCESS EXCLUSIVE, held to COMMIT (drizzle runs the file in one
-- transaction), with no scan. Ordered by hand, cold tables first: program_blocks, ramp_targets, then
-- the logging tables entries before entry_set_quantities (the strength writer's order), so the hot
-- tables are held for the shortest time and weeklyAdherenceRows (ramp_targets then entries) cannot
-- deadlock against it. No up-front LOCK TABLE, which would hold the hot tables longer. One known
-- reverse-order case: the set amend (updateStrengthSetById) reads entry_set_quantities before entries in
-- one UPDATE, so it can deadlock with this file; Postgres then aborts one side (the user's edit errors,
-- or this migration rolls back and stays pending: re-dispatch migrate.yml). lock_timeout is 2s, not 5s:
-- since 0028 every app query has a 15s statement_timeout that includes lock waits, and a read queued
-- behind program_blocks (every day page) must not reach it; four waits of 2s cap the hold near 8s. ⚠️ drizzle-kit
-- emits these alphabetically, so a regenerate loses this order: restore it by hand. PGlite does not
-- model locks; only review enforces this. Merge outside logging hours.
--
-- DEPLOY WINDOW: none. No column changes, so Drizzle's inserts are unaffected. Recovery if this
-- fails: re-dispatch migrate.yml (docs/runbooks.md); nothing is scanned, so data cannot fail it.
SET lock_timeout = '2s';--> statement-breakpoint
SET statement_timeout = '60s';--> statement-breakpoint
ALTER TABLE "program_blocks" ADD CONSTRAINT "program_blocks_name_length_check" CHECK (char_length(btrim("program_blocks"."name")) >= 1 and char_length("program_blocks"."name") <= 60) NOT VALID;--> statement-breakpoint
ALTER TABLE "ramp_targets" ADD CONSTRAINT "ramp_targets_target_value_not_nan_check" CHECK ("ramp_targets"."target_value" <> 'NaN') NOT VALID;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_value_num_check" CHECK ("entries"."value_num" is null or ("entries"."value_num" >= 0 and "entries"."value_num" <> 'NaN')) NOT VALID;--> statement-breakpoint
ALTER TABLE "entry_set_quantities" ADD CONSTRAINT "entry_set_quantities_value_num_not_nan_check" CHECK ("entry_set_quantities"."value_num" <> 'NaN') NOT VALID;
