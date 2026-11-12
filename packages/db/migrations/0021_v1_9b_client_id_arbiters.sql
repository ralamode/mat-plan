-- V1-9b B0 — a `client_id` stops being freed by a hide: five partial UNIQUEs become plain UNIQUEs.
--
-- WHY: every one of these five indexes is `WHERE deleted_at IS NULL`, so a soft-deleted row stops
-- being an `ON CONFLICT` target and a replay of the SAME write inserts a TWIN
-- (docs/decisions/0008-deletion.md:127, decision 3.4). V1-9b is the milestone that makes hiding a
-- row a real, reachable action, which turns that from latent into live: a phone that logged a set,
-- went offline, and replays after the row was hidden would create a second set rather than being
-- recognised as the write it already made. `uq_profiles_client_id` (PROF-1 a-0) was built
-- non-partial for exactly this reason; this applies that precedent to the five older arbiters.
-- Plan: docs/plans/v1-9b-delete-and-restore.md -> B0.
--
-- WHAT IT COSTS, stated plainly: a `client_id` can never be reused for a different row, even after
-- the first is purged. That is the point. A slot (an ordinal, a day, a position) is what a hide
-- should free; an offline identity is not.
--
-- THE LOCK (one statement, up front, at the level the DDL needs): DROP INDEX takes
-- ACCESS EXCLUSIVE, so taking it here rather than per-statement avoids a mid-file lock upgrade and
-- the deadlock risk that comes with one. ⚠️ ACCESS EXCLUSIVE blocks READS as well as writes on all
-- five tables -- Today's page included -- for the duration of the five index builds. At prod's size
-- (51 entries, spec:147) that is well under a second. If the lock cannot be taken, `lock_timeout`
-- gives up after 5s having changed nothing.
--
-- CHECK FIRST, ATOMICALLY, and this check is NOT the same as 0012's: the new index is non-partial,
-- so a hidden/hidden or hidden/live PAIR collides too -- not just two live rows. The count
-- therefore ignores `deleted_at` entirely. Under the lock above, the count and the builds judge the
-- same rows. A refusal names the table and the runbook instead of a bare 23505.
-- If it fires: docs/runbooks.md -> "A pending migration wedges prod and the seed with it".
-- ⚠️ `migrate.yml` runs the seed in the same job, so a refused B0 freezes EVERY later migration
-- until the duplicate is corrected and the run re-dispatched.
--
-- NOT CONCURRENTLY: drizzle-kit migrate wraps the file in a transaction, so CONCURRENTLY is
-- impossible here. `require-concurrent-index-creation` is excluded in .squawk.toml for that reason.
-- No IF EXISTS / IF NOT EXISTS: a guard would silently skip a same-named index carrying the WRONG
-- predicate, which is precisely the state this migration exists to leave behind (0012's reasoning).

SET lock_timeout = '5s';--> statement-breakpoint
SET statement_timeout = '60s';--> statement-breakpoint
LOCK TABLE "sessions", "supersets", "entries", "entry_sets", "entry_set_quantities" IN ACCESS EXCLUSIVE MODE;--> statement-breakpoint
DO $$
DECLARE
  tbl text;
  dups integer;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['sessions', 'supersets', 'entries', 'entry_sets', 'entry_set_quantities']
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM (SELECT 1 FROM %I GROUP BY client_id HAVING count(*) > 1) d', tbl
    ) INTO dups;
    IF dups > 0 THEN
      RAISE EXCEPTION 'V1-9b B0: %I holds % client_id value(s) used by more than one row (hidden rows included). A non-partial UNIQUE cannot be built over them. Correct them first with a predicate-selected db:correct correction: docs/runbooks.md -> "A pending migration wedges prod and the seed with it".', tbl, dups;
    END IF;
  END LOOP;
END $$;--> statement-breakpoint
-- The five DROPs below are each preceded by a `squawk-ignore` for
-- `require-concurrent-index-deletion`, for the same reason `.squawk.toml` already excludes its
-- CREATION twin: `DROP INDEX CONCURRENTLY` cannot run inside a transaction, and drizzle wraps every
-- migration file in one. The rule is unsatisfiable here, not ignored. ⚠️ Suppressed per statement
-- rather than added to `excluded_rules`, so the gate keeps firing for every other migration --
-- including one written after a transaction-stripping runner exists, where CONCURRENTLY WOULD be
-- possible and the warning would be right. The ACCESS EXCLUSIVE lock the rule warns about is taken
-- deliberately above, and its cost is measured in this file's header.
-- squawk-ignore require-concurrent-index-deletion
DROP INDEX "uq_entries_client_id";--> statement-breakpoint
-- squawk-ignore require-concurrent-index-deletion
DROP INDEX "uq_entry_set_quantities_client_id";--> statement-breakpoint
-- squawk-ignore require-concurrent-index-deletion
DROP INDEX "uq_entry_sets_client_id";--> statement-breakpoint
-- squawk-ignore require-concurrent-index-deletion
DROP INDEX "uq_sessions_client_id";--> statement-breakpoint
-- squawk-ignore require-concurrent-index-deletion
DROP INDEX "uq_supersets_client_id";--> statement-breakpoint
CREATE UNIQUE INDEX "uq_entries_client_id" ON "entries" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_entry_set_quantities_client_id" ON "entry_set_quantities" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_entry_sets_client_id" ON "entry_sets" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sessions_client_id" ON "sessions" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_supersets_client_id" ON "supersets" USING btree ("client_id");
