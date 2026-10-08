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

**Why both.** Mutation 1 proves the predicate is load-bearing. Mutation 2 proves the _threading_ is:
a pre-existing **negative** assertion ("refuses a non-done row") still returns `null` when threaded
with the wrong scope, so it stays green under mutation 1 and would silently stop proving what its
own message says. Only a wrong-scope mutation can see that, and it is caught because every family of
threaded negatives shares its block with a threaded **positive**.

## Adding one

1. Make the one-line break by hand.
2. `git diff -- <paths> > packages/db/scripts/mutations/NN-<slug>.patch`
3. Revert, then run `pnpm db:mutations` and confirm the new patch reports `RED (expected)`.
4. Add a row above saying what must go red, in assertion messages rather than line numbers.

Patches are context-sensitive: an edit to the mutated lines means regenerating the patch, and the
gate fails loudly (`patch does not apply`) rather than passing vacuously.
