import { defineConfig, devices } from '@playwright/test';

/**
 * E2E config (V0-11). The `webServer` builds + starts the PRODUCTION app so the
 * screenshot reflects real CSP and real rendering.
 *
 * 🔴 **There is no login step and no `storageState` (AUTH-1 1d).** Both existed for the access gate:
 * a `setup` project entered the shared code once and saved the cookie jar for the other projects.
 * `1d` deletes the gate, and the harness session is now an ENVIRONMENT VARIABLE
 * (`E2E_SESSION_BYPASS_USER_ID`, snapshotted at module scope in `lib/env.ts` and returned first by
 * `lib/dal/session.ts`) — so every request is already authenticated before the browser opens, and a
 * saved cookie jar would be an empty file. ⚠️ `setup` still runs: it warms the write path, which is
 * what actually fixed the smoke's cold-start flake and has nothing to do with auth.
 *
 * Specs are `*.spec.ts` and live in `e2e/`; Vitest owns `*.test.ts` elsewhere —
 * the two runners never overlap. See docs/plans/v0-11-ci-postgres-playwright.md.
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // Backstop for genuine infra hiccups only — NOT a cover for a race. The
  // cold-start that made the smoke flaky is fixed at the source (the setup
  // project warms the write path), so the coverage test runs fast under the
  // DEFAULT expect timeout. A `flaky` annotation is a bug to fix, not to shrug at.
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['html'], ['github']] : 'list',
  outputDir: './test-results',
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // Pin the browser tz to the app's default (V1-6c): dates are deterministic, and because
    // the server's first-paint default equals this, TimeZoneSync writes the cookie WITHOUT a
    // refresh — no refresh-induced flake in the smoke.
    timezoneId: 'America/Los_Angeles',
  },
  webServer: {
    command: `pnpm --filter web build && pnpm --filter web exec next start -p ${PORT}`,
    // ⚠️ `/` — the landing, which needs no session. It was `/gate`, and after `1d` that 404s, which
    // would hang the harness on a health check forever rather than failing with a useful message.
    url: `${baseURL}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
  projects: [
    { name: 'setup', testMatch: /global\.setup\.ts$/ },
    {
      name: 'chromium',
      testIgnore: /a11y\.spec\.ts$/, // owned by the `a11y` project below
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
    },
    {
      // V1-12: the a11y scan gets its own project for two reasons. (1) It pins a MOBILE viewport —
      // the primary device — rather than Desktop Chrome. (2) `bypassCSP`: the server emits a strict
      // nonce-based `script-src` (see proxy.ts) and Playwright boots the PRODUCTION build, which is a
      // known failure mode for axe's injected script. Scoping the bypass here keeps CSP live for the
      // functional smoke, which is where a CSP regression would actually matter.
      name: 'a11y',
      testMatch: /a11y\.spec\.ts$/,
      use: {
        // Chromium with phone emulation — NOT `devices['iPhone 14']`, whose default browser is WEBKIT
        // (only chromium is installed, in CI and locally). Mirrors `scripts/capture.ts`'s mobile
        // viewport so the scan and the screenshots describe the same rendering.
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
        bypassCSP: true,
      },
      dependencies: ['setup'],
    },
  ],
});
