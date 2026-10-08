# `db:verify` mutation gate — proving the proofs can fail

`pnpm db:mutations` applies each patch in this directory, runs `db:verify`, asserts it **fails**, and
reverts. A patch that leaves `db:verify` green is a patch whose assertions were never proving
anything.

## Why this exists

TEN-1's household scoping is ~22 mechanical `verify.ts` call-site edits plus one predicate. The plan
([ten-1-household-scope.md](../../../../docs/plans/ten-1-household-scope.md) → **R5**) names the
risk this is for: _"one wrong household constant makes an assertion pass for the wrong reason, and
it is invisible in review."_ A boundary test that cannot fail is worse than none, because it is
counted as coverage.

So the mutations are committed as **patch files**, never as a runtime flag. A flag that can disable a
BOLA predicate must not exist in shipped `packages/db` source — the patch lives outside the build,
and the gate is what exercises it.

## The mutations

| Patch                              | What it breaks                                                                                                        | What must go red                                                                                                                                       |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `01-drop-household-conjunct.patch` | `inHousehold` stops reading the scope and emits a tautology — i.e. TEN-1 deleted, one line.                           | **18 assertions**: the picker (4), both scoped reads × both directions (4), all three writers × both directions (6), and the four no-side-effect ones. |
| `02-wrong-scope-everywhere.patch`  | `A_SCOPE` points at the household **next door** — the "dual" mutation: every call site threaded with the wrong scope. | The first **pre-existing** positive assertion that rides `A_SCOPE` (`V1-6b-2: one row per calisthenics target for the week`).                          |
| `03-undo-1c-predicates.patch`      | TEN-1 **1c undone**: all seven converted sites back to their pre-1c hand-written predicate.                           | A **1c** assertion, with every **1b** assertion still green — `TEN-1 1c: seedProgram refuses a target in another household` is the first to fail.      |

**Why all three.** Mutation 1 proves the predicate is load-bearing. Mutation 2 proves the _threading_
is: a pre-existing **negative** assertion ("refuses a non-done row") still returns `null` when
threaded with the wrong scope, so it stays green under mutation 1 and would silently stop proving
what its own message says. Only a wrong-scope mutation can see that, and it is caught because every
family of threaded negatives shares its block with a threaded **positive**.

Mutation 3 proves something neither can: that **1c's new matrix rows carry their own weight rather
than riding 1b's**. Under it the picker, `ownedEntryIds`, `weeklyAdherenceRows` and all three amends
stay green — mutation 1 would have reddened those first and hidden the question.

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

## Adding one

1. Make the one-line break by hand.
2. `git diff -- <paths> > packages/db/scripts/mutations/NN-<slug>.patch`
3. Revert, then run `pnpm db:mutations` and confirm the new patch reports `RED (expected)`.
4. Add a row above saying what must go red, in assertion messages rather than line numbers.

Patches are context-sensitive: an edit to the mutated lines means regenerating the patch, and the
gate fails loudly (`patch does not apply`) rather than passing vacuously.
