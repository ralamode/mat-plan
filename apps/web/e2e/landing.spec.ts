import { expect, test, type Page, type Request } from '@playwright/test';

import { PUBLIC_PATHS } from '../lib/public-paths';
import {
  APP_NAME,
  FOOTER_COPY,
  GITHUB_REPO_URL,
  LANDING_COPY,
  PICKER_COPY,
  ROUTINE_COPY,
  SIGN_IN_PATH,
} from '../lib/constants';

import { MOBILE_VIEWPORT } from './contexts';
import { SEED_PROFILE_ROUTE } from './steps';

/**
 * OSS-2 §A — the public landing at `/`.
 *
 * ⚠️ **`storageState: NO_GATE_STATE` is gone from every case here (AUTH-1 1d), and nothing replaces
 * it.** It was an empty cookie jar, which kept the project's gate cookie from leaking in and making
 * a gated page look public. The harness session is now an environment variable read before the
 * server boots, so no browser context can be unauthenticated — see `e2e/contexts.ts`. These cases
 * therefore assert what the PAGE renders, never "a stranger sees this".
 */

test.describe('public', () => {
  test.use({ viewport: MOBILE_VIEWPORT });

  test('/ is the landing, with both CTAs above the fold', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL('/');
    await expect(
      page.getByRole('heading', { level: 1, name: APP_NAME, exact: true }),
    ).toBeVisible();
    await expect(page.getByText(LANDING_COPY.lead, { exact: true })).toBeVisible();

    const source = page.getByRole('link', { name: LANDING_COPY.sourceCta, exact: true });
    const signIn = page.getByRole('link', { name: LANDING_COPY.signInCta, exact: true });
    await expect(source).toHaveAttribute('href', `${GITHUB_REPO_URL}${LANDING_COPY.sourceAnchor}`);
    // Before any scroll: a stranger on a phone sees what they can do without hunting for it.
    await expect(source).toBeInViewport();
    await expect(signIn).toBeInViewport();
  });

  // 🔴 **The successor to "sign-in leads to the gate, which links back" (AUTH-1 1d).** The CTA now
  // points at `/sign-in` instead of `/gate`, and the way back is the mark rather than a text link —
  // the sign-in screen hides `SiteFooter` and carries its own copies of both links, so this is also
  // the round-trip proof for that decision.
  test('Household sign-in leads to /sign-in, which links back', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: LANDING_COPY.signInCta, exact: true }).click();
    await expect(page).toHaveURL(SIGN_IN_PATH);
    // The mark's SVG is aria-hidden, so the link's accessible name is its sr-only text.
    await page.getByRole('link', { name: FOOTER_COPY.home, exact: true }).click();
    await expect(page).toHaveURL('/');
  });

  // ⚠️ **"the app itself is still gated" was DELETED at 1d, not repointed.** It asserted that
  // `/p` redirected to `/gate?from=…`. After 1d the equivalent claim is "`/p` redirects to
  // `/sign-in`", which this harness CANNOT establish: the bypass principal is armed process-wide,
  // so `/p` legitimately renders the picker here. Asserting the redirect would require a second,
  // un-bypassed server — recorded in `tech-debt.md` rather than faked with an empty cookie jar.
});

test.describe('authenticated', () => {
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
    await expect(
      page.getByRole('link', { name: LANDING_COPY.signInCta, exact: true }),
    ).toBeVisible();
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
 * `/` is an unauthenticated POST endpoint too: Server Actions post to the current URL, and Next
 * forwards an action id the page doesn't own to the page that does. Capture a real action request
 * (the routine editor's Save) — aborted, so it never runs — then replay it to every public path with
 * a spoofed `x-action-forwarded: 1`, which makes Next skip forwarding and look in that page's OWN
 * action map. That map must be empty: `pages-are-gated.test.ts` keeps it so statically, and this
 * proves it at runtime.
 *
 * 🔴 **`1d` DELETED variant 1, and this is a real loss of coverage, stated rather than papered over.**
 * The replay used to run twice: as-is, and spoofed. The as-is arm relied on Next forwarding the
 * request onward to `/p/…/routine`, whose internal fetch then "meets the proxy WITHOUT a cookie" —
 * i.e. **the gate bounce was that arm's only protection**. After `1d` that fetch is
 * bypass-authenticated, so the Save action genuinely runs and the tail assertion below would go red.
 * Deleting the arm is correct; pretending nothing was lost would not be.
 *
 * ⚠️ **Production is still protected** — by the in-action `requireSession()`, unit-proved in
 * `app/p/[profileId]/actions.test.ts`. What is gone is the RUNTIME proof of it, and `tech-debt.md`
 * carries that in the same row as the deferred un-bypassed server, because both halves of this
 * evidence went in one diff. ⚠️ Do not cite "no unauthenticated request does DB work" as a runtime
 * property of this suite any more.
 *
 * What survives pins: nothing runs, nothing leaks, nothing changes. An `"ok":` of either value in the
 * body would mean the action ran.
 */
test('a forwarded-spoofed POST to a public path with a real action id runs nothing and leaks nothing', async ({
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

  // ⚠️ A plain context, not an empty cookie jar: the bypass principal is process-wide, so "anon"
  // would be a lie. The spoofed header, not the absence of a cookie, is what this proves.
  const replayCtx = await browser.newContext();
  const variants: Record<string, string>[] = [{ 'x-action-forwarded': '1' }];
  // Every public path, not just `/` (PRIV-2): each one is an unauthenticated POST endpoint on the
  // same terms, so a new entry in `PUBLIC_PATHS` inherits this runtime proof instead of needing a
  // new test that nobody writes.
  for (const publicPath of PUBLIC_PATHS) {
    for (const extra of variants) {
      const label = `${publicPath} spoofed-forwarded replay`;
      const res = await replayCtx.request.post(publicPath, {
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
  await replayCtx.close();

  // Changes nothing: a fresh load still has the original order.
  await page.unroute(routine);
  await page.goto(routine, { waitUntil: 'networkidle' });
  expect(await routineOrder(page)).toEqual(before);
});
