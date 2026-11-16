# The forward-only guard fails a migration journal out of time order

drizzle's migrator applies a migration only when its `_journal.json` `when` is later than the newest
one already applied (`created_at < folderMillis` in drizzle-orm's `pg-core/dialect.js`). A migration
generated before another one that merged first appends an entry with an older `when`, and
production skips it with no error. With two FAM-1 lanes now sharing the migration queue, that is a
live case. Found by lane A's step-3 review.

- `.github/workflows/ci.yml` → "Forward-only migration guard": every journal entry's `when` must be
  a number strictly greater than the one before it. The failure names the entry and says to regenerate on
  top of main.
- `.claude/skills/db-migration/SKILL.md`: states the rule and the fix.
