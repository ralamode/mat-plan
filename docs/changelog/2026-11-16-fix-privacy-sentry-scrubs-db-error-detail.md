# A rejected row never reaches Sentry: the scrubber drops a database error's `detail`

When Postgres rejects a row, its error's `detail` holds the row: `Failing row contains (…)` for a
CHECK or NOT NULL, `Key (…)=(…) already exists.` for a UNIQUE. FAM-1's migration 0023 adds the
repo's first length CHECKs on free text, so once a writer hits one, a program's or a workout's name
could ride a captured error to Sentry. The scrubber stripped only drizzle's `params`. Found in the
review of FAM-1 step 4a-i (#437), before any writer can hit those CHECKs.

- `apps/web/lib/sentry-scrub.ts`: every key named `detail` is dropped, wherever an error was
  normalized. Every string loses a printed error's `detail: '…'` entry (`util.inspect`, which is what
  `console.error(err)` writes), including the `'…' +` continuation lines a long value is split into; a
  psql-style `DETAIL:` line; and Postgres's two detail sentences. The SQLSTATE `code`, `constraint`,
  `table` and `column` stay.
- `apps/web/lib/sentry-scrub.test.ts`: six cases, including a pg-shaped `DatabaseError` printed with
  `util.format`, short and long. All fail on the parent commit; the long one also fails against this
  PR's first pattern, which stopped at the first continuation line (found by the review thread).
- `docs/privacy/data-inventory.md`: the Sentry paragraph lists it.
