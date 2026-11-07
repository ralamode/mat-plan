import { describe, expect, it } from 'vitest';

import { ACTION_SCOPE, MUTATING_ACTIONS, excludedActionNames } from './mutating-actions';

/**
 * 🔴 **These tests exist because the claim they pin shipped FALSE.**
 *
 * WP-1 (#345) stated in five places that "an entry cannot carry both `scope` and `excluded` — it is
 * a type error". It was not: TypeScript's excess-property check on a non-discriminated union only
 * requires each property to exist in *some* member, so an entry carrying both compiled, was
 * classified as excluded, and silently got no binding and no refusal matrix.
 *
 * ⚠️ **The exclusivity itself cannot be asserted at runtime** — it is a compile-time property, and a
 * `@ts-expect-error` here would pass whether the union is exclusive or not (the directive only
 * requires *an* error, and a wrong-shaped literal errors either way). What these tests pin is the
 * part that is observable: the registry's actual contents, and the invariant that every entry is one
 * kind or the other. The compile-time half is held by `MatrixEntry.excluded?: never` /
 * `ExcludedEntry.scope?: never` and by `pnpm typecheck`.
 */
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
  it('no household-addressed action exists until its matrix does', () => {
    const household = Object.entries(MUTATING_ACTIONS)
      // ⚠️ `as string` is load-bearing, not laziness. Every entry is `profile` today, so TS narrows
      // `v.scope` to `'profile'` and flags the comparison as impossible (TS2367) — a COMPILE error in
      // a test file, which is a confusing way to learn that a household action was added. Widening
      // keeps the failure a readable runtime assertion with the reason attached.
      .filter(([, v]) => 'scope' in v && (v.scope as string) === ACTION_SCOPE.household)
      .map(([k]) => k);
    expect(household).toEqual([]);
  });
});
