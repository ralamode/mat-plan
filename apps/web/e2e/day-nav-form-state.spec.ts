import { expect, test } from '@playwright/test';

import { isoDaysAgo, openStrengthForm, SEED_PROFILE_ROUTE } from './steps';

/**
 * **V1-28 — paging to another day must not leave the last day's form behind.**
 *
 * V1-15 made day navigation a client-side RSC transition. `StrengthFormBody` is keyed on `gen`, a
 * SUBMIT counter, so navigating between days does not remount it — and every uncontrolled field in it
 * (`defaultValue`, `defaultChecked`) keeps the DOM value React set on first mount.
 *
 * The day-role select is the one that does damage. Its own docblock says the stored value's whole
 * worth is PROVENANCE — *"a non-null day_role must mean a human asserted it"* — and it is the column
 * V1-13's CSV `session_type` reads. So a stale select does not merely look wrong: submitting it
 * writes a day role the athlete never chose, into the column the export trusts most.
 */
test('the day-role select follows the day being viewed, not the day first loaded', async ({
  page,
}) => {
  await page.goto(SEED_PROFILE_ROUTE, { waitUntil: 'networkidle' });
  // V1-24 3a-ii: the form is collapsed on a day that already has strength (other specs log Liam's).
  await openStrengthForm(page);

  const select = page.getByLabel('Which day is this?');
  const today = await select.inputValue();

  // The YDP alternates A/B on date parity, so adjacent days ALWAYS differ — which is exactly what
  // makes this bug reachable by one tap of the back arrow.
  await page.getByRole('link', { name: /^Previous day/ }).click();
  await page.waitForURL(new RegExp(`d=${isoDaysAgo(1)}`));
  await openStrengthForm(page); // a client-side day change re-keys the island: open it again

  // Scoped to the day-nav: the program card's header carries the same "· Strength A/B" suffix.
  const heading = page
    .getByRole('navigation', { name: 'Change day' })
    .getByText(/· Strength [AB]$/);
  await expect(heading).toBeVisible();

  const yesterday = await select.inputValue();
  expect(
    yesterday,
    'the select still holds the day we navigated AWAY from — submitting it would assert a day role ' +
      'the athlete never chose, into the column the CSV export reads as session_type',
  ).not.toBe(today);

  // And it must agree with what the page itself says the day is.
  const label = (await heading.textContent())!.trim();
  expect(label.endsWith('Strength A') ? 'strength_a' : 'strength_b').toBe(yesterday);
});
