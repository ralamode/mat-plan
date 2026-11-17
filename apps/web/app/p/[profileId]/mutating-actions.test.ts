import { relative } from 'node:path';

import { describe, expect, it } from 'vitest';

// ⚠️ `MUTATING_ACTIONS` is no longer a literal in `./mutating-actions` (FAM-1 step 0b): it is the
// merge of every Server Action module's own `*.registry.ts`, composed in test support. The runtime
// pins below therefore read every module's entries, as they did when there was one literal.
import { MUTATING_ACTIONS } from '@/test/action-registry';
import { code, exportedActionSlices, serverActionModules, WEB_DIR } from '@/test/source-scan';

import {
  ACTION_SCOPE,
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
  /**
   * The merged registry is built by discovery, so "it found nothing" has to be ruled out before the
   * three `toEqual([])` pins below mean anything: over an empty object each of them passes.
   */
  it('reads a registry that has entries (an empty merge would pass every pin below)', () => {
    expect(Object.keys(MUTATING_ACTIONS)).toContain('logBodyweightAction');
    expect(Object.keys(MUTATING_ACTIONS)).toContain('addAthleteAction');
  });

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
    expect(excludedActionNames(MUTATING_ACTIONS)).toEqual([]);
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
      // ⚠️ `as string` was load-bearing while the registry was one `as const` literal whose every
      // entry was `profile`: TS narrowed `v.scope` and flagged the comparison as impossible
      // (TS2367). The merged registry is typed by its entry union, so it is only belt and braces
      // now, and it stays so the line does not start failing to compile if that ever narrows again.
      .filter(([, v]) => 'scope' in v && (v.scope as string) === ACTION_SCOPE.household)
      .map(([k]) => k);
    // 🔴 **Edited at PROF-1 a-1w, not deleted.** The matrix this was waiting for now exists
    // (`test/action-matrix.ts` → "every HOUSEHOLD-addressed Server Action"), so the assertion flips
    // from "there are none" to "these are the ones, and they are driven". A second household action
    // must still edit this list, and whoever does reads why it is here.
    // ⚠️ One entry per line, SORTED, each with a trailing comment (FAM-1 step 0b): two PRs adding
    // one each then insert on different lines, and the comment keeps the formatter from folding
    // the array onto one. Both sides are sorted, so the order modules are scanned in is not pinned.
    expect(household.sort()).toEqual([
      'addAthleteAction', // PROF-1 a-1w, `app/p/profile-actions.ts`
      'createProgramAction', // FAM-1 7a-i, `app/programs/actions.ts`
      'renameProgramAction', // FAM-1 7a-i, `app/programs/actions.ts`
      'saveWorkoutAction', // FAM-1 7a-i, `app/programs/actions.ts`
    ]);
  });
});

/**
 * 🔴 **Which actions get the 5× rate-limit budget is a list a person reads** (FAM-1 step 0b, D23).
 *
 * `enterMutation(refusal, policy)` lets an action name `ROW_WRITE_RATE_LIMIT` (600 per 5 minutes)
 * in place of the default 120. Each module's matrix already holds an action to the policy its own
 * binding declares, but that is a declaration and its check written by one author in one file. This
 * pin is the other half: the source of every Server Action module is read, and the actions that
 * hand `enterMutation` a second argument must equal the list below. Giving an action the looser
 * budget is therefore an edit here, next to the reason, whatever its module's test says.
 *
 * ⚠️ **It matches ANY second argument, not the const's name.** `enterMutation(x, policy)` through a
 * local alias would slip a scan for the identifier; "named a policy at all" cannot be aliased away.
 * A source scan still has limits, stated plainly: it reads each action's own slice, so a helper
 * that calls `enterMutation` on the action's behalf is not seen here (the boundary guard in
 * `pages-need-a-session.test.ts` already requires the call in the action's own body), and the
 * second assertion below catches a module that names the const anywhere else.
 */
describe('the actions that enter with the row-write rate limit are pinned (FAM-1 D23)', () => {
  /** An `enterMutation(…)` call with a second argument, across line breaks. */
  const NAMES_A_POLICY = /\benterMutation\s*\(\s*[^,()]+,\s*[^\s)]/;
  const ROW_POLICY = /\bROW_WRITE_RATE_LIMIT\b/;

  const modules = serverActionModules();
  const namingAPolicy = modules.flatMap((file) =>
    exportedActionSlices(file)
      .filter(({ body }) => NAMES_A_POLICY.test(body))
      .map(({ name }) => ({ name, module: relative(WEB_DIR, file) })),
  );

  it('reads real actions (an empty scan would pin an empty list for ever)', () => {
    expect(modules.length).toBeGreaterThan(1);
    expect(modules.flatMap((f) => exportedActionSlices(f)).length).toBe(
      Object.keys(MUTATING_ACTIONS).length,
    );
  });

  it('the detector sees a second argument, on one line or several, and not a lone refusal', () => {
    expect('await enterMutation(NO_PROFILE_LOG, ROW_WRITE_RATE_LIMIT);').toMatch(NAMES_A_POLICY);
    expect('await enterMutation(\n  NO_PROFILE_LOG,\n  policy,\n);').toMatch(NAMES_A_POLICY);
    expect('await enterMutation(NO_PROFILE_LOG);').not.toMatch(NAMES_A_POLICY);
    // A trailing comma after the only argument is how a formatter breaks a long call. Not a policy.
    expect('await enterMutation(\n  NO_PROFILE_LOG,\n);').not.toMatch(NAMES_A_POLICY);
  });

  /**
   * The day page's row writes, from FAM-1 step 12b: a ✓ is one write, and a parent logging two
   * athletes' days passes the default (D23). One entry per line, sorted, with a trailing comment
   * naming the module and why the action is a row write.
   */
  it('exactly these actions name a policy other than the default', () => {
    expect(namingAPolicy.map((a) => a.name).sort()).toEqual([
      'logRowAction', // FAM-1 12b, `row-actions.ts`: a ✓
      'retickRowAction', // FAM-1 12b, `row-actions.ts`: a ✓ put back after an un-tick
      'untickRowAction', // FAM-1 12b, `row-actions.ts`: an un-tick
    ]);
  });

  it('no Server Action module mentions the row policy except through a pinned action', () => {
    const mentioning = modules
      .filter((f) => ROW_POLICY.test(code(f)))
      .map((f) => relative(WEB_DIR, f));
    expect(mentioning.sort()).toEqual([...new Set(namingAPolicy.map((a) => a.module))].sort());
  });
});
