import { test as setup } from '@playwright/test';

import { STORAGE_STATE } from '../playwright.config';
import { gateLogin } from './gate-login';
import { logBodyweight, selectProfile, submitCheckins } from './steps';

// Runs once before the chromium project (its `dependencies: ['setup']`). Two jobs:
//   1. Authenticate through the gate and persist storageState, so specs start
//      already past the access gate.
//   2. WARM the write path. The first Server Action after a cold `next start`
//      pays JIT + first-DB-connection cost — that one-time cost is what made the
//      smoke flake. Absorbing it here (once, with a generous timeout) lets the
//      actual coverage test run warm and fast under the default timeout, instead
//      of padding the test's timeout to hide the race.
// The setup does gate login PLUS a cold write on EVERY distinct action path, each of which can take
// tens of seconds on a cold `next start` — so it needs a test timeout well above Playwright's 30s
// default. Without this the setup itself times out on a slow runner, the warming silently never
// happens, and the cold cost lands in the coverage test instead: exactly the flake this file exists to
// prevent. (Learned the hard way — adding the second warm-up below made setup fail outright.)
setup.setTimeout(180_000);

setup('authenticate + warm the write path', async ({ page }) => {
  await gateLogin(page);
  await page.context().storageState({ path: STORAGE_STATE });

  await page.goto('/');
  await selectProfile(page, 'Liam'); // '/' is the picker (V1-3) → tap into a scoped Today
  await logBodyweight(page, '0.5', { timeout: 30_000 }); // cold: boot cost lands here, not in the test

  // …and warm the CHECK-INS path too. Warming bodyweight alone was not enough: `logCheckinsAction` is a
  // DIFFERENT, heavier action (it resolves several catalog rows, then does a MULTI-row insert), so it
  // paid its own first-invocation cost — module load, JIT, first plan for that statement shape — inside
  // the coverage test, under the 15s assertion. That is the long-standing "Log check-ins button stays
  // 'Logging…'" flake: the FIRST check-ins submit in the suite hung, and the retry passed because it was
  // then warm. Same doctrine as above — absorb the cold cost here, never pad the test's timeout.
  //
  // `Splits` is chosen deliberately: it is a bare habit (so it exercises the kind-NULL multi-row path)
  // that NO spec asserts on, so warming it cannot perturb the Rice-bucket / Push-ups / Pressure
  // assertions the two check-in specs make.
  await submitCheckins(page, { checks: ['Splits'], timeout: 30_000 });
});
