import { expect, type Page } from '@playwright/test';

// Relative (not `@/`) so the tsx-run screenshot script resolves it without
// tsconfig-path tooling. `GATE_PATH` is the single source of truth for the
// route — never hardcode '/gate' or re-derive the gate token here.
import { GATE_PATH } from '../lib/access-gate';
import { APP_HOME_PATH } from '../lib/constants';

/**
 * Drive the real access-gate form to authenticate a page. Used by the Playwright
 * `setup` project (to mint a reusable `storageState`) and by the screenshot
 * script — one helper, two consumers. Driving the actual form (rather than
 * injecting a cookie) keeps this an honest smoke of the gate itself.
 *
 * ⚠️ **The file is `login.ts`, not `gate-login.ts`, on purpose (AUTH-1 1c-pre).** The export keeps
 * the `gate` in its name because that is what it drives; the MODULE does not, because at 1c it also
 * held a session helper and at 1d the gate half is deleted. A name that is true in all three worlds
 * costs one rename now instead of one inside 1c's one-way-door PR and another inside 1d's.
 *
 * ⚠️ **1c-pre promised a `sessionLogin` here. 1c-3a RETRACTS that promise rather than keeping it**,
 * and the reason is that the seam turned out to live a layer lower. The session bypass is an
 * **environment variable** (`apps/web/lib/env.ts`), so every request in a harness run is already
 * authenticated — a per-page login helper would have nothing to do, and a helper that does nothing
 * is worse than no helper, because the next reader assumes it is load-bearing.
 *
 * 🔴 **The other half of that panel finding still stands, and is why `@clerk/testing` is NOT here.**
 * A combined `login()` would have to branch on ambient env — the same branch moved out of sight —
 * and it would drag `@clerk/testing` into `capture.ts`'s module graph, breaking the offline,
 * no-credential property that is the whole reason `screenshot:ephemeral` exists. The bypass keeps
 * that property by never introducing the dependency at all.
 * _(1c-pre panel, 2026-10-22, docs/plans/auth-1c-pre-login-seam.md; retraction 1c-3a, 2026-10-29.)_
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
  // AUTH-1 1c-2: ANY `<h1>`, not the picker's specific one — this asserts "a page rendered", which is
  // what this helper can honestly promise now that the picker is not the only screen a successful
  // login lands on. It still catches the hard failure: `app/error.tsx` renders an `<h2>`.
  //
  // 🔴 **The reason is the SCREENSHOT HARNESS, not the health check.** `scripts/capture.ts` calls
  // `gateLogin` once per viewport BEFORE `page.goto(route)`, so while this demanded the picker's
  // heading, `screenshot:ephemeral --state no-household` could not get past login at all — the one
  // state that has no picker. Saying so matters, because "we loosened an assertion" invites a revert.
  //
  // ⚠️ **The picker assertion did NOT disappear — it moved to `e2e/global.setup.ts`**, the one
  // consumer that actually needs the picker (it goes on to `selectProfile`). Leaving it only here
  // would have been strictly worse: a deploy where household resolution silently broke would render
  // the no-household `<h1>`, satisfy this line, and first fail as a `selectProfile` timeout on a
  // missing tile — a confusing failure a long way from its cause. The specs that need the picker
  // keep asserting `pickerHeading` too.
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}
