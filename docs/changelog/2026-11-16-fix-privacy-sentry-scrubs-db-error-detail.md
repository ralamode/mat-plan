# A rejected row never reaches Sentry: the scrubber drops a database error's `detail`

When Postgres rejects a row, its error's `detail` holds the row: `Failing row contains (…)` for a
CHECK or NOT NULL, `Key (…)=(…) already exists.` for a UNIQUE. FAM-1's migration 0023 adds the
repo's first length CHECKs on free text, so once a writer hits one, a program's or a workout's name
could ride a captured error to Sentry. The scrubber stripped only drizzle's `params`. Found in the
review of FAM-1 step 4a-i (#437), before any writer can hit those CHECKs.

- `apps/web/lib/sentry-scrub.ts`: every key named `detail` is dropped, wherever an error was
  normalized; every string is cut from a `DETAIL:` line on, and Postgres's detail sentences are cut
  where they sit inside a longer line. The SQLSTATE `code`, `constraint`, `table` and `column` stay.
- `apps/web/lib/sentry-scrub.test.ts`: four cases (keys, a printed `DETAIL:` line, a sentence inside a
  line with a `)` in the row, logs and breadcrumbs). All four fail on the parent commit.
- `docs/privacy/data-inventory.md`: the Sentry paragraph lists it.
