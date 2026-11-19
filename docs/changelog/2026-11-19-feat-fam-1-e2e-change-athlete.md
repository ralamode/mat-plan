# The test seed gains Athlete Four, with both superset workouts every day of the week

For lane C's Change e2e (a follow-up from #607). Test and preview databases only: production's seed
writes none of it.

- Athlete Four (a role name, `SEED_PROFILE_4_PUBLIC_ID`) is on one test program, `Test – Change e2e`,
  from its own fixed past day: Heavy A ("Morning") then Heavy B ("Evening") on all seven days. So today
  and yesterday always hold both workouts, whatever day and time zone the suite runs in.
- The fixture world and the test program share one seeding function, so every skip and the
  idempotency hold for both. The test program is made only with Athlete Four live and active.
- A household at its item cap no longer makes the seed throw; it is skipped like any state a person
  can make.
- Board guest edits: `seed-ids.ts`, `seed.ts`, `packages/db/src/index.ts`, `verify.ts`,
  `verify/schema.ts`, and `write-path.md`'s row.
