import { PROFILE_KIND, PROFILE_KIND_LABELS } from '@mat-plan/shared';
import { expect, test } from '@playwright/test';

import {
  ADD_ATHLETE_PATH,
  ATHLETE_FORM_COPY,
  SETTINGS_COPY,
  SETTINGS_PATH,
} from '../lib/constants';
import { archiveAdded } from './steps';

/**
 * **A form tapped before the page hydrates still reaches its Server Action** (plan
 * td-form-before-hydration). The app's chunks are aborted, so React never mounts and the submit is
 * the browser's own POST. Under `Referrer-Policy: no-referrer` every browser sent it with
 * `Origin: null`, and Next's Server Action check answered 500 (`Invalid Server Actions request.`).
 *
 * ⚠️ **Its own file, not `athletes.spec.ts`, because of the household cap.** That file runs serial,
 * and a serial retry re-runs all of it: its nine adds plus this one would pass
 * `MAX_HOUSEHOLD_ATHLETES` (archiving frees no slot). Here a retry costs one slot.
 *
 * ⚠️ **The proof rests on the chunk glob.** If a Next upgrade moved the chunks off
 * `/_next/static/chunks/`, the page would hydrate and submit by `fetch`, so the test also asserts the
 * POST was a navigation without a `next-action` header, i.e. the native submit.
 */
const CHUNKS = '**/_next/static/chunks/**';
const added: string[] = [];

test.afterEach(async ({ page }) => {
  test.setTimeout(90_000);
  await page.unroute(CHUNKS);
  await archiveAdded(page, added.splice(0));
});

test('an add submitted before the page hydrates is saved and lands on the day page', async ({
  page,
}, testInfo) => {
  const name = `Unhydrated ${testInfo.workerIndex} r${testInfo.retry} ${Date.now().toString(36)}`;
  await page.route(CHUNKS, (route) => route.abort());
  await page.goto(ADD_ATHLETE_PATH);
  await page
    .getByRole('radio', { name: new RegExp(`^${PROFILE_KIND_LABELS[PROFILE_KIND.kid]}`) })
    .check();
  await page.getByLabel(ATHLETE_FORM_COPY.nameLabel).fill(name);
  added.push(name);

  const answered = page.waitForResponse(
    (res) => res.request().method() === 'POST' && new URL(res.url()).pathname === ADD_ATHLETE_PATH,
  );
  await page.getByRole('button', { name: ATHLETE_FORM_COPY.add, exact: true }).click();
  const res = await answered;
  expect(res.request().isNavigationRequest(), 'the browser’s own submit, not a fetch').toBe(true);
  expect(res.request().headers()['next-action'], 'no next-action header: native').toBeUndefined();
  expect(res.status(), 'the action ran and redirected (main answered 500)').toBe(303);

  // Still unhydrated: the server-rendered day page names the athlete.
  await page.waitForURL(/\/p\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1, name, exact: true })).toBeVisible();

  await page.unroute(CHUNKS);
  await page.goto(SETTINGS_PATH, { waitUntil: 'networkidle' });
  await expect(
    page.getByRole('button', { name: SETTINGS_COPY.archiveFor(name), exact: true }),
  ).toHaveCount(1);
});
