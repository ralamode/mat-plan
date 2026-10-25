# `db:verify` mutation gate — proving the proofs can fail

`pnpm db:mutations` applies each patch in this directory, runs `db:verify`, asserts it **fails**, and
reverts. A patch that leaves `db:verify` green is a patch whose assertions were never proving
anything.

## Why this exists

TEN-1's household scoping is ~58 mechanical `verify.ts` call-site edits (~22 at 1b, the rest at 1c) plus one predicate. The plan
([ten-1-household-scope.md](../../../../docs/plans/ten-1-household-scope.md) → **R5**) names the
risk this is for: _"one wrong household constant makes an assertion pass for the wrong reason, and
it is invisible in review."_ A boundary test that cannot fail is worse than none, because it is
counted as coverage.

So the mutations are committed as **patch files**, never as a runtime flag. A flag that can disable a
BOLA predicate must not exist in shipped `packages/db` source — the patch lives outside the build,
and the gate is what exercises it.

## The mutations

| Patch                                     | What it breaks                                                                                                                                                      | What must go red (the `.expect` file is the assertion the runner compares)                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `01-drop-household-conjunct.patch`        | `inHousehold` stops reading the scope and emits a tautology — i.e. TEN-1 deleted, one line.                                                                         | **30 assertions**, after 1c: the picker (4), **six** scoped reads × both directions (12), **five** writers × both directions (10), and the four no-side-effect ones. ⚠️ Patches fail fast, so this count is what the patch _would_ redden, not what one run prints.                                                                                                                           |
| `02-wrong-scope-everywhere.patch`         | `A_SCOPE` points at the household **next door** — the "dual" mutation: every call site threaded with the wrong scope.                                               | The first **pre-existing** positive assertion that rides `A_SCOPE` (`V1-6b-2: one row per calisthenics target for the week`).                                                                                                                                                                                                                                                                 |
| `03-undo-1c-predicates.patch`             | TEN-1 **1c undone**: all seven converted sites back to their pre-1c hand-written predicate.                                                                         | **Every 1b assertion green, then a 1c one** — `TEN-1: programDayRows … household B cannot read A` is the first to fail. Since 1d the TEN-1 block runs 1b-then-1c, so one run shows both halves of the claim rather than leaving the 1b half to inspection.                                                                                                                                    |
| `04-slug-is-not-the-arbiter.patch`        | `findOrCreateMovement` stops deriving its slug through the shared `movementSlug`, so two spellings of one movement no longer converge on one row.                   | `TEN-2c SAME-HOUSEHOLD CONVERGENCE: two spellings of one movement are ONE row within a household` — **re-aimed at TEN-2c**, see below.                                                                                                                                                                                                                                                        |
| `05-correction-loses-its-household.patch` | `nullRoutineToFull`'s bulk read drops `inHousehold(scope)` — the correction's per-era guard, one line.                                                              | `TEN-1 1d: …and EXACTLY those: every NULL-routine profile in household A, and none of household B's`.                                                                                                                                                                                                                                                                                         |
| `06-two-households-share-a-slug.patch`    | `findOrCreateMovement`'s step 1 drops `movementIsGlobal()`, so the "global-first" lookup is UNSCOPED and household B's resolve returns household A's row. One line. | `TEN-2c READ — the denial window is CLOSED: household B typing a name household A typed first gets its OWN row, not A's` — the inverted READ assertion, which this reddens FIRST.                                                                                                                                                                                                             |
| `07-membership-ignores-soft-delete.patch` | `membershipHousehold` drops its `deleted_at IS NULL` conjunct, so a SOFT-DELETED membership still resolves. One line.                                               | `AUTH-1 1b: a soft-deleted membership resolves to null — 1c must land such a user in state C` — the assertion that keeps a revoked membership from silently still granting a household.                                                                                                                                                                                                       |
| `08-membership-ignores-its-scope.patch`   | `insertHouseholdMember` hardcodes `householdId: 1` instead of reading `scope.householdId`, so the capability is decorative. One line.                               | `AUTH-1 1b: membershipHousehold resolves the CLAIMED household, not merely the first one`. ⚠️ **This patch is why that assertion claims against household B.** The first version claimed against A — whose id IS 1 — so the mutation STAYED GREEN and the gate reported the proof vacuous. The id that distinguishes "used the capability" from "guessed the only household there is" is B's. |

**Why all three.** Mutation 1 proves the predicate is load-bearing. Mutation 2 proves the _threading_
is: a pre-existing **negative** assertion ("refuses a non-done row") still returns `null` when
threaded with the wrong scope, so it stays green under mutation 1 and would silently stop proving
what its own message says. Only a wrong-scope mutation can see that, and it is caught because every
family of threaded negatives shares its block with a threaded **positive**.

Mutation 3 proves something neither can: that **1c's new matrix rows carry their own weight rather
than riding 1b's** — mutation 1 would have reddened a 1b assertion first and hidden the question.

⚠️ **What the gate asserts, stated exactly.** Each patch has a sibling `<name>.expect` naming the
assertion that must be the **first** to fail, and the runner compares it — so "something went red" is
no longer enough, and two patches breaking the same proof are no longer indistinguishable.

**Since 1d the gate also shows patch 03's other half.** `db:verify` is fail-fast, so while a 1c
assertion sat ahead of 1b's the 1b rows below a 1c failure were **unreached, not green** — the claim
_"every 1b assertion stays green under 03"_ rested on the per-predicate runs in the plan rather than on
this gate. 1d reordered the TEN-1 block **1b-then-1c** (`ten1ReadMatrix` over two lists; the
`seedProgram` negative moved below the 1b write matrix), so one patch-03 run now passes through the
picker, both 1b reads and the whole 1b write matrix before failing on a 1c read. The four assertions
live in one function, so splitting the list did not duplicate them.

⚠️ **Each patch fails FAST, so one run shows one assertion.** That is a property of `db:verify`, not
of the patch: `node:assert` throws on the first failure. For mutation 3 the per-predicate results —
each of 1c's seven conversions broken alone, with the assertion that caught it — are recorded in
[the plan](../../../../docs/plans/ten-1-household-scope.md) → **"1c as built"**, because the gate
cannot enumerate them. A single-predicate revert that this patch no longer matches is still caught,
as `patch does not apply`.

⚠️ **One of mutation 3's seven sites is not provable here.** `logCheckinEntries` lives in the app DAL,
which `db:verify` cannot execute (`server-only` + the app's env), so its half of the patch is proved
by `lib/dal/entries.test.ts` under `pnpm test` instead. The patch still carries it, so the context
sensitivity above covers it; the gate's RED comes from the other six.

## Mutations 4, 5 and 6 — the `movements` seam, and what 4 can and cannot be

**Mutation 5** is the ordinary case: the correction's household conjunct is one line, deleting it is a
real leak, and the assertion names it. Nothing subtle.

**Mutation 4 is the interesting one, and it has been RE-AIMED TWICE without ever being retired.** 1d's
catalog verdict asserted a **leak** — that `findOrCreateMovement` hands one household another
household's row — so the obvious mutation (make it not leak) was not a one-line break at all: it was
`TEN-2`, a `household_id` column plus partial unique indexes. And a leak assertion driven by the
_same_ name on both sides cannot be falsified by any change that keeps the signature, because the same
input gives the same slug.

So what mutation 4 breaks is the property the verdict actually **rests on**: that the shared
`movementSlug` derivation is the arbiter, which is why two households typing the same movement
differently (`'TEN-1 Catalog Probe'` vs `'  ten-1   CATALOG   probe '`) converge on one row. Without it
the proof would be measuring fixture ordering rather than the catalog's shape — the exact vacuity
`verify.ts` learned at V1-10 — and a later author "fixing" the catalog by not normalising, or by
matching on `name`, would leave the verdict green and wrong. The patch leaves the `movementSlug`
import unused for the duration, which `tsx` does not care about and the gate reverts anyway.

🔴 **Patch `04` was REGENERATED at TEN-2b and RE-AIMED at TEN-2c, and the distinction matters.** At
TEN-2b its claim and its `.expect` were unchanged, but its only hunk used `findOrCreateMovement`'s
signature as context and 2b rewrote it — so the gate would have failed `patch does not apply` rather
than reporting RED, which is a _different_ failure. At TEN-2c the **patch** is untouched and the
**`.expect` moved**, for a reason that is the mirror image: 0017 inverted the cross-household READ
assertion into `assert.notEqual`, and **a `notEqual` cannot see a broken `movementSlug`** — two
different strings give two different rows either way, so the old `.expect` would have passed under the
very mutation it named. TEN-2c therefore added the assertion that is still true and still load-bearing,
`TEN-2c SAME-HOUSEHOLD CONVERGENCE` — two spellings of one movement are ONE row _within_ a household —
and pointed `04` at it. **Regenerated ≠ re-aimed ≠ rewritten ≠ retired.**

**Mutation 6 is the cross-household invariant, and it is the first mutation coverage the `movements`
seam has ever had.** Before TEN-2c, `movementInHousehold` / `movementIsGlobal` / `insertMovementOwnedBy`
were covered by no patch at all, and this is the PR where the two partial indexes became load-bearing.
The break is one line — step 1's lookup drops `movementIsGlobal()`, so the "global-first" read is
unscoped and household B is handed household A's row again, exactly the state 0017 exists to make
unreachable. ⚠️ **The obvious alternative break does not work**: reverting the step-3 insert to the
global namespace makes the re-read throw a plain `Error`, and the gate would report RED on the wrong
assertion.

⚠️ **The `movements` structural assertion was its own tripwire, and it has FIRED — three times now.**
It read `TEN-1 1d: 'movements' has NO household_id column` and was written to go red the day TEN-2 added
one. **TEN-2a was that day**, and it re-took the assertion rather than deleting it. **TEN-2b re-took a
second one the same way** — 2a's `household_id IS NOT NULL → 0` dark gate — inverting it to _every row
the resolver returned is curated-global or owned by the household that asked_. **TEN-2c inverted the
READ and WRITE/POISON assertions themselves**, plus the seed's absorb baseline and the fallback's price.
A tripwire that fires is supposed to be re-taken by the PR that fires it; that is why none needed a patch.

✅ **The verdict's DENIAL half is closed as of TEN-2c, so mutation 4 could no longer break it** — which
is the whole reason `04` was re-aimed instead of left pointing at a `notEqual`. What the verdict still
carries is a named **residual**: a pre-TEN-2b app-authored row left at `household_id IS NULL` is still
resolved by global-first for every household, and that closes at `TEN-2c-1`.

## Adding one

1. Make the one-line break by hand.
2. `git diff -- <paths> > packages/db/scripts/mutations/NN-<slug>.patch`
3. Write the sibling `NN-<slug>.expect` — **one line, the assertion message that must fail FIRST**, a
   substring of what `db:verify` prints. Without it the runner only proves "something went red", which
   is the vacuity this directory exists to catch pointed at itself.
4. Revert, then run `pnpm db:mutations` and confirm the new patch reports `RED (expected)` — and
   confirm it reports the assertion you named, not another one.
5. Add a row above saying what must go red, in assertion messages rather than line numbers.

Patches are context-sensitive: an edit to the mutated lines means regenerating the patch, and the
gate fails loudly (`patch does not apply`) rather than passing vacuously.
