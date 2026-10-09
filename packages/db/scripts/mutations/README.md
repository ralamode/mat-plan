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

| Patch                                     | What it breaks                                                                                                                                    | What must go red (the `.expect` file is the assertion the runner compares)                                                                                                                                                                                          |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `01-drop-household-conjunct.patch`        | `inHousehold` stops reading the scope and emits a tautology — i.e. TEN-1 deleted, one line.                                                       | **30 assertions**, after 1c: the picker (4), **six** scoped reads × both directions (12), **five** writers × both directions (10), and the four no-side-effect ones. ⚠️ Patches fail fast, so this count is what the patch _would_ redden, not what one run prints. |
| `02-wrong-scope-everywhere.patch`         | `A_SCOPE` points at the household **next door** — the "dual" mutation: every call site threaded with the wrong scope.                             | The first **pre-existing** positive assertion that rides `A_SCOPE` (`V1-6b-2: one row per calisthenics target for the week`).                                                                                                                                       |
| `03-undo-1c-predicates.patch`             | TEN-1 **1c undone**: all seven converted sites back to their pre-1c hand-written predicate.                                                       | **Every 1b assertion green, then a 1c one** — `TEN-1: programDayRows … household B cannot read A` is the first to fail. Since 1d the TEN-1 block runs 1b-then-1c, so one run shows both halves of the claim rather than leaving the 1b half to inspection.          |
| `04-slug-is-not-the-arbiter.patch`        | `findOrCreateMovement` stops deriving its slug through the shared `movementSlug`, so two spellings of one movement no longer converge on one row. | `TEN-1 1d READ — LEAKS: household B is handed household A's movement row`.                                                                                                                                                                                          |
| `05-correction-loses-its-household.patch` | `nullRoutineToFull`'s bulk read drops `inHousehold(scope)` — the correction's per-era guard, one line.                                            | `TEN-1 1d: …and EXACTLY those: every NULL-routine profile in household A, and none of household B's`.                                                                                                                                                               |

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

## Mutations 4 and 5 — why 1d's proofs need their own, and what 4 can and cannot be

**Mutation 5** is the ordinary case: the correction's household conjunct is one line, deleting it is a
real leak, and the assertion names it. Nothing subtle.

**Mutation 4 is the interesting one, and it is deliberately NOT "scope the catalog".** 1d's catalog
verdict asserts a **leak** — that `findOrCreateMovement` hands one household another household's row —
so the obvious mutation (make it not leak) is not a one-line break at all: it is `TEN-2`, a
`household_id` column plus partial unique indexes. And a leak assertion driven by the _same_ name on
both sides cannot be falsified by any change that keeps the signature, because the same input gives
the same slug.

So what mutation 4 breaks is the property the verdict actually **rests on**: that the shared
`movementSlug` derivation is the single **global arbiter**, which is why two households typing the same
movement differently (`'TEN-1 Catalog Probe'` vs `'  ten-1   CATALOG   probe '`) converge on one row.
Without it the proof would be measuring fixture ordering rather than the catalog's shape — the exact
vacuity `verify.ts` learned at V1-10 — and a later author "fixing" the catalog by not normalising, or
by matching on `name`, would leave the verdict green and wrong. The patch leaves the `movementSlug`
import unused for the duration, which `tsx` does not care about and the gate reverts anyway.

⚠️ **The `movements` structural assertion is its own tripwire and needs no patch.**
`TEN-1 1d: 'movements' has NO household_id column` goes red the day **TEN-2** adds one, which is
exactly when the verdict has to be re-taken.

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
