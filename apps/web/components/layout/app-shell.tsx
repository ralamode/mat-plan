import type { ReactNode } from 'react';

import { SiteFooter } from '@/components/layout/site-footer';
import { NavRail, type NavRailCurrent } from '@/components/layout/nav-rail';
import type { ProfileDTO } from '@/lib/dal/profiles';
import {
  MAIN_CONTENT_ID,
  NAV_RAIL_COPY,
  PAGE_COLUMN_CLASS,
  PAGE_CONTENT_CLASS,
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
   * `false` on `/p`'s no-household branch: there are no athletes and no settings link, so a rail
   * there would be an empty region or one item pointing at the page you are already on.
   */
  nav?: boolean;
  /** `app/p/loading.tsx` keeps its `aria-busy`; the shell would otherwise swallow it. */
  busy?: boolean;
}) {
  const showRail = nav && (athletes?.length ?? 0) > 0;

  return (
    <div
      className={cn(
        'flex w-full flex-1 flex-col',
        // ⚠️ `lg:grid` with `items-start` so the rail does not stretch to the page's height. The
        // grid deliberately sets neither `transform` nor `overflow` — both break `position: fixed`
        // in the sheet's overlay, and both are the kind of property added later for a scroll
        // affordance without anyone connecting the two.
        showRail && 'lg:grid lg:grid-cols-[16rem_minmax(0,1fr)] lg:items-start',
      )}
    >
      {/*
        The app has never had a skip link, and axe will never ask for one — `bypass` is satisfied by
        landmarks alone. With a rail first in the DOM a keyboard user tabs navigation before content
        on every page, so this is the moment it costs nothing to add.
      */}
      <a
        href={`#${MAIN_CONTENT_ID}`}
        className="focus-visible:ring-ring bg-background sr-only z-50 rounded-lg px-4 py-3 focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus-visible:ring-3"
      >
        {NAV_RAIL_COPY.skipToContent}
      </a>

      {showRail && <NavRail athletes={athletes ?? []} current={current} />}

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
          PAGE_COLUMN_CLASS,
          'mx-auto max-w-2xl',
          showRail && 'lg:mx-0 lg:max-w-none lg:px-8',
        )}
      >
        <div className={cn(PAGE_CONTENT_CLASS, 'flex flex-1 flex-col gap-8')}>{children}</div>
      </main>

      {/*
        ⚠️ A SIBLING of `<main>`, never a child. A `<footer>` inside `<main>` is not exposed as
        `contentinfo` at all — `privacy.spec.ts` clicks `getByRole('contentinfo')` on an
        authenticated page — and `expectLinkTapTargets` counts links inside `main`, which
        `site-footer.tsx`'s own docblock records as the reason it sits outside.
      */}
      <div className={cn(showRail && 'lg:col-start-2')}>
        <SiteFooter inShell={showRail} />
      </div>
    </div>
  );
}
