import { test as setup } from '@playwright/test';

import { STORAGE_STATE } from '../playwright.config';
import { gateLogin } from './gate-login';

// Runs once before the chromium project (its `dependencies: ['setup']`). Logs
// through the gate and persists the authenticated storage state, so every spec
// starts already past the access gate instead of re-authenticating.
setup('authenticate through the gate', async ({ page }) => {
  await gateLogin(page);
  await page.context().storageState({ path: STORAGE_STATE });
});
