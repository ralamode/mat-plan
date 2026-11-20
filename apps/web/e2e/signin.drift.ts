import { expect, test, type Page } from '@playwright/test';

import { MIN_TAP_TARGET_PX, SIGN_IN_COPY, SIGN_IN_PATH } from '../lib/constants';
import { expectLinkTargets, expectNoAxeViolations, expectTapTargets } from './a11y-checks';
import { expectNoHorizontalOverflow, NARROW_VIEWPORT } from './contexts';
import { cspViolations, recordCspViolations } from './csp';

/**
 * **Does production `/sign-in` still render, styled and usable, on this week's Clerk build?**
 * (`playwright.drift.config.ts` says why it exists and how it is isolated; plan:
 * `docs/plans/td-signin-drift-check.md`.) Read-only: it never signs in, taps Google or submits.
 *
 * ⚠️ Text from the page (a CSP sample, a label) is printed only as `JSON.stringify`, so a line it
 * contains cannot be read by the runner as a workflow command.
 */

test.use({ viewport: NARROW_VIEWPORT });

/** Clerk mounts after `load`; the page's own loader gives up at 15s, so wait longer than that. */
const CARD_TIMEOUT_MS = 20_000;

/**
 * The links in `<main>` on the lit card, counted from production. A change in either direction is
 * drift worth a look (Clerk added a link, or one vanished).
 */
const EXPECTED_LINKS = 4;

/** The one known violation on every page: zod's JIT probe, from our own bundle (`e2e/csp.ts`). */
const isZodEvalProbe = (v: string) => /^script-src(-elem)? eval @[^ ]*\/_next\/static\//.test(v);

const googleButton = (page: Page) => page.getByRole('button', { name: /google/i });

/** Open `/sign-in` and wait for Clerk's card, saying which of our fallbacks shows if it never comes. */
async function openLitCard(page: Page): Promise<void> {
  await page.goto(SIGN_IN_PATH);
  try {
    await googleButton(page).waitFor({ state: 'visible', timeout: CARD_TIMEOUT_MS });
  } catch {
    const fallbacks = [SIGN_IN_COPY.failed, SIGN_IN_COPY.loading, SIGN_IN_COPY.notYet];
    throw new Error(
      `Clerk's card did not render within ${CARD_TIMEOUT_MS}ms. ` +
        `Showing instead: ${JSON.stringify(await visibleOf(page, fallbacks))}`,
    );
  }
}

async function visibleOf(page: Page, texts: readonly string[]): Promise<string[]> {
  const out: string[] = [];
  for (const text of texts) if ((await page.getByText(text).count()) > 0) out.push(text);
  return out;
}

test('the lit card renders, keeps its styles, and meets the a11y bar under the production CSP', async ({
  page,
}) => {
  await recordCspViolations(page);
  await openLitCard(page);

  // 1 · The CSP refuses nothing but the one known probe. No host filter: a refused injected
  //     <style> records as "style-src-elem inline", with no host in it.
  const violations = (await cspViolations(page)).filter((v) => !isZodEvalProbe(v));
  expect(
    violations.map((v) => JSON.stringify(v)),
    'CSP violations on /sign-in',
  ).toEqual([]);

  // 2 · Clerk's own styling arrived: its card has a shadow or rounding only Clerk's CSS supplies
  //     (Tailwind's preflight leaves a bare element at none / 0).
  const card = await page
    .locator('.cl-card')
    .first()
    .evaluate((el) => {
      const s = getComputedStyle(el);
      return { boxShadow: s.boxShadow, borderRadius: s.borderRadius };
    });
  expect(
    card.boxShadow !== 'none' || parseFloat(card.borderRadius) > 0,
    `Clerk's card is unstyled: ${JSON.stringify(card)}`,
  ).toBe(true);

  // 3 · Our appearance key still reaches the Google button and wins (`SIGN_IN_APPEARANCE`'s
  //     min-h-11). NOT a styling check: that rule ships in our own stylesheet.
  const height = (await googleButton(page).boundingBox())?.height ?? 0;
  expect(height, 'the Google button meets the tap bar').toBeGreaterThanOrEqual(MIN_TAP_TARGET_PX);

  // 4 · The page's own a11y bar, measured on the page people get.
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expectNoHorizontalOverflow(page, 'sign-in drift');
  await expectTapTargets(page, 'sign-in drift');
  await expectLinkTargets(page.getByRole('main'), 'sign-in drift', EXPECTED_LINKS);
});

test('the lit card passes the axe A/AA scan', async ({ page }) => {
  await openLitCard(page);
  await expectNoAxeViolations(page, 'sign-in drift');
});
