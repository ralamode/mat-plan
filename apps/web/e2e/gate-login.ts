import { expect, type Page } from '@playwright/test';

// Relative (not `@/`) so the tsx-run screenshot script resolves it without
// tsconfig-path tooling. `GATE_PATH` is the single source of truth for the
// route — never hardcode '/gate' or re-derive the gate token here.
import { GATE_PATH } from '../lib/access-gate';
import { APP_HOME_PATH, PICKER_COPY } from '../lib/constants';

/**
 * Drive the real access-gate form to authenticate a page. Used by the Playwright
 * `setup` project (to mint a reusable `storageState`) and by the screenshot
 * script — one helper, two consumers. Driving the actual form (rather than
 * injecting a cookie) keeps this an honest smoke of the gate itself.
 */
export async function gateLogin(page: Page): Promise<void> {
  const password = process.env.ACCESS_GATE_PASSWORD;
  if (!password) {
    throw new Error('ACCESS_GATE_PASSWORD must be set to log through the gate (e2e / screenshot).');
  }

  await page.goto(GATE_PATH);
  await page.getByLabel('Access code').fill(password);
  await page.getByRole('button', { name: 'Enter' }).click();

  // With no `from`, the Server Action redirects straight to the app home — the picker, in one hop
  // (OSS-2: `/` is the public landing now).
  await page.waitForURL(APP_HOME_PATH);
  await expect(
    page.getByRole('heading', { name: PICKER_COPY.heading, exact: true, level: 1 }),
  ).toBeVisible();
}
