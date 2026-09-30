import { expect, test } from '@playwright/test';

import { SEED_PROFILE_ROUTE } from './steps';

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

  const strength = page.getByRole('region', { name: 'Log strength' });
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
  // ⚠️ Every set row of the open card is filled, and that is NOT incidental. `DEFAULT_SCAFFOLD_SETS`
  // is 3 and `reps` is unconditionally `required`, while `isUntouchedScaffold` drops a whole
  // MOVEMENT and has no per-SET equivalent — so doing 2 of 3 sets is currently unsubmittable without
  // discovering "Remove". Found by an earlier draft of this test; filed as **V1-27**, out of scope
  // here. This spec deliberately does not assert that bug either way.
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
  await expect(
    page.getByRole('region', { name: 'Logged entries' }).getByText(/^8 × 20 lb$/),
  ).toHaveCount(openSets, { timeout: 15_000 });
});

/**
 * The declared unit is VISIBLE, which is the argument for carrying the declaration there rather than
 * on a pre-tapped chip: the athlete can see what the form assumed and change it.
 */
test('a scaffolded card shows the unit the catalog declares', async ({ page }) => {
  await page.goto(SEED_PROFILE_ROUTE, { waitUntil: 'networkidle' });

  const strength = page.getByRole('region', { name: 'Log strength' });
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
