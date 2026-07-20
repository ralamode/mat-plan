import { defineConfig, devices } from '@playwright/test';

/**
 * E2E config (V0-11). The `webServer` builds + starts the PRODUCTION app so the
 * screenshot reflects real CSP/render and — critically — `NODE_ENV=production`
 * makes the access-gate cookie `Secure`, which Chromium honors on `localhost`.
 * A `setup` project logs through the gate once and saves `storageState`; the
 * `chromium` project loads it, so specs start already past the gate.
 *
 * Specs are `*.spec.ts` and live in `e2e/`; Vitest owns `*.test.ts` elsewhere —
 * the two runners never overlap. See docs/plans/v0-11-ci-postgres-playwright.md.
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://localhost:${PORT}`;

/** Where the gate-authenticated storage state is written (gitignored). */
export const STORAGE_STATE = './e2e/.auth/state.json';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['html'], ['github']] : 'list',
  outputDir: './test-results',
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `pnpm --filter web build && pnpm --filter web start -- -p ${PORT}`,
    url: `${baseURL}/gate`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
  projects: [
    { name: 'setup', testMatch: /global\.setup\.ts$/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], storageState: STORAGE_STATE },
      dependencies: ['setup'],
    },
  ],
});
