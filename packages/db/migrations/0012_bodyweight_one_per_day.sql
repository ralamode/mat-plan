-- V1-24 PR 1d — one live weigh-in per (profile, day, slot), enforced by the database.
--
-- WHY: logBodyweight dedupes only on `client_id`, so two renders (two phones, a stale tab) can each
-- insert a weigh-in for the same day — Liam's 2026-09-30 had three. 1a closed the second-submit path
-- in the UI, 1c corrected the rows (APPLIED in prod, #206); this is the guard that makes it impossible.
-- Plan: docs/plans/v1-24-form-is-the-day.md → Decision 3, "1d is the index, and only the index", and
-- the 2026-09-30 amendment (slot-ready for V1-32).
--
-- THE KEY: (profile_id, activity_date, coalesce(context, 'morning')), live bodyweight rows only.
--   * Scoped to bodyweight: a check-in or a calisthenics bout may legitimately repeat on a day.
--   * `coalesce`, not `context`: no writer sets `context` until 1e, and NULLs are DISTINCT in a unique
--     index, so a bare `context` key would let every NULL row escape. Coalescing makes NULL and the
--     default slot the same slot — no backfill, and no window where a NULL row and a 'morning' row for
--     the same day both pass. V1-32's later slots ('evening', …) are distinct values of the same key.
--   * The literals are deliberate (drizzle-kit renders an interpolated const as `$1` in DDL).
--
-- NO APP CODE in this PR. The `ON CONFLICT` arbiter still names `uq_entries_client_id`; it moves to
-- this index in 1e, merged only after this migration's `migrate.yml` run is green — an arbiter naming
-- an index that does not exist fails EVERY insert, and migrate.yml races the Vercel deploy.
--
-- NOT CONCURRENTLY (Decision 2): drizzle-kit migrate wraps the file in a transaction, and the table is
-- small. `require-concurrent-index-creation` is excluded in .squawk.toml for that reason. No
-- IF NOT EXISTS: it would silently skip a same-named index with a different predicate.
--
-- CHECK FIRST, ATOMICALLY: the SHARE lock (the lock CREATE INDEX takes anyway, bounded by
-- lock_timeout) blocks inserts, so the count and the build judge the same rows. If a live duplicate
-- exists the DO block raises a message naming the runbook instead of a bare 23505.
-- If it fires: docs/runbooks.md → "If 1d's migration refuses" (add a correction, --apply, re-run
-- migrate.yml by workflow_dispatch; the app keeps logging because the arbiter has not moved).

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
    WHERE "deleted_at" IS NULL AND "metric_key" = 'bodyweight'
    GROUP BY "profile_id", "activity_date", coalesce("context", 'morning')
    HAVING count(*) > 1
  ) d;
  IF dup_groups > 0 THEN
    RAISE EXCEPTION 'V1-24 1d: % (profile, day, slot) group(s) hold more than one live weigh-in. Correct them first: docs/runbooks.md -> "If 1d''s migration refuses".', dup_groups;
  END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_entries_profile_day_bodyweight" ON "entries" USING btree ("profile_id","activity_date",coalesce("context", 'morning')) WHERE "entries"."deleted_at" is null and "entries"."metric_key" = 'bodyweight';
