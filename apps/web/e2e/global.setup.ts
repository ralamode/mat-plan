import { SEED_PROFILE_2_NAME, SEED_PROFILE_NAME } from '@mat-plan/shared';
import { expect, test as setup } from '@playwright/test';

import { APP_HOME_PATH } from '../lib/constants';
import { pickerHeading } from './contexts';
import { logBodyweight, selectProfile, submitCheckins, WARMUP_BODYWEIGHT } from './steps';

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
  // ⚠️ **Athlete Two's today, not Athlete One's** (V1-24 PR 1a). Once a day has a weight the surface renders a
  // RECEIPT with no form, so whoever writes first owns that `(profile, day)`. The e2e rule (plan, under
  // the 1a table): warm-up → Athlete Two today; smoke → Athlete One today; export → Athlete One yesterday; a11y →
  // Athlete Two yesterday (bodyweight, and since V1-24 3a-i one strength probe — a different surface);
  // 3a-ii's receipt case logs strength on Athlete Two today (beside this warm-up's weigh-in). No
  // two writers of the same surface share a day; 3a-ii's collapsed strength form makes strength writes
  // count too. The action is profile-agnostic, so the cold cost
  // is absorbed either way.
  await selectProfile(page, SEED_PROFILE_2_NAME); // the picker (V1-3) → tap into a scoped Today
  // cold: boot cost lands here, not in the test
  await logBodyweight(page, WARMUP_BODYWEIGHT, { timeout: 30_000 });

  // Back to Athlete One for the check-ins warm-up — `Splits` is asserted-on by nobody, but the check-in
  // specs run against Athlete One, so the warm statement plan has to be primed on their rows.
  await page.goto(APP_HOME_PATH);
  await selectProfile(page, SEED_PROFILE_NAME);

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
