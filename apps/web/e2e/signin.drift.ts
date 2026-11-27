import { errors, expect, test, type Page } from '@playwright/test';

import { MIN_TAP_TARGET_PX, SIGN_IN_COPY, SIGN_IN_PATH } from '../lib/constants';
import {
  expectLinkTargets,
  expectNoAxeViolations,
  expectTapTargets,
  type LinkTargetException,
} from './a11y-checks';
import { expectNoHorizontalOverflow, NARROW_VIEWPORT } from './contexts';
import { cspViolations, recordCspViolations } from './csp';

/**
 * **Does production `/sign-in` still render, styled and usable, on this week's Clerk build?**
 * (`playwright.drift.config.ts` says why it exists and how it is isolated; plan:
 * `docs/plans/td-signin-drift-check.md`.) Read-only: it never signs in, taps Google or submits.
 *
 * ⚠️ This spec's own prints of page text (the CSP list, the card's styles, the fallbacks) go through
 * `JSON.stringify`, so a line in them cannot be read by the runner as a workflow command. The shared
 * a11y helpers and Playwright's own failure output still print labels raw; the check job holds no
 * secret and only a read token, so the most a forged command could do is annotate or mask.
 */

test.use({ viewport: NARROW_VIEWPORT });

/** Clerk mounts after `load`; the page's own loader gives up at 15s, so wait longer than that. */
const CARD_TIMEOUT_MS = 20_000;

/**
 * The links in `<main>` on the lit card, counted from production. A change in either direction is
 * drift worth a look (Clerk added a link, or one vanished).
 */
const EXPECTED_LINKS = 4;

/**
 * Clerk's own links that miss the 44px bar, measured on production 2026-11-20 (the first live runs of
 * this check). Both are vendor DOM inside the card; neither is sized by `SIGN_IN_APPEARANCE`.
 */
const VENDOR_LINK_EXCEPTIONS: readonly LinkTargetException[] = [
  {
    name: 'Clerk logo',
    reason:
      '"Secured by Clerk", 14px tall; removing the mark is a paid-plan feature (docs/tech-debt.md)',
  },
  {
    name: 'Join waitlist',
    reason: "Clerk's waitlist footer link, 18px tall; sizing it needs an appearance key of its own",
  },
];

/** The one known violation on every page: zod's JIT probe, from OUR bundle on the target's origin. */
const isZodEvalProbeFrom = (origin: string) => {
  const bundle = new RegExp(
    `^script-src(-elem)? eval @${origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/_next/static/`,
  );
  return (v: string) => bundle.test(v);
};

/**
 * 🟡 **A KNOWN, EXPECTED finding** _(maintainer, 2026-11-21)_: Clerk's bot-protection bootstrap loads
 * even with every protection INACTIVE on the production instance, and its probes are refused by
 * `connect-src`. Sign-in works regardless; whether the SIGN-UP consent step does is the maintainer's
 * one-off manual check owed before the first invite (`runbooks.md` → "The sign-up consent step under
 * Clerk's protect script"). Matched EXACTLY, by directive, probe host, the five recorded ports and
 * the bootstrap script, so any other violation still fails. Printed, never silent.
 */
const isKnownProtectProbe = (v: string) =>
  /^connect-src https:\/\/[a-z0-9-]+\.client\.protect\.clerk\.com(:(8443|18443|2082|992))?\/ins_[A-Za-z0-9]+\/probe @https:\/\/cdn\.protect\.clerk\.com\/ins_[A-Za-z0-9]+\/c\/[a-z0-9-]+\/bootstrap\.js:\d+ /.test(
    v,
  );

const googleButton = (page: Page) => page.getByRole('button', { name: /google/i });

/**
 * Open `/sign-in` and wait for Clerk's card, saying which of our fallbacks shows if it never comes.
 * `domcontentloaded`, not `load`: Clerk's scripts count toward `load`, and a slow CDN would otherwise
 * spend the test's budget before this can report. Only a TIMEOUT becomes "did not render"; any other
 * error (two Google buttons in a new build: a strict-mode violation) is drift and is rethrown as is.
 */
async function openLitCard(page: Page): Promise<void> {
  await page.goto(SIGN_IN_PATH, { waitUntil: 'domcontentloaded' });
  try {
    await googleButton(page).waitFor({ state: 'visible', timeout: CARD_TIMEOUT_MS });
  } catch (e) {
    if (!(e instanceof errors.TimeoutError)) throw e;
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

  // 1 · Clerk's own styling arrived: its card has a shadow or rounding only Clerk's CSS supplies
  //     (Tailwind's preflight leaves a bare element at none / 0). A missing or renamed card is soft
  //     too, so it cannot hang the test and hide the checks after it.
  const cardLocator = page.locator('.cl-card');
  await expect.soft(cardLocator, "Clerk's card element (.cl-card)").toHaveCount(1);
  if ((await cardLocator.count()) > 0) {
    const card = await cardLocator.first().evaluate((el) => {
      const s = getComputedStyle(el);
      return { boxShadow: s.boxShadow, borderRadius: s.borderRadius };
    });
    expect
      .soft(
        card.boxShadow !== 'none' || parseFloat(card.borderRadius) > 0,
        `Clerk's card is unstyled: ${JSON.stringify(card)}`,
      )
      .toBe(true);
  }

  // 2 · Our appearance key still reaches the Google button and wins (`SIGN_IN_APPEARANCE`'s
  //     min-h-11). NOT a styling check: that rule ships in our own stylesheet.
  const height = (await googleButton(page).boundingBox())?.height ?? 0;
  expect
    .soft(height, 'the Google button meets the tap bar')
    .toBeGreaterThanOrEqual(MIN_TAP_TARGET_PX);

  // 3 · One <h1> (soft).
  await expect.soft(page.getByRole('heading', { level: 1 })).toHaveCount(1);

  // 4 · The CSP, read LATE, after the page has settled under the checks above, so a refusal that
  //     lands after the card appears (a late probe, a lazy style) is counted. The full list is
  //     printed. No host filter: a refused injected <style> records as "style-src-elem inline".
  const all = await cspViolations(page);
  console.log(`csp violations (${all.length}): ${JSON.stringify(all)}`);
  const known = all.filter(isKnownProtectProbe);
  if (known.length > 0) {
    console.log(
      `known finding: ${known.length} protect-probe refusal(s), expected (isKnownProtectProbe)`,
    );
  }
  const isZodEvalProbe = isZodEvalProbeFrom(new URL(page.url()).origin);
  const violations = all.filter((v) => !isZodEvalProbe(v) && !isKnownProtectProbe(v));
  expect
    .soft(
      violations.map((v) => JSON.stringify(v)),
      'CSP violations on /sign-in',
    )
    .toEqual([]);

  // 5 · The page's own a11y bar, measured on the page people get. These three shared helpers are
  //     HARD and run last, so everything above is already reported if one of them fails.
  await expectNoHorizontalOverflow(page, 'sign-in drift');
  await expectTapTargets(page, 'sign-in drift');
  await expectLinkTargets(page.getByRole('main'), 'sign-in drift', EXPECTED_LINKS, {
    exceptions: VENDOR_LINK_EXCEPTIONS,
  });
});

test('the lit card passes the axe A/AA scan', async ({ page }) => {
  await openLitCard(page);
  await expectNoAxeViolations(page, 'sign-in drift');
});
