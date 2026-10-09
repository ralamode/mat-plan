- **2026-10-08** — **TEN-1 1d: the guards, the corrections, and the catalog verdict — TEN-1 is DONE,
  and TEN-2 moves into Beta 0** ([plan](../plans/ten-1-household-scope.md) → "1d as built").

  **The structural guard is absolute.** `apps/web/lib/dal/scoped.test.ts` asserts two things:
  nothing in `lib/dal` reaches the database without resolving or being handed a `HouseholdScope`,
  and nothing builds its own ownership predicate. **Two exception families, each enumerated with its
  reason** — `catalog.ts`'s three global reference reads, and `household.ts` for `reportScopeMiss`'s
  existence-only probe — which is _smaller_ than the plan's own list and only possible because 1c
  left zero hand-written predicates. Three things it does differently from the plan, all stricter:
  the unit is a top-level declaration **exported or not** (a private helper reaching `db` unscoped is
  the same leak, and `export.ts` → `prescribedFor` is that shape); the `householdScopeForScript`
  sweep is **not** duplicated from 1b's `packages/db/src/scope.test.ts`, and the second assertion is
  the no-twelfth-copy rule instead; and a **dead-entry** assertion fails if an allowlisted function
  stops needing its entry, so TEN-2 has to delete `findOrCreateMovementId`'s rather than leave it
  standing. Its own docblock states the limit rather than leaving it to be discovered: a call-site
  guard cannot see SQL, so patch 01 leaves it green while the `db:verify` matrix goes red.

  **The corrections registry lost its last three predicates.** 1c's audit found three where the chunk
  table named one: `kbSwingsLoadRepsSwap`'s owner half, and both of `nullRoutineToFull`'s guards. The
  bulk read has **no `public_id` half** — a whole household's profiles — so it takes
  `inHousehold(scope)`, the same split `seedProgram` made in 1c. `liveHouseholdId` became
  `liveHouseholdScope`, so **no correction holds a raw `household_id`** and ADR 0006's capability rule
  holds in this script too. `kbSwings` is the one conversion that is not byte-identical: it gains the
  household conjunct, i.e. it is **strictly narrower**, which is the point — a correction cannot reach
  a family that never reported a problem. And `db:verify` now runs the registry entry's **own dry
  run** (writing nothing) to prove it returns exactly its household's NULL-routine profiles and none
  of the other household's, against an unscoped baseline asserted to reach them — the refusal-matrix
  row the plan asked for and 1b had not delivered.

  🔴 **The catalog verdict: it leaks, in both directions.** `movements` has **no `household_id`
  column at all**, so `findOrCreateMovementId` cannot be scoped — and a `scope` parameter accepted and
  ignored would be worse than the honest absence, which is why the core extracted here
  (`packages/db/src/writers/movement-catalog.ts`) takes none. That extraction is what makes the proof
  a proof: the app DAL is `server-only`, so `db:verify` could otherwise only have run a lookalike.
  Proved against a real database: one household typing a movement is handed another's row, inheriting
  its `name` / `is_bodyweight` / `unit_default` (a free-text name that slugs onto a catalog row comes
  back `is_bodyweight: true`, which this function can never write); whoever types a name **first**
  pins that slug permanently, and the **other** household's Today card, read under its own correct
  scope, renders that string and that declaration; and a session write the household seam **refuses**
  has already committed the caller's text — a cross-tenant **write** primitive surviving its own
  refusal. `pnpm db:mutations` is at five patches, all RED; the catalog one deliberately breaks the
  shared `movementSlug` derivation — the global arbiter the verdict rests on — because "scope the
  catalog" is TEN-2, not a one-line mutation.

  **So `beta-1.md`'s criterion fired as written and TEN-2 moves into Beta 0**, recorded as a
  recommendation with its evidence and explicitly the maintainer's call. **Its deadline is the invite,
  not AUTH-1's merge:** nothing can serve two households before AUTH-1 (the resolver throws on a
  second live household), and the window opens the moment household #2 exists — which is AUTH-1's
  "a new user gets a new, empty household" plus "invite family #1", inside Beta 0 rather than after
  it. **AUTH-1 is still next**; TEN-2's three PRs block the invite and run beside it.

  ⚠️ **Still consistent scoping, not authorization.** The gate is one shared code until AUTH-1, so
  anyone holding it can still reach any athlete in the one live household — closed by AUTH-1, and the
  most likely thing to over-read about TEN-1.
