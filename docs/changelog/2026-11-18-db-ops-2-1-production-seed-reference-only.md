# Production's seed writes reference data only, never a household or an athlete

`OPS-2` PR 1 ([plan](../plans/ops-2-split-the-seed.md)). `migrate.yml` seeds production on every push
to `main`, and the seed used to write the seed household and three fixture athletes there under
fixed, public ids, and re-create them after a deletion. Now:

- `seed()` is `seedReference` (always: units, slots, categories, equipment, muscles, activity types,
  metrics, the legacy movements) and `seedFixtures` (only with `SEED_FIXTURES`: the household, its
  athletes and the programs). Production never sets the flag.
- The seed's ramp-target expansion is deleted (it wrote nothing; the schedule was empty).
- The `units` upsert writes only missing or changed rows, so an unchanged unit is never row-locked, and
  the seed script sets a lock and a statement timeout.
- `migrate.yml` reads production's string from a renamed secret, `PROD_DATABASE_URL_UNPOOLED`, and
  fails, rather than skipping, when it is absent. Once the old secret is deleted, a re-run of an old
  run writes nothing.
- The runbook keeps refusing an ordinary deletion of a seed-id household or athlete: `CAT-3`'s fresh
  start removes the seeded household. The notice says so.

`db:verify`'s new `verify/seed.ts` proves it, and mutations `326`–`329` prove the proofs can fail.
