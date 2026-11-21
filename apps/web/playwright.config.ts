import { defineConfig, devices } from '@playwright/test';

/**
 * The two e2e servers' origins, defined once and here in the config and imported by every spec that
 * needs both (`docs/plans/td-signed-out-e2e.md`).
 *
 * - `APP_ORIGIN`: the bypassed server, where every request carries the fixture principal.
 * - `SIGNED_OUT_ORIGIN`: the same build with the bypass disarmed, so its visitors are genuinely
 *   signed out. With no Clerk keys in the harness it takes the dark branch (`lib/dal/session.ts:77`,
 *   `proxy.ts:172`); everything after the session comes back `null` is the code under test.
 *
 * ⚠️ **Here, not in `e2e/`:** nothing outside `e2e/` and `scripts/` may import from them
 * (`app/design/program/fakes.test.ts`), and the config is outside both. `e2e-local.ts` passes both
 * ports from `freePort()`; the defaults are CI's.
 */
export const APP_PORT = Number(process.env.E2E_PORT ?? 3100);
export const SIGNED_OUT_PORT = Number(process.env.E2E_SIGNED_OUT_PORT ?? 3101);
export const APP_ORIGIN = `http://localhost:${APP_PORT}`;
export const SIGNED_OUT_ORIGIN = `http://localhost:${SIGNED_OUT_PORT}`;

/**
 * E2E config (V0-11). The `webServer` builds + starts the PRODUCTION app so the
 * screenshot reflects real CSP and real rendering.
 *
 * 🔴 **There is no login step and no `storageState` (AUTH-1 1d).** Both existed for the access gate:
 * a `setup` project entered the shared code once and saved the cookie jar for the other projects.
 * `1d` deletes the gate, and the harness session is now an ENVIRONMENT VARIABLE
 * (`E2E_SESSION_BYPASS_USER_ID`, snapshotted at module scope in `lib/env.ts` and returned first by
 * `lib/dal/session.ts`) — so every request to the FIRST server is already authenticated before the
 * browser opens, and a saved cookie jar would be an empty file. ⚠️ `setup` still runs: it warms the
 * write path, which is what actually fixed the smoke's cold-start flake and has nothing to do with
 * auth.
 *
 * **Two servers, one build** (`docs/plans/td-signed-out-e2e.md`). The second is the same build with
 * the bypass disarmed, so the specs that need a genuine stranger reach it at `SIGNED_OUT_ORIGIN`.
 * Playwright starts the entries in order, each waiting for its URL, and spreads each entry's `env`
 * over `process.env` (`playwright/lib/runner/index.js:913-915`, `:943-947`, at 1.65.1).
 *
 * Specs are `*.spec.ts` and live in `e2e/`; Vitest owns `*.test.ts` elsewhere —
 * the two runners never overlap. See docs/plans/v0-11-ci-postgres-playwright.md.
 */
const baseURL = APP_ORIGIN;

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
  webServer: [
    {
      command: `pnpm --filter web build && pnpm --filter web exec next start -p ${APP_PORT}`,
      // ⚠️ `/` — the landing, which needs no session. It was `/gate`, and after `1d` that 404s, which
      // would hang the harness on a health check forever rather than failing with a useful message.
      url: `${baseURL}/`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
    {
      // The SAME build, signed out. No second `next build`: Playwright starts this only once the
      // first entry's URL answers, so the build has finished. ⚠️ That holds when this run starts the
      // first server (CI, `e2e:local`). A bare local `pnpm --filter web e2e` can REUSE a server on the
      // first port, and this one then runs whatever `.next` is on disk.
      command: `pnpm --filter web exec next start -p ${SIGNED_OUT_PORT}`,
      url: `${SIGNED_OUT_ORIGIN}/`,
      // 🔴 **Always false.** A server this run did not start has an env this run did not set, so it
      // is no proof of a stranger; an occupied port fails loud ("is already used") instead.
      reuseExistingServer: false,
      timeout: 60_000,
      // 🔴 **Exactly this one key, and `''`, never `undefined`.** It overrides the armed principal the
      // parent carries (CI's step env, `e2e-local.ts`); an empty value is unset (`lib/env.ts`). An
      // absent key would inherit the principal, and `undefined` would let `.env.local` win. Every other
      // variable is inherited, the harness's credential blanks included, so the two servers differ
      // only in the principal. Pinned by `test/bypass-is-contained.test.ts` (`DISARMS`).
      env: {
        E2E_SESSION_BYPASS_USER_ID: '',
      },
    },
  ],
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
