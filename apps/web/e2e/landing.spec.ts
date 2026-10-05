import { expect, test, type Request } from '@playwright/test';

import { GATE_PATH } from '../lib/access-gate';
import {
  APP_HOME_PATH,
  APP_NAME,
  GITHUB_REPO_URL,
  LANDING_COPY,
  PICKER_COPY,
} from '../lib/constants';

import { SEED_PROFILE_ROUTE } from './steps';

/**
 * OSS-2 §A — the public landing at `/`. The un-gated cases run in a context with NO storage state, so the
 * project's gate cookie cannot leak in and make a gated page look public.
 */

test.describe('un-gated', () => {
  test.use({ storageState: { cookies: [], origins: [] }, viewport: { width: 390, height: 844 } });

  test('/ is the landing, with both CTAs above the fold', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL('/');
    await expect(
      page.getByRole('heading', { level: 1, name: APP_NAME, exact: true }),
    ).toBeVisible();
    await expect(page.getByText(LANDING_COPY.lead)).toBeVisible();

    const source = page.getByRole('link', { name: LANDING_COPY.sourceCta });
    const signIn = page.getByRole('link', { name: LANDING_COPY.gateCta });
    await expect(source).toHaveAttribute('href', `${GITHUB_REPO_URL}${LANDING_COPY.sourceAnchor}`);
    // Before any scroll: a stranger on a phone sees what they can do without hunting for it.
    await expect(source).toBeInViewport();
    await expect(signIn).toBeInViewport();
  });

  test('Household sign-in leads to the gate, which links back', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: LANDING_COPY.gateCta }).click();
    await expect(page).toHaveURL(`${GATE_PATH}?from=${encodeURIComponent(APP_HOME_PATH)}`);
    await page.getByRole('link', { name: /About/ }).click();
    await expect(page).toHaveURL('/');
  });

  test('the app itself is still gated', async ({ page }) => {
    await page.goto(APP_HOME_PATH);
    await expect(page).toHaveURL(`${GATE_PATH}?from=${encodeURIComponent(APP_HOME_PATH)}`);
  });
});

test.describe('gated', () => {
  test('/ goes straight to the picker', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(APP_HOME_PATH);
    await expect(
      page.getByRole('heading', { level: 1, name: PICKER_COPY.heading, exact: true }),
    ).toBeVisible();
  });
});

/**
 * `/` is now an unauthenticated POST endpoint too: Server Actions post to the current URL, and Next's
 * action map is global, so an action id from ANY page can be sent to `/`. Capture a real action request
 * (the routine editor's Save) from a gated session — aborted, so it never runs — then replay it to `/`
 * with no cookie. It must change nothing and leak nothing.
 */
test('an un-gated POST to / with a real action id neither mutates nor leaks', async ({
  page,
  browser,
}) => {
  const routine = `${SEED_PROFILE_ROUTE}/routine`;
  await page.goto(routine, { waitUntil: 'networkidle' });
  // The labels, in order — the whole routine, not just its first row.
  const labels = page.getByRole('list').first().getByRole('listitem').locator('span').first();
  const order = () =>
    page
      .getByRole('list')
      .first()
      .getByRole('listitem')
      .evaluateAll((lis) => lis.map((li) => li.querySelector('span')?.textContent ?? ''));
  await expect(labels).toBeVisible();
  const before = await order();

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
  await page
    .getByRole('button', { name: /^Move .* down$/ })
    .first()
    .click();
  await page.getByRole('button', { name: 'Save routine' }).click();
  await expect.poll(() => captured).not.toBeNull();
  const request = captured as unknown as Request;
  const headers = request.headers();

  const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const res = await anon.request.post('/', {
    headers: {
      'next-action': headers['next-action']!,
      'content-type': headers['content-type']!,
      accept: 'text/x-component',
    },
    data: request.postDataBuffer() ?? undefined,
    maxRedirects: 0,
  });
  const body = await res.text();
  await anon.close();

  // Observed on next@16.3.7: a 200 with an empty JSON body (`{}`) — the forwarded action meets the gate
  // and never runs. Asserted as properties, not that exact body, so a Next upgrade can't redden it
  // without a real regression. Never the action's own success envelope:
  expect(body).not.toContain('"ok":true');
  // Leaks nothing: no stack frame, no source path, no app content.
  for (const leak of [' at ', 'node_modules', '/apps/web/', PICKER_COPY.heading]) {
    expect(body, `response leaks "${leak}"`).not.toContain(leak);
  }

  // Changes nothing: a fresh gated load still has the original order.
  await page.unroute(routine);
  await page.goto(routine, { waitUntil: 'networkidle' });
  await expect(labels).toBeVisible();
  expect(await order()).toEqual(before);
});
