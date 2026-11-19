import { expect, test } from '@playwright/test';

import { MOBILE_VIEWPORT, NARROW_VIEWPORT, TABLET_VIEWPORT, navRail } from './contexts';
import { SEED_PROFILE_ROUTE } from './steps';
import { SETTINGS_PATH, ADD_ATHLETE_PATH } from '@/lib/constants';

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
 * So the geometry is measured and pinned. The numbers in `BEFORE` were recorded by running this
 * file's `geometryOf` on the commit **before** the shell landed; if an edit moves the phone, they
 * are what says so.
 *
 * 🔴 **Literal expectations, NOT `toMatchSnapshot`, and the reason is that CI could never have a
 * baseline.** Playwright suffixes a snapshot with the platform (`…-chromium-darwin.json`), so the
 * six files recorded here were invisible to the Linux runner, which reported them as missing and
 * failed — and the baseline it wanted **cannot be produced**, because recording it would mean
 * running the pre-shell commit on Linux. Inline numbers run everywhere, need no `--update-snapshots`
 * path (the gesture that would have silently re-recorded the very thing this guards), and show the
 * expected layout in the diff where a reviewer reads it.
 *
 * ⚠️ **Rounded to whole pixels** — sub-pixel differences between runs are noise, a 1px layout shift
 * is not something this guard needs to catch, and brittleness here would get the test deleted.
 */
/** The first form control on a page: what `firstControlX` measures unless a page names its own. */
const FIRST_CONTROL = 'input:not([type=hidden]), button, select';
/** The day page's Next arrow: the last child of the date row in `day-nav.tsx`. */
const DAY_NEXT_ARROW = 'nav[aria-label="Change day"] > div:first-child > :last-child';

const PAGES = [
  // The day page's first control is the Next arrow, found by its place in the date row, not as the
  // first `<button>` (FAM-1 12c). On a program, Next day is a link (look-ahead), so the first
  // `<button>` became whatever the day holds, such as Bodyweight's Change. The arrow sits at the same
  // x whether it is a link or a disabled button, so the recorded baseline still applies.
  { name: 'the day page', path: SEED_PROFILE_ROUTE, firstControl: DAY_NEXT_ARROW },
  { name: 'household settings', path: SETTINGS_PATH, firstControl: FIRST_CONTROL },
  { name: 'add an athlete', path: ADD_ATHLETE_PATH, firstControl: FIRST_CONTROL },
] as const;

/** What a layout change moves. Position, box, the spacing between children, and total height. */
async function geometryOf(page: import('@playwright/test').Page, firstControl: string) {
  return page.evaluate((firstControl) => {
    const main = document.querySelector('main');
    const cs = main ? getComputedStyle(main) : null;
    // 🔴 **Layout properties, never content-dependent boxes.** The first version pinned `main`'s
    // full rect — including a 3020px HEIGHT that moves the moment anyone adds a field to the day
    // page. A guard that reddens on unrelated content changes is one that gets `--update-snapshots`
    // run at it without reading, and then it guards nothing. So: x and width, not y and height;
    // the `h1`'s x, not its y; and the footer as an OFFSET from main's bottom rather than an
    // absolute position.
    // ⚠️ **Scoped UNDER `main`.** These were `document.querySelector` calls, which also see the nav
    // rail — `display: none` at these widths, but first in the DOM. The day the rail grows a
    // `<button>` or an `<h1>`, a document-wide query would report `[0, 0]` and turn every phone case
    // red for a desktop-only change. That is the brittleness this file's header says gets a guard
    // deleted.
    const rect = (sel: string) => {
      const r = main?.querySelector(sel)?.getBoundingClientRect();
      return r ? [Math.round(r.x), Math.round(r.width)] : null;
    };
    // 🔴 **The element that actually SPACES the page, which is not always `<main>`.** Inside the
    // shell `<main>` has one child — the content wrapper — and the page's children live in that, so
    // `main`'s own `row-gap` separates nothing. Pinning it was pinning an inert value: `gap-8` could
    // become `gap-4` on the wrapper with this guard green. Two review lenses found it independently.
    // Outside the shell `<main>` IS the stack, which is what the pre-shell baseline measured, and
    // the value is the same 32px either way.
    const rect0 = (sel: string) => {
      const r = document.querySelector(sel)?.getBoundingClientRect();
      return r ? [Math.round(r.x), Math.round(r.width)] : null;
    };
    const stack = main?.children.length === 1 ? (main.firstElementChild as HTMLElement) : main;
    return {
      mainXWidth: rect0('main'),
      mainPadding: cs ? [cs.paddingLeft, cs.paddingTop, cs.paddingBottom] : null,
      stackRowGap: stack ? getComputedStyle(stack).rowGap : null,
      // 🔴 The footer's y RELATIVE to main's bottom. Absolute y would move with any content change
      // above it.
      footerOffset: (() => {
        const f = document.querySelector('footer')?.getBoundingClientRect();
        const m = main?.getBoundingClientRect();
        return f && m ? Math.round(f.y - (m.y + m.height)) : null;
      })(),
      h1XWidth: rect('h1'),
      firstControlX: rect(firstControl),
      mainCount: document.querySelectorAll('main').length,
      footerInsideMain: !!document.querySelector('main footer'),
    };
  }, firstControl);
}

/**
 * **The pre-shell geometry, one entry per page per width.** Recorded by this file's `geometryOf` on
 * the commit before `AppShell` existed — the layout the app has had since the scaffold.
 *
 * Every number here is **layout-driven**, not text-driven: `main`'s box is the viewport, its padding
 * come from the page-class constants, the `h1` is a block element so its width is the content box,
 * and `footerOffset` is 0 because the footer abuts `main`.
 *
 * ⚠️ **A `footerBelowFold` field was here and is gone.** On a page taller than the viewport it can
 * only be false if the footer sits ABOVE `<main>`, which `footerOffset === 0` already pins — a field
 * with no independent failure mode, on a guard whose whole story is assertions that could not fail.
 * The `flex-1` proof it was mistaken for is the short-page block at the bottom of this file. ⚠️ `firstControlX` is the
 * one that touches text metrics — the settings page's first button is sized by its label — so if it
 * ever disagrees between a Mac and the Linux runner, **that field is what to drop**, not the file.
 */
const BEFORE: Record<string, Awaited<ReturnType<typeof geometryOf>>> = {
  '390-the day page': {
    mainXWidth: [0, 390],
    mainPadding: ['16px', '48px', '48px'],
    stackRowGap: '32px',
    footerOffset: 0,
    h1XWidth: [16, 358],
    firstControlX: [330, 44],
    mainCount: 1,
    footerInsideMain: false,
  },
  '390-household settings': {
    mainXWidth: [0, 390],
    mainPadding: ['16px', '48px', '48px'],
    stackRowGap: '32px',
    footerOffset: 0,
    h1XWidth: [16, 358],
    firstControlX: [86, 67],
    mainCount: 1,
    footerInsideMain: false,
  },
  '390-add an athlete': {
    mainXWidth: [0, 390],
    mainPadding: ['16px', '48px', '48px'],
    stackRowGap: '32px',
    footerOffset: 0,
    h1XWidth: [16, 358],
    firstControlX: [29, 16],
    mainCount: 1,
    footerInsideMain: false,
  },
  '360-the day page': {
    mainXWidth: [0, 360],
    mainPadding: ['16px', '48px', '48px'],
    stackRowGap: '32px',
    footerOffset: 0,
    h1XWidth: [16, 328],
    firstControlX: [300, 44],
    mainCount: 1,
    footerInsideMain: false,
  },
  '360-household settings': {
    mainXWidth: [0, 360],
    mainPadding: ['16px', '48px', '48px'],
    stackRowGap: '32px',
    footerOffset: 0,
    h1XWidth: [16, 328],
    firstControlX: [86, 67],
    mainCount: 1,
    footerInsideMain: false,
  },
  '360-add an athlete': {
    mainXWidth: [0, 360],
    mainPadding: ['16px', '48px', '48px'],
    stackRowGap: '32px',
    footerOffset: 0,
    h1XWidth: [16, 328],
    firstControlX: [29, 16],
    mainCount: 1,
    footerInsideMain: false,
  },
};

for (const viewport of [MOBILE_VIEWPORT, NARROW_VIEWPORT]) {
  test.describe(`phone geometry at ${viewport.width}px`, () => {
    test.use({ viewport });

    for (const { name, path, firstControl } of PAGES) {
      test(`${name} is unchanged`, async ({ page }) => {
        // ⚠️ `networkidle`, the suite's idiom (`day-navigation.spec.ts:18`). At the default
        // `load` the measurement caught a `loading.tsx`'s `<main aria-busy>` still in the DOM
        // beside the streamed page's, and reported two `<main>` elements — a timing artifact, not
        // the duplicate landmark it looks like.
        await page.goto(path, { waitUntil: 'networkidle' });
        const geometry = await geometryOf(page, firstControl);

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
          navRail(page),
          `the nav rail is not visible at ${viewport.width}px`,
        ).toHaveCount(0);

        expect(geometry, `${name} at ${viewport.width}px`).toEqual(
          BEFORE[`${viewport.width}-${name}`],
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
  test.use({ viewport: TABLET_VIEWPORT });

  for (const { name, path } of PAGES) {
    test(`${name} renders one centred column at ${TABLET_VIEWPORT.width}px`, async ({ page }) => {
      await page.goto(path, { waitUntil: 'networkidle' });

      await expect(navRail(page)).toHaveCount(0);

      const box = await page.evaluate(() => {
        const r = document.querySelector('main')!.getBoundingClientRect();
        return { x: Math.round(r.x), width: Math.round(r.width) };
      });
      // `max-w-2xl` (42rem = 672px) centred: the single column, unchanged by the shell.
      expect(box.width, 'main keeps its measure').toBe(672);
      expect(box.x, 'main is centred, not pushed right by a rail column').toBe(
        Math.round((TABLET_VIEWPORT.width - 672) / 2),
      );
    });
  }
});

/**
 * **`flex-1`, proved on a page short enough for it to matter.**
 *
 * 🔴 **`footerOffset` was written as this guard and could not be.** The footer is the next flex
 * sibling after `<main>`, so the offset between them is 0 whether or not `main` stretches — delete
 * `flex-1` and a short page's footer rides up under the fold with that field still reading 0. The
 * plan's Risks table named it as the mitigation for exactly this risk. A correctness lens found it,
 * and a `pnpm probe` then showed the first replacement could not fail either: every page in `PAGES`
 * is taller than a phone viewport, so the footer is below the fold no matter what the column does.
 *
 * ⚠️ **So the viewport is TALL and the page is SHORT.** The viewport is at least 2400px and at least
 * `SHORT_PAGE_GAP` taller than the page itself, measured first, so `flex-1` is the only thing that
 * grows `<main>` to put the footer on the bottom edge, however many rows the shared fixture holds.
 * Measured: with it, `footer.bottom === innerHeight`; without it the footer lands mid-screen with
 * white space under it — the "footer rides up under the fold" regression, visible at last.
 */
test.describe('a short page still pushes the footer to the bottom', () => {
  /** The viewport is never shorter than this, and never less than `SHORT_PAGE_GAP` taller than the page. */
  const TALL_VIEWPORT_MIN = 2400;
  const SHORT_PAGE_GAP = 600;
  test.use({ viewport: { width: MOBILE_VIEWPORT.width, height: TALL_VIEWPORT_MIN } });

  for (const { name, path } of PAGES.filter((p) => p.path !== SEED_PROFILE_ROUTE)) {
    test(`${name} fills the viewport`, async ({ page }) => {
      await page.goto(path, { waitUntil: 'networkidle' });

      // Where the footer would sit if `<main>` hugged its content: the whole page's own height,
      // header, padding and footer included. Growth is switched off for one read and restored.
      const naturalBottom = await page.evaluate(() => {
        const main = document.querySelector('main')!;
        main.style.flexGrow = '0';
        const bottom = Math.round(document.querySelector('footer')!.getBoundingClientRect().bottom);
        main.style.flexGrow = '';
        return bottom;
      });
      // 🔴 **The viewport is sized from the page, so the page is always the shorter one.** It was a
      // fixed 2400px, and `/settings` renders one row per athlete on a database the whole suite
      // shares (`fullyParallel`): `athletes.spec.ts` adds and archives several per run. On #652's
      // run 44502104829 the page carried 4 live and 10 archived athletes and was 2568px tall, so the
      // footer could not reach a 2400px bottom edge and the assertion blamed `flex-1`, on both
      // attempts. The old precondition did not catch it: it compared `<main>`'s first child with the
      // viewport, which leaves out the header, `<main>`'s padding and the footer.
      const viewportHeight = Math.max(TALL_VIEWPORT_MIN, naturalBottom + SHORT_PAGE_GAP);
      await page.setViewportSize({ width: MOBILE_VIEWPORT.width, height: viewportHeight });

      const { footerBottom, mainHeight, natural } = await page.evaluate(() => {
        const main = document.querySelector('main')!;
        return {
          footerBottom: Math.round(
            document.querySelector('footer')!.getBoundingClientRect().bottom,
          ),
          mainHeight: Math.round(main.getBoundingClientRect().height),
          natural: Math.round(main.firstElementChild!.getBoundingClientRect().height),
        };
      });

      expect(
        footerBottom,
        'the footer sits on the bottom edge — `flex-1` grew <main> to fill the column',
      ).toBe(viewportHeight);
      // Stated separately so a failure says WHICH half broke: a collapsed `<main>` reads as its
      // content height, far short of the viewport.
      // `SHORT_PAGE_GAP` is the room `flex-1` has to fill: a `<main>` that hugged its content
      // would be at least that much shorter than this.
      expect(mainHeight, '<main> stretched rather than hugging its content').toBeGreaterThanOrEqual(
        natural + SHORT_PAGE_GAP,
      );
    });
  }
});
