-- V1-24 3b-0 — one live wrestling practice per (profile, day), enforced by the database.
--
-- WHY: the practice ✓ dedupes only on `client_id`, so two phones can each log a practice for the same
-- day, and `practice_minutes` aggregates by SUM, so the day would read double. 3b-life turns the ✓ into
-- typed minutes and an amend; this is the guard that makes a second live row impossible first.
-- Plan: docs/plans/v1-24-3b-logs-in-place.md → "3b-0: what the slice settles" (Z1, Z2, Z7).
--
-- THE KEY: (profile_id, activity_date), live practice rows only. Practice has no slot, so unlike the
-- bodyweight index (0012) there is no coalesce(context). Live rows only, so a cleared day can be logged
-- again. The metric is a literal on purpose (drizzle-kit renders an interpolated const as `$1` in DDL).
-- A partial index over practice rows only; `entries` is small.
--
-- NOT CONCURRENTLY: drizzle-kit migrate wraps the file in a transaction, and the table is small
-- (`require-concurrent-index-creation` is excluded in .squawk.toml for that reason). No IF NOT EXISTS:
-- it would silently skip a same-named index with a different predicate.
--
-- CHECK FIRST, ATOMICALLY (0012's shape): the SHARE lock (the lock CREATE INDEX takes anyway, bounded
-- by lock_timeout) blocks inserts, so the count and the build judge the same rows. A live duplicate
-- raises a count-only message naming the runbook instead of a bare 23505, whose DETAIL would print a
-- profile id and a date into the public Actions log. If it fires: docs/runbooks.md → "If 3b-0's
-- migration refuses". The app keeps logging; nothing depends on this index existing.
--
-- DEPLOY ORDER (Z7): the new writer is safe before the index (its insert is target-less and names no
-- index). The index before the new writer is not: the old writer's ON CONFLICT (client_id) turns a
-- second same-day practice into a bare 23505. Merge when nobody is logging; a Vercel rollback past
-- this PR re-exposes that 23505.

SET lock_timeout = '5s';--> statement-breakpoint
SET statement_timeout = '60s';--> statement-breakpoint
LOCK TABLE "entries" IN SHARE MODE;--> statement-breakpoint
DO $$
DECLARE
  dup_groups integer;
BEGIN
  SELECT count(*) INTO dup_groups
  FROM (
    SELECT 1
    FROM "entries"
    WHERE "deleted_at" IS NULL AND "metric_key" = 'practice_minutes'
    GROUP BY "profile_id", "activity_date"
    HAVING count(*) > 1
  ) d;
  IF dup_groups > 0 THEN
    RAISE EXCEPTION 'V1-24 3b-0: % (profile, day) group(s) hold more than one live practice. Correct them first: docs/runbooks.md -> "If 3b-0''s migration refuses".', dup_groups;
  END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_entries_profile_day_practice" ON "entries" USING btree ("profile_id","activity_date") WHERE "entries"."deleted_at" is null and "entries"."metric_key" = 'practice_minutes';
