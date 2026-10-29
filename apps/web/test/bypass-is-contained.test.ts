import { describe, expect, it } from 'vitest';

import { appSources, code } from './source-scan';

/**
 * AUTH-1 1c-3a — **the test session bypass has exactly one armer and exactly one reader.**
 *
 * `E2E_SESSION_BYPASS_USER_ID` makes `getCurrentUser()` return a synthetic principal, so the
 * Playwright smoke and `screenshot:ephemeral` can reach a page that calls `requireSession()` with no
 * Clerk keys. It is an **authentication bypass living in production code**, so the question here is
 * not "does it work" but *how many places could turn it on, and how many can read what it produces*.
 *
 * 🔴 **No existing guard covers it.** `packages/db/src/scope.test.ts` is a *tenancy* guard — it pins
 * where `householdScopeForRequest` / `householdScopeForScript` / `makeHouseholdScope` appear, and its
 * fence excludes `apps/web/proxy.ts` entirely. A bypass that mints no scope and unwraps nothing
 * sails past all of it. (`auth-1c-pre-login-seam.md`, panel finding 1.)
 *
 * **The containment has two halves, and they are deliberately different shapes:**
 *  1. the **raw variable** may be named only where it is declared, validated and injected;
 *  2. the **predicate** `sessionBypassUserId()` may be called only by the principal module.
 *
 * Half 2 is what makes `lib/dal/session.ts` absent from half 1's list a *strength* rather than an
 * omission: the DAL never touches `process.env` for this at all, so it cannot skip the locality
 * check or the boot refusal that `lib/env.ts` owns.
 *
 * ⚠️ **Two limits, named rather than papered over.**
 *  - `appSources()` is rooted at `apps/web` and **excludes `*.test.ts`** (`source-scan.ts:62`), so
 *    this file and `.github/workflows/ci.yml` are both outside the sweep. CI injects the variable at
 *    step level; that is reviewed as a workflow change, not here.
 *  - A source scan cannot see `process.env[dynamicKey]` or a split string literal. `lib/env.ts`'s
 *    **boot refusal** is what actually contains that: a second reader of the raw variable still has
 *    to get past a guard that throws at module load unless the database is local.
 */
describe('the test session bypass is contained (AUTH-1 1c-3a)', () => {
  /** Declares it, validates its shape, refuses at boot, and exposes the predicate. */
  const ARMS = 'lib/env.ts';
  /** Inject it into a throwaway harness. Not on a request path — the `scope.test.ts` idiom. */
  const INJECTORS = ['scripts/e2e-local.ts', 'scripts/screenshot-ephemeral.ts'];
  /** The one module allowed to turn the predicate into a principal. */
  const READS_PREDICATE = 'lib/dal/session.ts';

  const relative = (f: string) => f.replace(/^.*apps\/web\//, '');

  it('names the raw variable in exactly the armer and the injectors', () => {
    const sources = appSources();
    // Non-vacuity: a mis-rooted or empty glob must fail loudly rather than pass by finding nothing.
    expect(sources.length).toBeGreaterThan(50);

    const namers = sources.filter((f) => /E2E_SESSION_BYPASS_USER_ID/.test(code(f))).map(relative);

    expect(
      namers.sort(),
      'an auth bypass is armed in ONE module and injected only by throwaway harnesses',
    ).toEqual([ARMS, ...INJECTORS].sort());
  });

  it('reads `process.env` for it in the armer alone', () => {
    // The distinction that matters: a direct `process.env` read anywhere else would skip the
    // locality check AND the boot refusal, which is the whole of the containment.
    const raw = appSources()
      .filter((f) => /process\.env\.E2E_SESSION_BYPASS_USER_ID/.test(code(f)))
      .map(relative);

    expect(
      raw,
      'read it via sessionBypassUserId(); the raw env read belongs to lib/env.ts',
    ).toEqual([ARMS]);
  });

  it('calls the predicate only from the principal module', () => {
    const callers = appSources()
      .filter((f) => relative(f) !== ARMS && /\bsessionBypassUserId\s*\(/.test(code(f)))
      .map(relative);

    expect(
      callers.sort(),
      'the stand-in principal enters the app in one place, beside the real one',
    ).toEqual([READS_PREDICATE]);
  });

  it('every allowlisted file still exists — an allowlist must not outlive its subject', () => {
    // `pages-are-gated.test.ts`'s dead-entry rule: a stale name silently excuses a file somebody may
    // later recreate at that exact path.
    const present = appSources().map(relative);
    for (const entry of [ARMS, ...INJECTORS, READS_PREDICATE]) {
      expect(present, `${entry} is allowlisted but no longer exists`).toContain(entry);
    }
  });
});
