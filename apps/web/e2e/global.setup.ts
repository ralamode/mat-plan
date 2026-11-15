import { SEED_PROFILE_2_NAME } from '@mat-plan/shared';
import { expect, test as setup } from '@playwright/test';

import { APP_HOME_PATH } from '../lib/constants';
import { pickerHeading } from './contexts';
import { logBodyweight, selectProfile, WARMUP_BODYWEIGHT } from './steps';

// Runs once before the chromium project (its `dependencies: ['setup']`). ONE job since AUTH-1 1d:
//   WARM the write path. The first Server Action after a cold `next start`
//      pays JIT + first-DB-connection cost — that one-time cost is what made the
//      smoke flake. Absorbing it here (once, with a generous timeout) lets the
//      actual coverage test run warm and fast under the default timeout, instead
//      of padding the test's timeout to hide the race.
// 🔴 **It no longer authenticates, because there is nothing to authenticate THROUGH.** It used to
// enter the shared access code and save the cookie jar; the harness session is now
// `E2E_SESSION_BYPASS_USER_ID`, read from the process env before the server boots, so every request
// arrives authenticated and there is no browser-side login to perform or persist.
//
// The setup does a cold write on EVERY distinct action path, each of which can take
// tens of seconds on a cold `next start` — so it needs a test timeout well above Playwright's 30s
// default. Without this the setup itself times out on a slow runner, the warming silently never
// happens, and the cold cost lands in the coverage test instead: exactly the flake this file exists to
// prevent. (Learned the hard way — adding the second warm-up below made setup fail outright.)
setup.setTimeout(180_000);

setup('warm the write path', async ({ page }) => {
  // 🔴 **This `goto` is load-bearing and is new at `1d`.** `gateLogin` used to perform the only
  // navigation in this file; without it the picker assertion below would run against `about:blank`
  // and fail for a reason that has nothing to do with the app.
  await page.goto(APP_HOME_PATH);
  // 🔴 **The suite's household health check (AUTH-1 1c-2).** This is the consumer that genuinely
  // requires the picker — every line below selects a profile — so the specific assertion belongs
  // here. Without it, a deploy where household resolution silently broke would render "No household
  // for this account" and first fail as a `selectProfile` timeout on a missing tile: a confusing
  // failure a long way from its cause.
  await expect(pickerHeading(page)).toBeVisible();
  // ⚠️ **Athlete Two's today, not Athlete One's** (V1-24 PR 1a). Once a day has a weight the surface
  // renders a RECEIPT with no form, so whoever writes first owns that `(profile, day)`. The e2e rule:
  // warm-up → Athlete Two today; smoke → Athlete One today; export → Athlete One yesterday; a11y →
  // Athlete Two yesterday. No two writers of the same surface share a day. The action is
  // profile-agnostic, so the cold cost is absorbed either way.
  //
  // V1-24 3b-page: the check-ins warm-up left with the Check-ins form. Bodyweight is the one write
  // path every spec's first action shares; the smoke's practice tap pays its own (smaller) cold cost
  // under a 15s assertion.
  await selectProfile(page, SEED_PROFILE_2_NAME); // the picker (V1-3) → tap into a scoped Today
  // cold: boot cost lands here, not in the test
  await logBodyweight(page, WARMUP_BODYWEIGHT, { timeout: 30_000 });
});
