import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Unit / integration runner (pulled forward ahead of V0-8 so the first Server
 * Action can ship its boundary tests in-PR — see docs/plan.md). Node env covers
 * the mandatory layers: zod schemas, pure utils, and Server Actions exercised as
 * plain async functions (mock the DAL — AGENTS.md testing gotcha). Component
 * (RTL/jsdom) and E2E (Playwright, V0-11) are added when a UI flow needs them.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: [
      '**/*.test.{ts,tsx}',
      // `packages/**` was covered by NOTHING: `pnpm test` is `pnpm --filter web test`, so a test
      // written beside shared or db code never ran — it would ship green without executing. Recorded
      // in docs/tech-debt.md ("gates quietly go vacuous"); closed here because it is two lines and
      // there were zero such tests to break.
      '../../packages/*/src/**/*.test.ts',
      // 🔴 **`scripts/` was still uncovered, for the same reason and with the same consequence.**
      // The line above closed `packages/*/src`; `packages/db/scripts/` holds `verify.ts`,
      // `correct.ts` and the corrections registry — real logic, and the place a guard for a
      // correction belongs. A test written there ran NOWHERE until AUTH-1 1c-4a, so it would have
      // shipped green without executing. Proven by watching `corrections/target-url.test.ts` go red.
      '../../packages/*/scripts/**/*.test.ts',
    ],
    // Playwright owns e2e/ (its specs are *.spec.ts, already outside `include`);
    // exclude the dir too so a stray *.test.ts there never leaks into Vitest.
    exclude: ['**/e2e/**', '**/node_modules/**', '**/dist/**', '**/.next/**'],
    // Valid values so modules that import lib/env.ts don't fail boot validation
    // under test. Individual tests override/mock as needed.
    // ⚠️ `ACCESS_GATE_PASSWORD` was here until AUTH-1 1d, for boot validation only — `lib/env.ts` no
    // longer declares it. `generate-privacy-notice.test.ts` was the one test that READ it; it now
    // owns a fixture secret of its own, because `not.toContain(undefined!)` is a broken assertion
    // rather than a weaker one.
    env: {
      DATABASE_URL: 'postgres://user:pass@localhost:5432/mat_plan_test',
    },

    /**
     * DX-13 — coverage is a MEASUREMENT, published post-merge by `.github/workflows/metrics.yml`.
     * It gates nothing: AGENTS.md → "Local hooks vs CI merge-gates" is the one list of what blocks a
     * merge, and this is not on it.
     *
     * 🔴 **There is deliberately no `thresholds` key.** Its absence is the design — a threshold is a
     * gate by another name, and the maintainer asked for a non-gating number (2026-11-10). Adding one
     * is a decision to argue with `docs/plans/dx-13-coverage-and-e2e-budget.md` about, not a tidy-up.
     *
     * ⚠️ **`enabled` stays false** (the default), so the provider is only loaded by an explicit
     * `--coverage` — CI's `quality` job runs plain `pnpm test` and never pays for it.
     */
    coverage: {
      provider: 'v8',
      /**
       * 🔴 **`include` IS the honest denominator.** Since vitest 4 there is no `all` option: listing a
       * file here counts it whether or not a test touches it. Without an explicit list, coverage
       * counts only files that already have tests — so adding an untested module makes the number go
       * UP, which flatters exactly when it should not.
       *
       * ⚠️ **Every glob is extension-qualified**, as `test.include` above is. A bare `app/**` sweeps
       * in `globals.css`, `token-sets.css` and `favicon.ico`; each then either reports as 100% (a
       * 0-statement file) or is dropped with an "Excluding it from coverage" log line and exit 0 — a
       * wrong denominator on a green run.
       *
       * ⚠️ The `packages/*` entry is OUTSIDE this config's root, which is why `allowExternal` below
       * is not optional: vitest drops out-of-root files without it.
       */
      include: [
        'app/**/*.{ts,tsx}',
        'components/**/*.{ts,tsx}',
        'lib/**/*.{ts,tsx}',
        'proxy.ts',
        'instrumentation.ts',
        'sentry.*.config.ts',
        '../../packages/*/src/**/*.ts',
      ],
      allowExternal: true,
      /**
       * Both entries are load-bearing; nothing else is listed, because an exclusion that can never
       * match reads as a decision while doing nothing.
       *
       * `recording-db.ts` is **test-support code living in a production directory** — its own
       * docblock says "TEST SUPPORT ONLY; nothing in the app imports it". `lib/**` would otherwise
       * count a file the app never executes and the tests exercise thoroughly, inflating the number
       * by precisely the amount an honest denominator exists to prevent.
       */
      exclude: ['**/*.test.{ts,tsx}', 'lib/dal/recording-db.ts'],
      /**
       * `text-summary` → stdout, which `metrics.yml` tees into the job summary.
       * `json-summary` → `coverage/coverage-summary.json`, which that workflow asserts against.
       * ⚠️ Not the default list (`text`, `html`, `clover`, `json`): it writes no `coverage-summary.json`
       * at all, so the workflow's fail-loud check would fire on every run.
       */
      reporter: ['text-summary', 'json-summary'],
      /** A failed run must not publish a number. */
      reportOnFailure: false,
      // ⚠️ **The two `scripts/` trees are outside `include` on purpose, and the asymmetry is worth
      // knowing about:** `test.include` above deliberately RUNS the test files under
      // `packages/*/scripts/` (see its comment for why). Those tests still execute; only the
      // percentage ignores them.
    },
  },
  resolve: {
    alias: {
      // Mirror the `@/*` tsconfig path so tests import the same way app code does.
      '@': here,
      // `import 'server-only'` throws outside an RSC bundle; stub it under Node.
      'server-only': join(here, 'test/server-only-stub.ts'),
    },
  },
});
