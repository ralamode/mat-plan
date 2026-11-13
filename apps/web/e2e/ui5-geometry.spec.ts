import { expect, test } from '@playwright/test';

import { MOBILE_VIEWPORT, NARROW_VIEWPORT } from './contexts';
import { SEED_PROFILE_ROUTE } from './steps';
import { SETTINGS_PATH, ADD_ATHLETE_PATH, NAV_RAIL_COPY } from '@/lib/constants';

/**
 * **UI-5 acceptance 3: the phone layout does not move.**
 *
 * 🔴 **This exists because the guard the plan first proposed could not fail.** The draft said the
 * 390px a11y scan and the screenshots would catch a phone-layout change. They cannot: the scan is
 * axe (DOM, labels, contrast) plus tap-target HEIGHT, and reads no position, padding, `gap` or
 * footer placement; the screenshots are written to a gitignored directory and never diffed. A
 * spacing or ordering change passes both. Meanwhile UI-5 moves `<main>` into a shell, relocates the
 * footer and migrates `flex-1` — three ways to shift a phone silently.
 *
 * So the geometry is measured and pinned. The numbers below were recorded on the commit **before**
 * the shell landed; if an edit moves the phone, this is what says so.
 *
 * ⚠️ **Rounded to whole pixels** — sub-pixel differences between runs are noise, a 1px layout shift
 * is not something this guard needs to catch, and brittleness here would get the test deleted.
 */
const PAGES = [
  { name: 'the day page', path: SEED_PROFILE_ROUTE },
  { name: 'household settings', path: SETTINGS_PATH },
  { name: 'add an athlete', path: ADD_ATHLETE_PATH },
] as const;

/** What a layout change moves. Position, box, the spacing between children, and total height. */
async function geometryOf(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const main = document.querySelector('main');
    const cs = main ? getComputedStyle(main) : null;
    // 🔴 **Layout properties, never content-dependent boxes.** The first version pinned `main`'s
    // full rect — including a 3020px HEIGHT that moves the moment anyone adds a field to the day
    // page. A guard that reddens on unrelated content changes is one that gets `--update-snapshots`
    // run at it without reading, and then it guards nothing. So: x and width, not y and height;
    // the `h1`'s x, not its y; and the footer as an OFFSET from main's bottom rather than an
    // absolute position.
    const rect = (sel: string) => {
      const r = document.querySelector(sel)?.getBoundingClientRect();
      return r ? [Math.round(r.x), Math.round(r.width)] : null;
    };
    return {
      mainXWidth: rect('main'),
      mainPadding: cs ? [cs.paddingLeft, cs.paddingTop, cs.paddingBottom] : null,
      mainRowGap: cs?.rowGap ?? null,
      // 🔴 The footer's y RELATIVE to main's bottom. Absolute y would move with any content change
      // above it; the gap is what `flex-1` and the footer's placement actually control.
      footerOffset: (() => {
        const f = document.querySelector('footer')?.getBoundingClientRect();
        const m = main?.getBoundingClientRect();
        return f && m ? Math.round(f.y - (m.y + m.height)) : null;
      })(),
      h1XWidth: rect('h1'),
      firstControlX: rect('input:not([type=hidden]), button, select'),
      mainCount: document.querySelectorAll('main').length,
      footerInsideMain: !!document.querySelector('main footer'),
    };
  });
}

for (const viewport of [MOBILE_VIEWPORT, NARROW_VIEWPORT]) {
  test.describe(`phone geometry at ${viewport.width}px`, () => {
    test.use({ viewport });

    for (const { name, path } of PAGES) {
      test(`${name} is unchanged`, async ({ page }) => {
        // ⚠️ `networkidle`, the suite's idiom (`day-navigation.spec.ts:18`). At the default
        // `load` the measurement caught `app/p/loading.tsx`'s `<main aria-busy>` still in the DOM
        // beside the streamed page's, and reported two `<main>` elements — a timing artifact, not
        // the duplicate landmark it looks like.
        await page.goto(path, { waitUntil: 'networkidle' });
        const geometry = await geometryOf(page);

        // Two invariants that hold regardless of the numbers, and that the shell could break.
        expect(geometry.mainCount, 'exactly one <main>').toBe(1);
        expect(geometry.footerInsideMain, 'the footer is not inside <main>').toBe(false);

        // 🔴 **And the one the snapshot cannot state.** The rail is `hidden lg:flex`, so a phone
        // should not see it at all — but `hidden` is a class, and a later `lg:` typo or a stray
        // `flex` would reveal it with no number in the baseline moving: the rail would become the
        // first grid child above the breakpoint's own column rules, and `main`'s box would be
        // unchanged because below `lg` there is no grid. A visible nav here is a phone regression
        // that this file's snapshot would report as green.
        await expect(
          page.getByRole('navigation', { name: NAV_RAIL_COPY.label }),
          `the nav rail is not visible at ${viewport.width}px`,
        ).toHaveCount(0);

        // ⚠️ `toMatchSnapshot` takes a string or Buffer — handed an object it fails with
        // `file.slice is not a function`, which names nothing. Stringify, which also makes the
        // committed baseline readable in a diff.
        expect(JSON.stringify(geometry, null, 2)).toMatchSnapshot(
          `ui5-${viewport.width}-${name.replace(/\s+/g, '-')}.json`,
        );
      });
    }
  });
}

/**
 * **820px — a tablet in portrait, which must still be the phone layout.**
 *
 * 🔴 **Asserted as PROPERTIES, not pinned to a baseline, and the difference is deliberate.** 820 is
 * below Tailwind's `lg` (64rem), so the shell is supposed to render exactly today's single centred
 * column — and *that* is a statement with a right answer (`max-w-2xl` = 672px, centred in 820 → x =
 * 74) rather than a number that needs a before-and-after. It also means this case needs no committed
 * snapshot from the pre-shell commit, so it can be added later without re-recording anything.
 *
 * ⚠️ **Tailwind v4 breakpoints are `rem`-based**, so this boundary moves with the root font size: a
 * viewer at 125% browser text would cross `lg` at 1280 device pixels, not 1024. The numbers below are
 * at the default 16px root, which is what the suite runs at.
 */
test.describe('the tablet width is still the phone layout', () => {
  const TABLET = { width: 820, height: 1180 };
  test.use({ viewport: TABLET });

  for (const { name, path } of PAGES) {
    test(`${name} renders one centred column at ${TABLET.width}px`, async ({ page }) => {
      await page.goto(path, { waitUntil: 'networkidle' });

      await expect(page.getByRole('navigation', { name: NAV_RAIL_COPY.label })).toHaveCount(0);

      const box = await page.evaluate(() => {
        const r = document.querySelector('main')!.getBoundingClientRect();
        return { x: Math.round(r.x), width: Math.round(r.width) };
      });
      // `max-w-2xl` (42rem = 672px) centred: the single column, unchanged by the shell.
      expect(box.width, 'main keeps its measure').toBe(672);
      expect(box.x, 'main is centred, not pushed right by a rail column').toBe(
        Math.round((TABLET.width - 672) / 2),
      );
    });
  }
});
