import type { ReactNode } from 'react';

import { SiteFooter } from '@/components/layout/site-footer';
import { NavRail, type NavRailCurrent } from '@/components/layout/nav-rail';
import type { ProfileDTO } from '@/lib/dal/profiles';
import {
  MAIN_CONTENT_ID,
  NAV_RAIL_COPY,
  PAGE_COLUMN_BOX_CLASS,
  PAGE_CONTENT_CLASS,
  PAGE_MEASURE_CLASS,
  PAGE_STACK_CLASS,
  SHELL_CELL_CLASS,
} from '@/lib/constants';
import { cn } from '@/lib/utils';

/**
 * The app shell (`UI-5`): a nav rail and the page at `lg` and up, today's single column below it.
 *
 * Plan: [docs/plans/ui-5-app-shell.md](../../../../docs/plans/ui-5-app-shell.md), reshaped by seven
 * lenses. The four decisions that matter when reading this file:
 *
 * 🔴 **1. No client boundary, anywhere.** The obvious `aria-current` is `usePathname()`, which would
 * make the rail `'use client'` on every authenticated page. It does not need to: **every page already
 * knows what it is** — the day page knows its `profileId`, settings knows it is settings — so
 * `current` arrives as a prop and the whole shell stays RSC.
 *
 * 🔴 **2. The region is wide; the CONTENT keeps its measure.** `PAGE_CONTENT_CLASS` caps the page at
 * `max-w-2xl` inside a wide cell. Measured at 1280 with the rail, an uncapped region gives the log
 * form ~1000px, which grows the Movement input to ~650-700px for a ten-character name and puts a
 * list row's label and value ~992px apart. `design.md` says scale **up**, not stretch.
 *
 * 🔴 **3. The context rail is NOT here.** `PICK-1` PR 4 adds the third track with its first real
 * consumer, because a page-level `rail` prop cannot host a picker that lives inside a client form and
 * closes over its state. The plan's § For PR 4 carries the contract it owes.
 *
 * ⚠️ **4. One `<main>`, bare of everything except `id` and `tabIndex`.** `sheet.tsx` patches
 * `tabIndex` onto `document.querySelector('main')` at runtime for its focus fallback; setting it here
 * makes that deterministic. A second `<main>` would also silently take over that fallback — and axe
 * would not say so, because `landmark-no-duplicate-main` is `best-practice` and the scan runs
 * `wcag2a`/`wcag2aa`.
 */
export function AppShell({
  children,
  athletes,
  current,
  nav = true,
  busy = false,
}: {
  children: ReactNode;
  /** The household's live athletes, for the rail. Omitted where there is no household yet. */
  athletes?: readonly ProfileDTO[];
  /** What this page is, so the rail can mark it without reading the pathname. */
  current?: NavRailCurrent;
  /**
   * `false` on **`/p`, in all three of its states** — the only authenticated page with no rail.
   * That page IS the athlete switcher, so a rail there renders a second link to every athlete
   * beside the tile it duplicates. The rule and its reasoning live at `app/p/page.tsx`; this is a
   * pointer, not a second copy.
   */
  nav?: boolean;
  /**
   * A Suspense fallback: keeps its `aria-busy`, and **reserves the rail's column** so the content
   * does not jump when the page resolves. The three `loading.tsx` files under `app/p/` are its only
   * callers, one per route whose frame differs.
   */
  busy?: boolean;
}) {
  const showRail = nav && (athletes?.length ?? 0) > 0;
  // 🔴 **The GRID, separately from the RAIL.** `app/p/[profileId]/loading.tsx` has no data — a
  // Suspense fallback cannot await one — so keying the grid on `athletes.length` made every desktop
  // navigation into a day page render a centred 672px column, then snap to a 1024px cell beside a
  // rail that had just unmounted. That is a layout shift on the one interaction this feature adds,
  // and three review lenses found it independently. The frame is reserved while busy and filled
  // with an inert placeholder; only the rail's CONTENT waits for data.
  const showFrame = showRail || (nav && busy);

  return (
    <div
      className={cn(
        'flex w-full flex-1 flex-col',
        // ⚠️ `lg:grid` with `items-start` so the rail does not stretch to the page's height.
        //
        // 🔴 **Nothing here may become a scroll container, and the reason is NOT the one first
        // written in this comment.** The draft said `overflow` and `transform` "break
        // `position: fixed` in the sheet's overlay"; an architecture lens showed both halves are
        // wrong — the sheet portals to `document.body` (`sheet.tsx`), so the shell is not an
        // ancestor of the overlay at all, and `overflow` never changes a fixed element's
        // containing block in the first place. The true constraint is that **the document must
        // stay THE scroller**: `RemoveScroll` locks `body` while the sheet is open, the overflow
        // helper and the geometry pin both measure `documentElement`, and the rail's `sticky`
        // sticks to the nearest scrolling ancestor. An `overflow-y-auto` added here or on `<main>`
        // takes that over silently. The rail scrolls itself instead — see `nav-rail.tsx`.
        showFrame && 'lg:grid lg:grid-cols-[16rem_minmax(0,1fr)] lg:items-start',
      )}
    >
      {/*
        The app has never had a skip link, and axe will never ask for one — `bypass` is satisfied by
        landmarks alone. With a rail first in the DOM a keyboard user tabs navigation before content
        on every page, so this is the moment it costs nothing to add.
      */}
      <a
        href={`#${MAIN_CONTENT_ID}`}
        // ⚠️ **The `focus:` padding is not a duplicate of the base padding — it is the repair.**
        // Tailwind's `not-sr-only` resets `padding: 0` (that is how it undoes `sr-only`), and it
        // lands at higher specificity than a plain `px-4`, so the focused link was a ~24px box of
        // bare text with a ring hugging the glyphs. `min-h-11` + `inline-flex items-center` make it
        // a real target; `e2e/a11y.spec.ts` measures the box rather than asking Playwright whether
        // it is "visible", which an `sr-only` 1×1 clip also satisfies.
        className="focus-visible:ring-ring bg-background sr-only z-50 rounded-lg focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:inline-flex focus:min-h-11 focus:items-center focus:px-4 focus:py-3 focus-visible:ring-3"
      >
        {NAV_RAIL_COPY.skipToContent}
      </a>

      {showRail ? (
        <NavRail athletes={athletes ?? []} current={current} />
      ) : showFrame ? (
        // The reserved column while the page streams. `aria-hidden` and empty: it is a width, not a
        // landmark, so the `navigation` count a screen reader (and `a11y.spec.ts`) sees is
        // unchanged — the frame is reserved without announcing a navigation that is not there yet.
        <div aria-hidden className="hidden lg:block" />
      ) : null}

      <main
        id={MAIN_CONTENT_ID}
        tabIndex={-1}
        aria-busy={busy || undefined}
        // Below `lg` this is byte-for-byte `PAGE_SHELL_CLASS` — the same spacing constant, plus the
        // centred cap — which is what makes "the phone layout is unchanged" true by construction
        // rather than by two strings happening to agree.
        //
        // 🔴 **The `lg:` overrides are gated on `showRail`, and that is not a tidiness choice.**
        // They exist to turn a centred column into the grid's SECOND CELL: `lg:mx-0` drops the
        // centring, `lg:max-w-none` lets the cell size the box, `lg:px-8` is the gutter beside the
        // rail. With no rail there is no grid, so they just shove the page against the left edge of
        // a 1280px window — which is exactly what `/p` did when they were unconditional, and what a
        // desktop screenshot of the picker showed.
        className={cn(
          PAGE_COLUMN_BOX_CLASS,
          // A flex column so the wrapper's `flex-1` can stretch it, which is what keeps the footer
          // at the bottom of a short page. ⚠️ **No `gap` here.** `<main>` has exactly one child, so
          // a gap on it would separate nothing — and the first version of this file put
          // `PAGE_STACK_CLASS`'s spacing on BOTH elements, which left the geometry guard pinning
          // the inert copy. Two review lenses found it independently.
          'flex flex-1 flex-col',
          'mx-auto',
          PAGE_MEASURE_CLASS,
          showFrame && `${SHELL_CELL_CLASS} lg:px-8`,
        )}
      >
        {/* The page's own stack: the measure, and the gap between its top-level children. This is
            the element the geometry guard reads, because it is the one with the children. */}
        <div className={cn(PAGE_CONTENT_CLASS, PAGE_STACK_CLASS)}>{children}</div>
      </main>

      {/*
        ⚠️ A SIBLING of `<main>`, never a child. A `<footer>` inside `<main>` is not exposed as
        `contentinfo` at all — `privacy.spec.ts` clicks `getByRole('contentinfo')` on an
        authenticated page — and `expectLinkTapTargets` counts links inside `main`, which
        `site-footer.tsx`'s own docblock records as the reason it sits outside.
      */}
      <div className={cn(showFrame && 'lg:col-start-2')}>
        <SiteFooter inShell={showFrame} />
      </div>
    </div>
  );
}
