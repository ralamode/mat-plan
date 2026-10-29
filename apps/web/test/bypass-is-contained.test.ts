import { globSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { E2E_SESSION_BYPASS_USER } from '@mat-plan/shared';
import { describe, expect, it } from 'vitest';

import { appSources, code, WEB_DIR } from './source-scan';

const REPO = resolve(WEB_DIR, '../..');

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

  it('names the predicate only in the principal module', () => {
    // 🔴 **The SYMBOL, not a call.** A first version matched `/\bsessionBypassUserId\s*\(/`, which a
    // security probe walked straight through: `import { sessionBypassUserId as uid }` then `uid()`
    // passed, and so would `const f = sessionBypassUserId; f()` or a plain re-export. Matching the
    // bare identifier catches the import, the alias, the re-export and the indirect call at once —
    // and is cheaper than the regex it replaces.
    const namers = appSources()
      .filter((f) => relative(f) !== ARMS && /\bsessionBypassUserId\b/.test(code(f)))
      .map(relative);

    expect(
      namers.sort(),
      'the stand-in principal enters the app in one place, beside the real one',
    ).toEqual([READS_PREDICATE]);
  });

  it('CI names the fixture id exactly once, step-scoped, with the committed value', () => {
    // `appSources()` is rooted at `apps/web`, so workflows are outside every sweep above — which
    // left the id duplicated between `seed-ids.ts` and `ci.yml` with nothing noticing drift.
    //
    // 🔴 **A first version of this missed all three realistic ways a second step acquires it**, each
    // proven green by a security probe: a `run:` step appending to `$GITHUB_ENV` (the value regex
    // only matched the `key: value` form); a `.yaml` file (the glob was `*.yml`); and moving the
    // block from the step to the JOB, which produces the same single correct match while putting the
    // variable in reach of every step — `actions/upload-artifact` included. `ci.yml` asserts that
    // step-vs-job rule for itself in prose; this is the gate behind the sentence.
    const workflows = globSync('.github/workflows/*.{yml,yaml}', { cwd: REPO })
      .map((f) => join(REPO, f))
      .filter((f) => /E2E_SESSION_BYPASS_USER_ID/.test(readFileSync(f, 'utf8')));

    expect(
      workflows.map((f) => f.replace(`${REPO}/`, '')),
      'only the Playwright smoke step may arm the bypass',
    ).toEqual(['.github/workflows/ci.yml']);

    const ci = readFileSync(join(REPO, '.github/workflows/ci.yml'), 'utf8');

    // 🔴 **Count EVERY mention anywhere on any line, then pin the shape of the single survivor.**
    // A line-anchored pattern was not enough: `run: echo "KEY=value" >> "$GITHUB_ENV"` puts the name
    // mid-line, so it stayed invisible — found by probing this very fix, which passed with such a
    // step present. Counting first means a second mention fails regardless of what introduced it:
    // a `run:`, a matrix, a comment, or another step's `env:`.
    const mentions = ci.match(/E2E_SESSION_BYPASS_USER_ID/g) ?? [];
    expect(
      mentions,
      'exactly one mention: the Playwright smoke step and nothing else',
    ).toHaveLength(1);

    const declaration = /^(\s*)E2E_SESSION_BYPASS_USER_ID: (\S+)$/m.exec(ci);
    expect(declaration, 'the one mention must be a plain `key: value` env entry').not.toBeNull();
    expect(declaration?.[2], 'CI injects the committed constant, never a re-typed literal').toBe(
      E2E_SESSION_BYPASS_USER,
    );
    // Step-scoped, not job-scoped: a step's `env:` nests deeper than the job's own keys. This job's
    // job-level `env:` sits at 6 spaces, so 10+ is inside a step.
    expect(
      declaration?.[1].length,
      'STEP-level only — a job-level env reaches every step, upload-artifact included',
    ).toBeGreaterThan(8);
  });

  it("both harnesses blank the third-party credentials with `''`, never `undefined`", () => {
    // 🔴 **The exact defect the previous review round fixed, now pinned.** `spawn` DROPS a key whose
    // value is `undefined` — and an absent key is precisely when `@next/env` applies the `.env.local`
    // value instead. So blanking with `undefined` handed the win to the file it was defending
    // against, and `e2e:local` ran with Clerk CONFIGURED on any machine holding dev keys. The only
    // thing that would have caught it is `e2e/theme.spec.ts`'s zero-egress assertion, which is
    // ONE-WAY: once a Clerk host is legitimately contacted it can never catch a regression again.
    // So the mechanism gets a cheap source-text assertion of its own rather than relying on that.
    const BLANKED = [
      'CLERK_SECRET_KEY',
      'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY',
      'UPSTASH_REDIS_REST_URL',
      'UPSTASH_REDIS_REST_TOKEN',
      'SENTRY_DSN',
    ];

    for (const script of ['scripts/e2e-local.ts', 'scripts/screenshot-ephemeral.ts']) {
      const src = code(join(WEB_DIR, script));
      for (const key of BLANKED) {
        expect(src, `${script} must blank ${key}`).toMatch(new RegExp(`${key}:\\s*''`));
        expect(src, `${script}: ${key} must not be blanked with undefined`).not.toMatch(
          new RegExp(`${key}:\\s*undefined`),
        );
      }
    }
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
