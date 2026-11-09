import { describe, expect, it } from 'vitest';

import {
  ACTION_SCOPE,
  MUTATING_ACTIONS,
  excludedActionNames,
  type ExcludedEntry,
  type MatrixEntry,
} from './mutating-actions';

/**
 * 🔴 **These tests exist because the claim they pin shipped FALSE.**
 *
 * WP-1 (#345) stated in five places that "an entry cannot carry both `scope` and `excluded` — it is
 * a type error". It was not: TypeScript's excess-property check on a non-discriminated union only
 * requires each property to exist in *some* member, so an entry carrying both compiled, was
 * classified as excluded, and silently got no binding and no refusal matrix.
 *
 * 🔴 **The compile half IS pinnable, and the pin is below — an earlier draft of this file claimed it
 * was not.** That draft said a `@ts-expect-error` "would pass whether or not the union is
 * exclusive, since the directive only requires *an* error". **Probed, and false:** against the
 * pre-fix union the exact literal that used to compile produces no error at all, so the directive
 * goes unused and `tsc` fails with **TS2578**; against the post-fix union it passes. The directive
 * distinguishes them precisely. ⚠️ Writing that unprobed reason into a PR whose whole subject was an
 * unprobed claim is the same mistake one level up, which is why the retraction stays here.
 *
 * **Where each half is enforced:** the exclusivity pin below is held by **`pnpm typecheck`** — this
 * file is inside `apps/web`'s tsconfig — **not** by `vitest run`, so a green test run is not the
 * proof. The runtime `describe` is a second tripwire for the case where someone loosens the types
 * *and* writes a bad entry.
 */

/**
 * 🔴 **THE EXCLUSIVITY PIN.** Each `@ts-expect-error` below asserts the literal beneath it does NOT
 * satisfy the union. If someone deletes `MatrixEntry.excluded?: never` or `ExcludedEntry.scope?:
 * never`, these literals start compiling, the directives become unused, and **`tsc` fails with
 * TS2578** — the probe, made permanent. Verified RED against the pre-fix union and green against
 * this one.
 */
const _exclusivityPin = {
  // @ts-expect-error — an entry may not carry BOTH a scope and an exclusion (MatrixEntry.excluded)
  both: { refusal: 'x', scope: ACTION_SCOPE.profile, excluded: { reason: 'r', provenBy: 'p' } },
  // @ts-expect-error — nor an exclusion beside a scope without a refusal (ExcludedEntry.scope)
  half: { scope: ACTION_SCOPE.profile, excluded: { reason: 'r', provenBy: 'p' } },
} as const satisfies Record<string, MatrixEntry | ExcludedEntry>;
void _exclusivityPin;

/** The two shapes that MUST still be accepted — so the pin above cannot pass by rejecting everything. */
const _acceptedShapes = {
  matrix: { refusal: 'x', scope: ACTION_SCOPE.profile },
  excluded: { excluded: { reason: 'r', provenBy: 'p' } },
} as const satisfies Record<string, MatrixEntry | ExcludedEntry>;
void _acceptedShapes;

describe('the action registry is one kind of entry or the other', () => {
  it('no entry carries both a scope and an exclusion', () => {
    const both = Object.entries(MUTATING_ACTIONS)
      .filter(([, v]) => 'scope' in v && 'excluded' in v)
      .map(([k]) => k);
    expect(both).toEqual([]);
  });

  it('every entry carries exactly one of them', () => {
    const neither = Object.entries(MUTATING_ACTIONS)
      .filter(([, v]) => !('scope' in v) && !('excluded' in v))
      .map(([k]) => k);
    expect(neither).toEqual([]);
  });

  /**
   * Pinned empty, the `ALLOWLIST` idiom. Its only ever candidate was the access gate's own action,
   * which `AUTH-1` 1d deleted. Every future entry is an edit to this line, read by a human.
   */
  it('nothing is excluded from the matrices today', () => {
    expect(excludedActionNames()).toEqual([]);
  });

  /**
   * ⚠️ **The household suite does not exist yet, and WP-1's panel REJECTED deferring it** (log S3).
   * It shipped deferred anyway. Until the suite lands, a `household` entry would face only the
   * unauth and rate-limit matrices — no wrong-owner proof, which AGENTS.md calls mandatory. This
   * assertion is the tripwire: the first household action must edit this line, and whoever does
   * reads why.
   */
  it('every household-addressed action is one the household matrix drives', () => {
    const household = Object.entries(MUTATING_ACTIONS)
      // ⚠️ `as string` is load-bearing, not laziness. Every entry is `profile` today, so TS narrows
      // `v.scope` to `'profile'` and flags the comparison as impossible (TS2367) — a COMPILE error in
      // a test file, which is a confusing way to learn that a household action was added. Widening
      // keeps the failure a readable runtime assertion with the reason attached.
      .filter(([, v]) => 'scope' in v && (v.scope as string) === ACTION_SCOPE.household)
      .map(([k]) => k);
    // 🔴 **Edited at PROF-1 a-1w, not deleted.** The matrix this was waiting for now exists
    // (`actions.test.ts` → "every HOUSEHOLD-addressed Server Action"), so the assertion flips from
    // "there are none" to "these are the ones, and they are driven". A second household action must
    // still edit this line, and whoever does reads why it is here.
    expect(household).toEqual(['addAthleteAction']);
  });
});
