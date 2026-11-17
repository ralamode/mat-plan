-- Lane A tech-debt, PR 2 of 2: VALIDATE the four CHECKs 0029 added NOT VALID. Plan:
-- docs/plans/tdebt-validate-name-and-nan-checks.md. Ledger entries closed in the same PR
-- ("program_blocks.name has no length CHECK"; "A logged quantity's CHECK admits NaN").
--
-- WHAT IT DOES: scans the existing rows of each table once and, if every row passes, marks the
-- constraint validated (pg_constraint.convalidated = true). No data changes, no new constraint, no
-- schema.ts model change (drizzle-kit does not model NOT VALID; the CHECKs are in the snapshot since 0029).
-- Since 0029, every INSERT and UPDATE was already checked, so only rows older than 0029 can fail here.
--
-- MERGE CONDITION: a read-only production read, run after 0029 applied, showed no row violating any of
-- the four (the PR body records it; never this file: a migration is forward-only, so a fact written
-- here is permanent).
--
-- LOCKS: VALIDATE CONSTRAINT on a CHECK takes SHARE UPDATE EXCLUSIVE, held to COMMIT (drizzle runs the
-- pending set in one transaction). It does not conflict with reads or with INSERT/UPDATE/DELETE, so app
-- traffic neither waits on it nor queues behind it, and the statement order cannot deadlock with the
-- app. It conflicts with autovacuum, ANALYZE and other DDL: autovacuum is the realistic lock_timeout
-- (55P03) source; a non-wraparound autovacuum is cancelled for a waiting lock after about
-- deadlock_timeout (1s), so 5s (as 0016 and 0018, the VALIDATE precedents) leaves it room.
--
-- RE-RUN SAFETY: VALIDATE on an already-validated constraint is a no-op.
--
-- IF IT FAILS: no partial state (one transaction); the migration stays pending and takes db:seed with
-- it (docs/runbooks.md, "A migration failed in prod"). A 23514 names the constraint and table,
-- never the row: an existing row violates it (the plan's merge-condition read finds it).
-- ⚠️ Hiding that row does not clear it: a soft delete is an UPDATE, and the CHECK refuses it
-- (db:verify proves this). The guarded correction must repair the value in the same UPDATE (a name
-- shortened or replaced to 1..60 non-blank characters; entries.value_num set to a valid number or
-- NULL; a NaN quantity or ramp target set to a valid number, both columns being NOT NULL), then
-- re-dispatch migrate.yml.
-- A 55P03 needs nothing but the re-run. No request-path statement depends on this file: the app keeps
-- serving throughout.
SET lock_timeout = '5s';--> statement-breakpoint
SET statement_timeout = '60s';--> statement-breakpoint
ALTER TABLE "program_blocks" VALIDATE CONSTRAINT "program_blocks_name_length_check";--> statement-breakpoint
ALTER TABLE "ramp_targets" VALIDATE CONSTRAINT "ramp_targets_target_value_not_nan_check";--> statement-breakpoint
ALTER TABLE "entries" VALIDATE CONSTRAINT "entries_value_num_check";--> statement-breakpoint
ALTER TABLE "entry_set_quantities" VALIDATE CONSTRAINT "entry_set_quantities_value_num_not_nan_check";
