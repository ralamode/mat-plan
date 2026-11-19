import { expect, type Page } from '@playwright/test';

// Relative imports only: the tsx-run screenshot scripts reach this through `capture.ts`.
import { NAV_RAIL_COPY, PICKER_COPY } from '../lib/constants';

/**
 * Shared e2e context values (OSS-2). Kept dependency-light (no `@mat-plan/db`, unlike `steps.ts`).
 *
 * ⚠️ **`NO_GATE_STATE` was deleted at AUTH-1 1d, not renamed.** It was `{ cookies: [], origins: [] }`
 * — an empty jar, used to opt a spec OUT of the gate-authenticated `storageState`. There is no
 * authenticated state to opt out of any more: the harness session comes from the process env
 * (`E2E_SESSION_BYPASS_USER_ID`), which a cookie jar cannot override. 🔴 Renaming it
 * `NO_SESSION_STATE` would have asserted exactly that false property, which is why it is gone
 * instead. A spec that needs an unauthenticated server needs a SECOND SERVER — see `tech-debt.md`.
 */

/** ~iPhone 14, the primary device — the a11y spec, the landing's above-the-fold check. */
export const MOBILE_VIEWPORT = { width: 390, height: 844 };

/**
 * The NARROWEST width AGENTS.md commits to ("every screen must work from ~360px up"). 390 is the
 * device; **360 is the contract**, and the two are not the same test — the strength set row's own
 * comments budget against the ~294px of usable width that only exists at 360.
 *
 * Lifted here at PROF-1 a-r, when `athletes.spec.ts` became the second spec to need it and declared
 * a copy whose comment read "mirrors `a11y.spec.ts`'s own constant" — a copy that knew it was one.
 */
export const NARROW_VIEWPORT = { width: 360, height: 780 };

/**
 * ~iPad Air portrait. **Below Tailwind's `lg` (64rem), so this is still the phone layout** — which
 * is the whole reason `UI-5` measures it: a tablet must not get a half-built desktop.
 *
 * Lifted here at `UI-5`, which would have been the THIRD copy of the pair (`a11y.spec.ts` and
 * `scripts/capture.ts` each had one) — the same trigger that lifted `NARROW_VIEWPORT`.
 */
export const TABLET_VIEWPORT = { width: 820, height: 1180 };

/** A laptop, and the only width at which the app shell's nav rail exists at all. */
export const DESKTOP_VIEWPORT = { width: 1280, height: 900 };

/**
 * The app shell's nav rail (`UI-5`). It is `hidden lg:flex`, so below `lg` this resolves to
 * **zero** elements — which is what the phone specs assert, and why the locator is shared rather
 * than spelled out in each.
 */
export const navRail = (page: Page) => page.getByRole('navigation', { name: NAV_RAIL_COPY.label });

/** The picker's `<h1>` — what "landed on the app home" looks like. */
export const pickerHeading = (page: Page) =>
  page.getByRole('heading', { name: PICKER_COPY.heading, exact: true, level: 1 });

/**
 * **The horizontal-overflow check, once** (PROF-1 b).
 *
 * 🔴 **It was written three times before this.** `a11y.spec.ts` had it as a private function,
 * `athletes.spec.ts` had it inline inside a loop, and PROF-1 b was about to add a third — which is
 * the maintainer's N4 rule exactly: a block that appears twice gets parameterized at the second copy.
 *
 * Why it exists at all: `expectTapTargets` measures control **height**, so a row that runs off the
 * side of a phone passes every other scan in the suite. `scrollWidth > clientWidth` is the one
 * measurement that catches it, and it is opt-in per test rather than part of the `ROUTES` loop
 * because it needs a narrow viewport and a page in the state being measured.
 */
export async function expectNoHorizontalOverflow(page: Page, label: string): Promise<void> {
  const overflow = await page.evaluate(() => {
    const d = document.documentElement;
    return { scrollWidth: d.scrollWidth, clientWidth: d.clientWidth };
  });
  expect(
    overflow.scrollWidth,
    `${label}: the page scrolls horizontally at ${NARROW_VIEWPORT.width}px ` +
      `(scrollWidth ${overflow.scrollWidth} > clientWidth ${overflow.clientWidth})`,
  ).toBeLessThanOrEqual(overflow.clientWidth);
}
