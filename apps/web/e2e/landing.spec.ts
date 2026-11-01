import { expect, test, type Page, type Request } from '@playwright/test';

import { GATE_PATH } from '../lib/access-gate';
import { PUBLIC_PATHS } from '../lib/public-paths';
import {
  APP_HOME_PATH,
  APP_NAME,
  GATE_COPY,
  GITHUB_REPO_URL,
  LANDING_COPY,
  PICKER_COPY,
  ROUTINE_COPY,
} from '../lib/constants';

import { MOBILE_VIEWPORT, NO_GATE_STATE, pickerHeading } from './contexts';
import { SEED_PROFILE_ROUTE } from './steps';

/**
 * OSS-2 §A — the public landing at `/`. The un-gated cases run in a context with NO storage state, so the
 * project's gate cookie cannot leak in and make a gated page look public.
 */

test.describe('un-gated', () => {
  test.use({ storageState: NO_GATE_STATE, viewport: MOBILE_VIEWPORT });

  test('/ is the landing, with both CTAs above the fold', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL('/');
    await expect(
      page.getByRole('heading', { level: 1, name: APP_NAME, exact: true }),
    ).toBeVisible();
    await expect(page.getByText(LANDING_COPY.lead, { exact: true })).toBeVisible();

    const source = page.getByRole('link', { name: LANDING_COPY.sourceCta, exact: true });
    const signIn = page.getByRole('link', { name: LANDING_COPY.gateCta, exact: true });
    await expect(source).toHaveAttribute('href', `${GITHUB_REPO_URL}${LANDING_COPY.sourceAnchor}`);
    // Before any scroll: a stranger on a phone sees what they can do without hunting for it.
    await expect(source).toBeInViewport();
    await expect(signIn).toBeInViewport();
  });

  test('Household sign-in leads to the gate, which links back', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: LANDING_COPY.gateCta, exact: true }).click();
    await expect(page).toHaveURL(GATE_PATH);
    // The arrow is aria-hidden, so the link's accessible name is the copy alone.
    await page.getByRole('link', { name: GATE_COPY.back, exact: true }).click();
    await expect(page).toHaveURL('/');
  });

  test('the app itself is still gated', async ({ page }) => {
    await page.goto(APP_HOME_PATH);
    await expect(page).toHaveURL(`${GATE_PATH}?from=${encodeURIComponent(APP_HOME_PATH)}`);
  });
});

test.describe('gated', () => {
  /**
   * 🔴 **Inverted by AUTH-1 1c-3b, and the inversion is the regression guard.** The proxy used to
   * forward a cookie-holder from `/` to the picker. Once the pages also require a session that
   * became a loop — `/p` → `requireSession()` → `/sign-in`, whose forward controls lead back here —
   * and it meant a visitor holding only the gate cookie could never see the landing at all.
   *
   * ⚠️ Asserted as "the landing renders", not "a sessionless visitor sees the landing": the harness
   * arms a principal process-wide (1c-3a), so no spec here can establish "no session". The proxy
   * reads no session either way, so this still catches the regression it is named for.
   */
  test('/ renders the landing — no forward to the picker', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL('/');
    await expect(page.getByRole('link', { name: LANDING_COPY.gateCta, exact: true })).toBeVisible();
  });

  test('the gate stays reachable — the access code is still one of two requirements', async ({
    page,
  }) => {
    // Until 1d a visitor needs the code AND a session, so the form must not become unreachable for
    // someone who has one and not the other.
    await page.goto(GATE_PATH);
    await expect(page).toHaveURL(GATE_PATH);
  });
});

/** The routine's labels, in order — the whole routine, not just one row. */
async function routineOrder(page: Page): Promise<string[]> {
  const items = page
    .getByRole('region', { name: ROUTINE_COPY.orderHeading, exact: true })
    .getByRole('listitem');
  await expect(items.first()).toBeVisible();
  return items.evaluateAll((lis) => lis.map((li) => li.querySelector('span')?.textContent ?? ''));
}

/**
 * `/` is now an unauthenticated POST endpoint too: Server Actions post to the current URL, and Next
 * forwards an action id the page doesn't own to the page that does. Capture a real action request (the
 * routine editor's Save) from a gated session — aborted, so it never runs — then replay it to `/` with no
 * cookie, twice:
 *
 *  1. as-is → Next forwards it to `/p/…/routine`, whose internal fetch meets the proxy without a cookie;
 *  2. with a spoofed `x-action-forwarded: 1` → Next skips forwarding and looks in `/`'s OWN action map,
 *     which must be empty (`pages-are-gated.test.ts` keeps it so statically; this proves it at runtime).
 *
 * Neither reaches the action, so this does NOT exercise the action's own `hasGateAccess()` — that is
 * proven at the unit level (`app/p/[profileId]/actions.test.ts`). What it pins: nothing runs, nothing
 * leaks, nothing changes. An `"ok":` of either value in the body would mean the action ran.
 */
test('an un-gated POST to a public path with a real action id runs nothing and leaks nothing', async ({
  page,
  browser,
}) => {
  const routine = `${SEED_PROFILE_ROUTE}/routine`;
  await page.goto(routine, { waitUntil: 'networkidle' });
  const before = await routineOrder(page);

  let captured: Request | null = null;
  await page.route(routine, async (route) => {
    const request = route.request();
    if (request.method() === 'POST' && request.headers()['next-action']) {
      captured = request;
      await route.abort();
    } else {
      await route.continue();
    }
  });
  await page.getByRole('button', { name: `Move ${before[0]} down`, exact: true }).click();
  await page.getByRole('button', { name: ROUTINE_COPY.save, exact: true }).click();
  await expect.poll(() => captured).not.toBeNull();
  const request = captured as unknown as Request;
  const headers = request.headers();

  const anon = await browser.newContext({ storageState: NO_GATE_STATE });
  const variants: Record<string, string>[] = [{}, { 'x-action-forwarded': '1' }];
  // Every public path, not just `/` (PRIV-2): each one is an unauthenticated POST endpoint on the
  // same terms, so a new entry in `PUBLIC_PATHS` inherits this runtime proof instead of needing a
  // new test that nobody writes.
  for (const publicPath of PUBLIC_PATHS) {
    for (const extra of variants) {
      const label = `${publicPath}${Object.keys(extra).length > 0 ? ' spoofed-forwarded replay' : ' replay'}`;
      const res = await anon.request.post(publicPath, {
        headers: {
          'next-action': headers['next-action']!,
          'content-type': headers['content-type']!,
          accept: 'text/x-component',
          ...extra,
        },
        data: request.postDataBuffer() ?? undefined,
        maxRedirects: 0,
      });
      const body = await res.text();
      expect(body, `${label}: the action ran`).not.toMatch(/"ok":(true|false)/);
      for (const leak of [' at ', 'node_modules', '/apps/web/', PICKER_COPY.heading]) {
        expect(body, `${label} leaks "${leak}"`).not.toContain(leak);
      }
    }
  }
  await anon.close();

  // Changes nothing: a fresh gated load still has the original order.
  await page.unroute(routine);
  await page.goto(routine, { waitUntil: 'networkidle' });
  expect(await routineOrder(page)).toEqual(before);
});
