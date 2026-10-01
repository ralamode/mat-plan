import { expect, test } from '@playwright/test';

import { CLOSED_DAY_NOTICE } from '../lib/constants';

import { isoDaysAgo, SEED_PROFILE_ROUTE } from './steps';

/**
 * Day navigation (V1-15).
 *
 * Motivated by a real confusion: Ray logged a session from a tab left open overnight and could not
 * tell which date it wrote to. The date is now in the URL, so the question is answerable by looking.
 */

test('yesterday is reachable even on a profile created today', async ({ page }) => {
  // The e2e seeds profiles TODAY. Flooring at `created_at` alone would clamp yesterday away — while
  // the server still ACCEPTS a write for it. So the floor is never later than the earliest writable
  // day, and `‹` is a live link here rather than a dead control.
  await page.goto(SEED_PROFILE_ROUTE, { waitUntil: 'networkidle' });
  const nav = page.getByRole('navigation', { name: 'Change day' });
  await expect(nav.getByRole('link', { name: /^Previous day/ })).toBeVisible();
  // Forward IS at its bound on today — the future is never reachable, and it says so as a disabled
  // button rather than a missing control.
  await expect(nav.getByRole('button', { name: /^Next day/ })).toBeDisabled();
});

test('a dated URL renders that day, and paging forward from it returns toward today', async ({
  page,
}) => {
  // `?d=` is the feature: the day is IN THE ADDRESS, so "which date did this log to?" is answerable
  // by looking rather than by reasoning about when the tab was opened.
  await page.goto(`${SEED_PROFILE_ROUTE}?d=${isoDaysAgo(1)}`, { waitUntil: 'networkidle' });

  const nav = page.getByRole('navigation', { name: 'Change day' });
  await nav.getByRole('link', { name: /^Next day/ }).click();
  await page.waitForURL((u) => !u.searchParams.has('d'));

  // Back on today, the canonical URL carries no `?d=` at all.
  await expect(page.getByText(/^Today ·/)).toBeVisible();
});

test('yesterday KEEPS its forms — the UI must not be stricter than the server', async ({
  page,
}) => {
  // The server accepts a write within ±1 day (resolveDeclaredDay). A UI that hid yesterday's forms
  // would refuse what the endpoint allows — and it is exactly how Ray's 09/29 session, submitted on
  // 09/30 from a stale tab, succeeded.
  await page.goto(`${SEED_PROFILE_ROUTE}?d=${isoDaysAgo(1)}`, { waitUntil: 'networkidle' });
  await expect(page.getByRole('region', { name: 'Log strength' })).toBeVisible();
  await expect(page.getByText(CLOSED_DAY_NOTICE)).toHaveCount(0);
});

// ⚠️ The "logging is closed" state needs a profile OLDER than the write window, and the e2e seeds
// profiles today — so the floor clamps any `?d=` back into the writable range and the notice is
// unreachable here. The gating logic is unit-tested (`isWritableDay`), but this path has no e2e.
// Closing it needs a backdated fixture profile; noted rather than left as a silent gap.

test('the future is clamped, and a malformed date renders today rather than 404ing', async ({
  page,
}) => {
  for (const bad of [`?d=${isoDaysAgo(-5)}`, '?d=not-a-date', '?d=09292026']) {
    await page.goto(`${SEED_PROFILE_ROUTE}${bad}`, { waitUntil: 'networkidle' });
    await expect(page.getByText(/^Today ·/)).toBeVisible();
  }
});

test('the week strip reaches a day in two taps, and marks the one being viewed', async ({
  page,
}) => {
  await page.goto(SEED_PROFILE_ROUTE, { waitUntil: 'networkidle' });
  const nav = page.getByRole('navigation', { name: 'Change day' });

  // aria-current="date" is how a screen reader user knows which day they are on.
  await expect(nav.locator('[aria-current="date"]')).toHaveCount(1);

  const yesterday = nav.getByRole('link', { name: /^\w+day, \w+ \d+, \d{4}$/ });
  await expect(yesterday.first()).toBeVisible();
});
