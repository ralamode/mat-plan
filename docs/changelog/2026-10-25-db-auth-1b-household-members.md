- **2026-10-25** — **`household_members` lands, all dark: the table `AUTH-1` 1c's resolver will read,
  and the correction that is its only writer.** Nothing in the app touches it yet, which is precisely
  why it needed proofs now — 1c is a one-way door, and the constraints it will lean on have to be real
  before it leans on them.
  **Migration `0019`** (not `0015` — the parent plan said so and `TEN-2a` had taken it), hand-hardened
  with timeouts and four comments; **Squawk reports 0 issues** on the real generated file. `role` is
  `text` + a CHECK whose literals are **inlined**, because a CHECK cannot import a const — and bound
  back to `HOUSEHOLD_ROLES` by `assertCheckCoversConst`, the `sessions_day_role_check` pattern rather
  than `profiles_kind_check`, which is the one enum CHECK in the file with no such assertion. One
  partial unique index, not two: it is **both** the one-live-household-per-account rule and the
  resolver's access path.
  🔴 **The 19th per-household table, and `runbooks.md`'s delete order is hand-maintained.** The FK is
  `ON DELETE NO ACTION`, which is the runbook's stated safety property — so a live membership makes
  `DELETE FROM households` **abort the whole transaction** until step 4c names it. `PRIV-3` predicted
  exactly this class in writing. It is now **step 13**, with a `db:verify` proof that runs the order
  **both ways**: out of order it aborts and rolls back; in the runbook's order it commits and leaves
  nothing. ⚠️ That proof runs on an **isolated** household — the seeded one aborts on
  `profiles_…_fk` first, so it would have proved the runbook aborts _somewhere_ and said nothing about
  this table.
  **The mutation gate caught one of my own proofs being decorative.** The scope assertion claimed
  against household A — whose id is **1** — so a writer that ignored its `HouseholdScope` entirely and
  hardcoded `householdId: 1` passed, and `db:mutations` reported `db:verify` **stayed green**. It now
  claims against household B, the only id that distinguishes "used the capability" from "guessed the
  only household there is", with a `notEqual(B, A)` guarding the guard.
  **The claim correction is exercised, not just written** — five branches proved in `db:verify` by
  calling `run` directly (the `nullRoutineToFull` precedent): it refuses with no targets, refuses an
  id that is not Clerk-shaped, writes nothing without `--apply`, names the **full** Clerk id in the dry
  run so a human can check it against the dashboard, is an **idempotent no-op** on a re-run, and
  **refuses** when one Clerk id is pointed at a second household. That last pair is the case
  `INSERT … WHERE NOT EXISTS` could not have told apart, which is why the guard is a read-then-branch.
  ⚠️ **Targets come from the ENVIRONMENT, and `PRIV-3` converts this to `--household` / `--user`
  flags** when it lands that runner change (rule 8 assigns it there, "with its own plan"). Env was
  chosen because this shipped inside a migration PR — and because a command line is broadly visible via
  `ps` while a process's environment is readable only by its owner, and the value is a stable
  third-party account id for a named adult.
  🔴 **Clerk instances are SEPARATE user pools.** A development `user_…` is not the production id for
  the same Google account, so claiming production with a dev id lands the maintainer in **state C** at
  1c — locked out of their own household by the chunk meant to bind them to it. The correction asserts
  the id is Clerk-shaped and says this where it will be read.
  Two deliberate deviations from the parent plan, both because the code disagreed with it: the writer
  went into `writers/ownership.ts` rather than a new module, because `scope.test.ts` pins that as the
  **one** module allowed to unwrap a `HouseholdScope`; and `packages/shared/src/index.ts` needed no
  edit at all, because it is `export * from './enums'`, not the explicit list the plan described.
