---
id: PROF-1 b-s
pr: pending
---

## Two corrections that shipped inside a mutation patch instead of the source

`PROF-1 b-s` (#353) accepted two review findings and recorded both as incorporated: the
`membershipHousehold` docblock's _"no TOCTOU window between the role read and the write"_ claim was
to be replaced with the narrower property that is actually true, and `Membership.householdId` was to
type from the row (`HouseholdRow['id']`) like its `HouseholdScope` sibling. Neither reached
`packages/db/src/queries/household-membership.ts`. Both edits exist in the `+` lines of
`scripts/mutations/15-role-not-from-this-row.patch`, because the patch was generated with
`git diff` while those edits were still uncommitted in the same file, and the `git checkout --` that
followed reverted them. Every gate stayed green — the patch applies, `db:verify` reddens on its
named assertion — so nothing caught it; a second-pass reviewer did, by diffing the commits against
the review log.

**Why it mattered rather than being tidy-up.** The module left carrying the false claim is the one
every corrected document now calls _"the ONLY authority"_ for the role, and
`apps/web/lib/dal/household.ts` points a reader at that docblock for a correction that was not there.

Patch `15` now carries only the `.map` line it is about. The mechanism is in
[lessons.md](../lessons.md) → Git / commits: commit the real edits **before** generating a patch.

## Two guard shapes that the new guards did not cover

The same review found both new `scope.test.ts` guards titled more broadly than they checked.
`ROLE_PARAM_DEFAULTED` missed a **destructured** default (`{ householdId, role = 'owner' }`) while
claiming "no constructor DEFAULTS its role parameter"; the cast guard missed the angle-bracket
assertion `<OwnerScope>scope` — legal in a `.ts` file, forbidden by no ESLint rule here — while
claiming "narrowing is the only way in". Both alternatives are added and **probed red**. Neither was
a hole anyone was near; both were a claim wider than its check, which is the shape this repo keeps
finding.

⚠️ One more from the same review is **not** in this PR: the review log says **seven** documents
carried the old framing and `git grep` at the reviewed commit finds **six**. That edit is in
`docs/plans/prof-1-athletes.md`, which `PROF-1 b`'s plan refresh is already rewriting — two PRs
touching one file is the collision [parallel-work](../parallel-work.md) gate 1 exists to catch, so
it rides with the refresh.
