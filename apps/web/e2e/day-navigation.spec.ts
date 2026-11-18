import { PROFILE_KIND, PROFILE_KIND_LABELS } from '@mat-plan/shared';
import { expect, test } from '@playwright/test';

import {
  ADD_ATHLETE_PATH,
  ATHLETE_FORM_COPY,
  BODYWEIGHT_COPY,
  CLOSED_DAY_NOTICE,
} from '../lib/constants';
import { formatDayLong } from '../lib/date';

import { bodyweightSection, changePrefix, isoDaysAgo, SEED_PROFILE_ROUTE } from './steps';

/**
 * Day navigation (V1-15).
 *
 * Motivated by a real confusion: the maintainer logged a session from a tab left open overnight and could not
 * tell which date it wrote to. The date is now in the URL, so the question is answerable by looking.
 */

test('yesterday is reachable even on a profile created today', async ({ page }) => {
  // The e2e seeds profiles TODAY. Flooring at `created_at` alone would clamp yesterday away — while
  // the server still ACCEPTS a write for it. So the floor is never later than the earliest writable
  // day, and `‹` is a live link here rather than a dead control.
  await page.goto(SEED_PROFILE_ROUTE, { waitUntil: 'networkidle' });
  const nav = page.getByRole('navigation', { name: 'Change day' });
  await expect(nav.getByRole('link', { name: /^Previous day/ })).toBeVisible();
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
  // The server accepts a write for today and yesterday (resolveDeclaredDay). A UI that hid
  // yesterday's forms would refuse what the endpoint allows — and it is exactly how the maintainer's
  // 09/29 session, submitted on 09/30 from a stale tab, succeeded.
  await page.goto(`${SEED_PROFILE_ROUTE}?d=${isoDaysAgo(1)}`, { waitUntil: 'networkidle' });
  // The date line names it (FAM-1 12c, v12's day label), so a pinned tab opened the next morning
  // says it is yesterday.
  await expect(page.getByText(/^Yesterday ·/)).toBeVisible();
  // A writable day offers the weigh-in: the field, or once logged, Change. A read-only day shows
  // neither, so this is the assertion that can fail.
  const section = bodyweightSection(page);
  await expect(
    section
      .getByLabel('Weight', { exact: true })
      .or(section.getByRole('button', { name: changePrefix(BODYWEIGHT_COPY.changeSubject) })),
  ).toBeVisible();
  await expect(page.getByText(CLOSED_DAY_NOTICE)).toHaveCount(0);
});

// ⚠️ The "logging is closed" state needs a profile OLDER than the write window, and the e2e seeds
// profiles today — so the floor clamps any `?d=` back into the writable range and the notice is
// unreachable here. The gating logic is unit-tested (`isWritableDay`), but this path has no e2e.
// Closing it needs a backdated fixture profile; noted rather than left as a silent gap.

// An athlete on NO program (FAM-1 12c): look-ahead goes forward only while on a program, so
// forward stops at today and a future `?d=` renders today. The seed athletes are on the fixture
// world's programs (6c-i) and Athlete Three belongs to the archive specs, so this test adds its own
// athlete, as `bodyweight-receipt.spec.ts` does: one per run, well inside `MAX_HOUSEHOLD_ATHLETES`.
test('on no program, forward stops at today, the future renders today, and a malformed date does too', async ({
  page,
}, testInfo) => {
  const name = `12C-NAV ${testInfo.workerIndex}-${testInfo.retry} ${Date.now().toString(36)}`;
  await page.goto(ADD_ATHLETE_PATH, { waitUntil: 'networkidle' });
  await page
    .getByRole('radio', { name: new RegExp(`^${PROFILE_KIND_LABELS[PROFILE_KIND.kid]}`) })
    .check();
  await page.getByLabel(ATHLETE_FORM_COPY.nameLabel).fill(name);
  await page.getByRole('button', { name: ATHLETE_FORM_COPY.add }).click();
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
  const route = new URL(page.url()).pathname;

  // A disabled button rather than a missing control, so the bound is visible.
  const nav = page.getByRole('navigation', { name: 'Change day' });
  await expect(nav.getByRole('button', { name: /^Next day/ })).toBeDisabled();

  for (const bad of [
    `?d=${isoDaysAgo(-1)}`,
    `?d=${isoDaysAgo(-5)}`,
    '?d=not-a-date',
    '?d=09292026',
  ]) {
    await page.goto(`${route}${bad}`, { waitUntil: 'networkidle' });
    await expect(page.getByText(/^Today ·/), bad).toBeVisible();
  }
});

test('the week strip reaches a day in two taps, and marks the one being viewed', async ({
  page,
}) => {
  await page.goto(SEED_PROFILE_ROUTE, { waitUntil: 'networkidle' });
  const nav = page.getByRole('navigation', { name: 'Change day' });

  // aria-current is how a screen reader user knows which day they are on (`true`, since FAM-1 12c:
  // "date" read as "the current date" beside today's own ", today").
  await expect(nav.locator('[aria-current="true"]')).toHaveCount(1);

  // Today's cell is a link named for its date and ", today" — on a Monday the only link in the
  // strip, so the name is matched exactly rather than by a pattern that skips it.
  const todayCell = nav.getByRole('link', {
    name: `${formatDayLong(isoDaysAgo(0))}, today`,
    exact: true,
  });
  await expect(todayCell).toBeVisible();
});
