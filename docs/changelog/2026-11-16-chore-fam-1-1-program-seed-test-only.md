- **2026-11-16** — **FAM-1 step 1: production is no longer re-seeded with the program**
  ([plan](../plans/fam-1-family-program.md) D10, §5 lane A row "1"). `seed(db, { fixtures })` now
  takes a required option. With `fixtures: true` it writes `PROGRAM_SEED` and calls lane P's
  `seedProgramFixtures` (a no-op until step 6c); with `false`, which is how `migrate.yml` seeds
  production, it writes neither, and program rows a database already holds stay. `db:seed` sets
  `fixtures` from `SEED_FIXTURES=1` and refuses the flag unless the connection string is local or
  names the preview database, so a run by hand against production cannot seed fixtures even with
  `EXPECTED_DB_ENV` unset. CI's smoke, the preview migration and the local harnesses set the flag; a
  test pins that no other workflow names it. `db:verify` proves the seed writes no program with
  `fixtures: false` and all of `PROGRAM_SEED` with `true`. The seed household and its profiles are
  still seeded everywhere; moving them is `OPS-2`'s.
