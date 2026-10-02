import { expect, test } from '@playwright/test';

import { PARTIAL_SETS_COPY } from '../lib/constants';

import { openStrengthForm, SEED_PROFILE_ROUTE, strengthSection } from './steps';

/**
 * **V1-26 PR-A — the submit wedge, in a real browser.**
 *
 * The scenario the whole design avoids: scaffold the day's movements, do SOME of them, submit. The
 * failure mode is that a scaffolded card the athlete never touched survives `dropUntouchedMovements`,
 * stays COLLAPSED — which UNMOUNTS its `required` reps input — and the browser refuses the submit with
 * a validation error it cannot render, because the field it is complaining about is not on screen.
 * The form simply appears dead.
 *
 * ⚠️ **jsdom cannot catch this.** `strength-form.test.tsx` asserts the same thing through `payload()`,
 * which never runs native constraint validation. Only a real browser refuses the submit. That is why
 * this spec exists alongside the unit test rather than instead of it.
 *
 * PR-A's specific risk: seeding the movement's declaration onto scaffolded cards. `isUntouchedScaffold`
 * requires `!s.isBodyweight`, so a pre-tapped BW chip would make every scaffolded card permanently
 * "touched" and re-open this exact wedge. PR-A carries the declaration on the UNIT instead — which is
 * visible, overridable, and outside that predicate — and this is the test that proves it stayed closed.
 */
test('scaffold the day, do some of it, and the form still submits', async ({ page }) => {
  await page.goto(SEED_PROFILE_ROUTE, { waitUntil: 'networkidle' });
  // A before/after DELTA, not an absolute count: a retry after a write-then-fail attempt would see the
  // first attempt's rows too, and an absolute `toHaveCount(openSets)` would then fail forever.
  const logged = page.getByRole('region', { name: 'Logged entries' }).getByText(/^8 × 20 lb$/);
  const before = await logged.count();

  const strength = strengthSection(page);
  await openStrengthForm(page);
  await strength.getByRole('button', { name: /Fill in today.s movements/i }).click();

  // The YDP programs 6-7 movements a day, so this is the real shape: several cards, one open, the
  // rest collapsed with their required inputs unmounted.
  const cards = strength.getByRole('button', { name: /^\d+\.\s/ });
  const collapsed = await cards.count();
  expect(collapsed, 'the scaffold should leave several collapsed cards').toBeGreaterThan(1);

  // Do the OPEN card completely, and leave every collapsed card untouched. That is the shape the
  // plan's acceptance criterion names — some movements done, the rest not — and it is the one PR-A
  // could regress.
  //
  // Every set row of the open card is filled here on purpose: this test is about MOVEMENTS. Doing only
  // SOME of a card's sets — V1-27, found by an earlier draft of this test — is pinned by the
  // "2 of 3 sets" test below, in a real browser.
  const repsFields = strength.getByPlaceholder('reps');
  const weightFields = strength.getByPlaceholder('weight');
  const openSets = await repsFields.count();
  for (let i = 0; i < openSets; i++) {
    await repsFields.nth(i).fill('8');
    await weightFields.nth(i).fill('20');
  }

  const submit = strength.getByRole('button', { name: 'Log strength' });
  await submit.click();

  // The assertion is that the write HAPPENED, and that EVERY set of the open card landed. A wedged
  // form fails silently — the button returns to its resting state and nothing is written — so
  // asserting the button, or the absence of an error, would pass on the very bug this test is for.
  await expect(logged).toHaveCount(before + openSets, { timeout: 15_000 });
});

/**
 * The declared unit is VISIBLE, which is the argument for carrying the declaration there rather than
 * on a pre-tapped chip: the athlete can see what the form assumed and change it.
 */
test('a scaffolded card shows the unit the catalog declares', async ({ page }) => {
  await page.goto(SEED_PROFILE_ROUTE, { waitUntil: 'networkidle' });

  const strength = strengthSection(page);
  await openStrengthForm(page);
  await strength.getByRole('button', { name: /Fill in today.s movements/i }).click();

  // Whichever movement card 1 holds — the YDP rotates on date parity, so the name is not fixed — its
  // unit must be a real, selected option rather than the blank a stale `unit_default` would produce.
  const unit = strength.getByLabel(/Unit for movement 1/);
  await expect(unit).toBeVisible();
  expect(await unit.inputValue()).not.toBe('');

  // And no set arrives pre-tapped: the flags are the wedge, and this asserts it at the DOM rather
  // than through the scaffold's return value.
  await expect(
    strength.getByRole('checkbox', { name: 'BW — Bodyweight — movement 1 set 1' }),
  ).not.toBeChecked();
});

/**
 * **V1-27 — doing some of a movement's sets submits, in a real browser.** Native constraint validation
 * is the whole bug (a `required` reps input on the row the athlete deliberately left blank), and jsdom
 * never runs it — so this is the only place the fix is proven.
 *
 * Retry-safe and neighbour-safe: values distinct from the test above (`7 × 17.5`), and the assertion is
 * a before/after DELTA on the logged entries rather than an absolute count.
 */
test("doing all but the last of a card's sets submits exactly those sets (V1-27)", async ({
  page,
}) => {
  await page.goto(SEED_PROFILE_ROUTE, { waitUntil: 'networkidle' });
  const logged = page.getByRole('region', { name: 'Logged entries' }).getByText(/^7 × 17\.5\b/);
  const before = await logged.count();

  const strength = strengthSection(page);
  await openStrengthForm(page);
  await strength.getByRole('button', { name: /Fill in today.s movements/i }).click();

  // The scaffold's row count depends on the day's prescription, so it is READ, not assumed.
  const repsFields = strength.getByPlaceholder('reps');
  const weightFields = strength.getByPlaceholder('weight');
  const n = await repsFields.count();
  expect(n, 'card 1 needs at least 2 rows for a trailing empty row').toBeGreaterThan(1);
  for (let i = 0; i < n - 1; i++) {
    await repsFields.nth(i).fill('7');
    await weightFields.nth(i).fill('17.5');
  }
  // The line above the button says what will be logged, before the tap.
  await expect(
    strength.getByText(`Logs 1 movement, ${n - 1} ${n - 1 === 1 ? 'set' : 'sets'}.`),
  ).toBeVisible();
  await expect(strength.getByText(PARTIAL_SETS_COPY.trailingHint)).toBeVisible();

  await strength.getByRole('button', { name: 'Log strength' }).click();
  await expect(logged).toHaveCount(before + n - 1, { timeout: 15_000 });
});

/**
 * A half-entered set still blocks — NATIVELY, with the named message. Asserted on the field and on the
 * network, never on "nothing was written": the server would reject this set too, so a test that only
 * checked the outcome could not tell the browser's block from the server's (correctness panel cor-S2).
 */
test('a half-entered set blocks natively, with a message naming the way out (V1-27)', async ({
  page,
}) => {
  await page.goto(SEED_PROFILE_ROUTE, { waitUntil: 'networkidle' });
  const strength = strengthSection(page);
  await openStrengthForm(page);
  await strength.getByRole('button', { name: /Fill in today.s movements/i }).click();

  const actionRequests: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.headers()['next-action']) actionRequests.push(r.url());
  });

  // Weight typed, reps blank: the row is touched, so its reps stay required.
  const reps = strength.getByPlaceholder('reps').first();
  await strength.getByPlaceholder('weight').first().fill('17.5');
  await strength.getByRole('button', { name: 'Log strength' }).click();

  expect(await reps.evaluate((el) => (el as HTMLInputElement).validity.valueMissing)).toBe(true);
  // Card 1 of a scaffolded day has several rows, so the reps message names the per-set Remove.
  expect(await reps.evaluate((el) => (el as HTMLInputElement).validationMessage)).toBe(
    PARTIAL_SETS_COPY.missingReps,
  );
  // The summary names the blocker (card 1's name rotates with the day, so only its tail is fixed).
  await expect(strength.getByText(/ set 1 needs finishing\.$/)).toBeVisible();
  // Give a (wrongly) un-blocked submit time to leave the page before asserting none did.
  await page.waitForTimeout(1_000);
  expect(actionRequests, 'the browser should have blocked the submit').toEqual([]);
});
