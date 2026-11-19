- **2026-11-19** — **PRIV-3 2a: the household erasure core, with its pre-flights and proofs.**
  `packages/db/src/erasure/erase.ts` adds `eraseHousehold(exec, scope: OwnerScope, { apply })`. It
  has two modes:
  - **Dry run:** counts the household's rows in every graph table, runs pre-flights (a)–(h) and lists
    its sign-ins, each marked if it is live in another household.
  - **Apply:** one transaction. It sets timeouts and reads the restore point. It locks the
    household's parent rows `FOR UPDATE` (programs first, then athletes, the program writers' order,
    then both again after the household row), re-runs the pre-flights, deletes in graph order, and
    checks each `RETURNING` against its count and every returned household id against the target's.

  Given an open transaction, the core runs as a savepoint and never commits it, so a caller can roll
  the erasure back. Nothing calls it yet: `CAT-3` R0 and `PRIV-3` 2b do. The pre-flight joins move to
  `src/erasure/preflight.ts`, one per shape, and `db:verify`'s censuses and step 5's athlete checks
  read the same joins. `db:verify` gains P3 (H erased, hidden rows too; K, the reference tables and
  the global movements unchanged), P4 (each pre-flight refuses naming itself) and P5 (a hidden
  household is erased), with the lock order and mode pinned, and P3b (a delete that removes fewer
  rows than it counted aborts). Mutations `279`–`289` and `330`–`332` are new; `07`, `09`, `201`,
  `205`, `262` and `269` are regenerated. "Live in another household" uses the resolver's own rule,
  now one shared predicate (`isLiveMembership`), and the transaction timeouts are one helper. The old proof (5) in `verify.ts` is retired, since P2 and P3
  cover it. No migration, and no change to what is stored.
