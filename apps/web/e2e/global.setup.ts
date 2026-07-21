import { test as setup } from '@playwright/test';

import { STORAGE_STATE } from '../playwright.config';
import { gateLogin } from './gate-login';
import { logBodyweight, selectProfile } from './steps';

// Runs once before the chromium project (its `dependencies: ['setup']`). Two jobs:
//   1. Authenticate through the gate and persist storageState, so specs start
//      already past the access gate.
//   2. WARM the write path. The first Server Action after a cold `next start`
//      pays JIT + first-DB-connection cost — that one-time cost is what made the
//      smoke flake. Absorbing it here (once, with a generous timeout) lets the
//      actual coverage test run warm and fast under the default timeout, instead
//      of padding the test's timeout to hide the race.
setup('authenticate + warm the write path', async ({ page }) => {
  await gateLogin(page);
  await page.context().storageState({ path: STORAGE_STATE });

  await page.goto('/');
  await selectProfile(page, 'Liam'); // '/' is the picker (V1-3) → tap into a scoped Today
  await logBodyweight(page, '0.5', { timeout: 30_000 }); // cold: boot cost lands here, not in the test
});
