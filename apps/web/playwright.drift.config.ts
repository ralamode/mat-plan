import { defineConfig, devices } from '@playwright/test';

/**
 * **The sign-in drift check** (`e2e/signin.drift.ts`; plan: `docs/plans/td-signin-drift-check.md`).
 * It loads the PRODUCTION `/sign-in` with the production CSP live, because Clerk's browser runtime
 * floats on a CDN major (the maintainer's "don't pin; check it periodically", 2026-11-19) and nothing
 * else in CI ever renders it. `.github/workflows/signin-drift.yml` runs it weekly.
 *
 * - **No `webServer`:** it reads a deployed site, never a local build.
 * - **`.drift.ts`, not `.spec.ts`:** the main config's `testMatch` can never pick it up, so a PR's
 *   e2e job never reaches production.
 * - **It throws without an `https://` URL,** never skips: a skipped run exits 0, and a weekly check
 *   that passes because it was misconfigured is the failure this exists to prevent.
 * - **`retries: 1`:** one network read of a third party, once a week; a single blip should not open
 *   an issue. A second failure is real.
 * - **`trace: 'off'`:** a trace keeps every response header, Clerk's `Set-Cookie` for the signed-out
 *   client it mints included, and the artefact is downloadable on a public repo.
 */
const target = process.env.DRIFT_BASE_URL ?? '';
if (!/^https:\/\/[^/\s]+$/.test(target)) {
  throw new Error(
    `DRIFT_BASE_URL must be an https:// origin with no path (got ${JSON.stringify(target)}).`,
  );
}
console.log(`sign-in drift check target: ${target}`);

export default defineConfig({
  testDir: './e2e',
  testMatch: /\.drift\.ts$/,
  fullyParallel: false,
  forbidOnly: true,
  retries: 1,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: target,
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'drift',
      use: {
        // The viewport is set in the spec (`NARROW_VIEWPORT`): nothing outside `e2e/` imports from
        // it (`app/design/program/fakes.test.ts`).
        ...devices['Desktop Chrome'],
        isMobile: true,
        hasTouch: true,
        // The runner may refuse the sandbox; then this goes, and the residual is recorded in
        // `.github/SECURITY.md` (maintainer, 2026-11-20).
        launchOptions: { chromiumSandbox: true },
      },
    },
  ],
});
