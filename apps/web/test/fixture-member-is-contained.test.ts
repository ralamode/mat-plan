import { globSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { E2E_SESSION_BYPASS_USER, SEED_HOUSEHOLD_PUBLIC_ID } from '@mat-plan/shared';

import { appSources, code, WEB_DIR } from './source-scan';

/** The repo root. `WEB_DIR` is `apps/web`, so workflows sit two levels up and outside every `appSources()` sweep. */
const REPO = resolve(WEB_DIR, '../..');

/**
 * 🔴 **The fixture MEMBERSHIP is contained — `AUTH-1` 1c-4a.**
 *
 * 1c-3a gave the harnesses a *principal*; this chunk gives that principal a `household_members` row,
 * because from `1c-4` the household scope is derived from it. The row is written by the committed
 * `household-claim-2026-10-25` correction, which is also the writer `packages/db/scripts/verify.ts`
 * names when it asserts _"the seed writes NO household_members row"_ — the seed must keep writing
 * none, because `migrate.yml` seeds **production**.
 *
 * The sibling guard for the principal (`bypass-is-contained.test.ts`) explains why a prose rule is
 * not enough here: it exists because `ci.yml` stated one and nothing checked it. Three things this
 * file pins that nothing else can:
 *
 *  1. **No workflow but `ci.yml` runs the claim correction.** `migrate.yml` seeds production, and a
 *     copy of the step there is the one way this row reaches a real database. The correction itself
 *     refuses (it will not bind this principal to a non-local target), so this is the second half of
 *     a belt-and-braces, not the only control.
 *  2. **`ci.yml`'s literals equal the committed constants.** `appSources()` is rooted at `apps/web`,
 *     so a workflow is outside every other sweep — which is exactly how the bypass id came to be
 *     duplicated between `seed-ids.ts` and `ci.yml` with nothing noticing drift. The same shape
 *     applies here, with two values instead of one.
 *  3. **`dev-local.ts` does NOT call the linker.** `migrateAndSeed` has three callers and the third
 *     is `pnpm dev`, against the **persistent** cluster. The correction refuses a second identical
 *     bind, so a `pnpm dev` that linked would die on its *second* start — after the change had
 *     shipped, in somebody's working day, with nothing in CI having seen it.
 */
describe('the fixture membership is contained (AUTH-1 1c-4a)', () => {
  const CORRECTION = 'household-claim-2026-10-25';
  /** The two throwaway harnesses. Both delete their database on exit. */
  const LINKERS = ['scripts/e2e-local.ts', 'scripts/screenshot-ephemeral.ts'];
  /** Defines the helper. Not a caller. */
  const DEFINES = 'scripts/embedded-pg.ts';
  /** `pnpm dev`, against a cluster that survives a restart. */
  const PERSISTENT = 'scripts/dev-local.ts';

  const relative = (f: string) => f.replace(/^.*apps\/web\//, '');

  it('only the CI smoke job runs the claim correction', () => {
    const workflows = globSync('.github/workflows/*.{yml,yaml}', { cwd: REPO })
      .map((f) => join(REPO, f))
      .filter((f) => new RegExp(`db:correct\\s+${CORRECTION}`).test(readFileSync(f, 'utf8')));

    // Non-vacuity: a mis-rooted glob must fail loudly rather than pass by finding nothing.
    expect(globSync('.github/workflows/*.{yml,yaml}', { cwd: REPO }).length).toBeGreaterThan(3);
    expect(
      workflows.map((f) => f.replace(`${REPO}/`, '')),
      'migrate.yml seeds PRODUCTION — the fixture membership must never be written from a workflow other than the smoke job',
    ).toEqual(['.github/workflows/ci.yml']);
  });

  it("CI's literals are the committed constants, not a second copy that can drift", () => {
    const ci = readFileSync(join(REPO, '.github/workflows/ci.yml'), 'utf8');
    // The contract-test exception in AGENTS.md → Constants: the literal belongs on the assertion
    // side, exactly once, or the test is tautological. Here the workflow is the other side.
    expect(ci, 'ci.yml must pass the committed household fixture id').toContain(
      `HOUSEHOLD_PUBLIC_ID=${SEED_HOUSEHOLD_PUBLIC_ID}`,
    );
    expect(ci, 'ci.yml must pass the committed bypass principal').toContain(
      `CLERK_USER_ID=${E2E_SESSION_BYPASS_USER}`,
    );
  });

  it('is called from the throwaway harnesses only — never from `pnpm dev`', () => {
    const sources = appSources();
    expect(sources.length).toBeGreaterThan(50);

    const callers = sources
      .filter((f) => /\blinkFixtureMember\s*\(/.test(code(f)))
      .map(relative)
      .sort();

    expect(callers, 'only the two throwaway harnesses may link the fixture membership').toEqual(
      [...LINKERS, DEFINES].sort(),
    );
  });

  it('🔴 `pnpm dev` is left alone, and the reason is written where the next author will look', () => {
    // The failure this prevents is delayed: the FIRST `pnpm dev` would succeed and the SECOND would
    // die on the correction's refusal, because the persistent cluster still holds the row. A test
    // that only checked the call list would let somebody "fix" it by making the bind idempotent —
    // which is the thing `insertHouseholdMember` refuses to be, on purpose.
    const dev = code(join(WEB_DIR, PERSISTENT));
    expect(dev).not.toMatch(/\blinkFixtureMember\b/);
    // ⚠️ RAW, not `code()`: the claim here is about the PROSE, and `code()` strips comments. The
    // `sign-out.test.tsx` pair sets the precedent — comment-stripped source for what the module
    // does, raw source for what it tells the next author. Using `code()` here fails on its own
    // assertion, which is how this line was written the first time.
    expect(
      readFileSync(join(WEB_DIR, DEFINES), 'utf8'),
      'embedded-pg.ts must say why pnpm dev is excluded, not merely exclude it',
    ).toMatch(/dev-local/);
  });
});
