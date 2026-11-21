import Link from 'next/link';

import { PROFILE_KIND_LABELS } from '@mat-plan/shared';

import { BUILDER_COPY } from '@/components/program-builder/builder-text';
import { PROGRAMS_PATH } from '@/components/program-builder/routes';
import type { ProfileDTO } from '@/lib/dal/profiles';
import {
  NAME_WRAP_CLASS,
  NAV_RAIL_COPY,
  NAV_ROW_CLASS,
  SETTINGS_PATH,
  athletePath,
} from '@/lib/constants';
import { cn } from '@/lib/utils';

/**
 * The open row's treatment. One row wears it at a time: an athlete, Programs or Settings.
 *
 * **Outlined, not filled.** The first version was `bg-accent font-medium`, which put the row's muted
 * kind line on `--accent`, then 4.34:1, under AA (UI-5's 1280px axe run). Since `--muted-foreground`
 * moved to L 0.54 (tech debt, 2026-11-20) that pair measures 4.64:1 and passes; the outline stays as
 * a choice: `border-foreground` + `font-medium` reads as "this one" against the row's hairline
 * without filling one row of a list.
 */
const CURRENT_ROW_CLASS = 'border-foreground font-medium';

/** Ties the athlete list to its visible label without making that label a heading. */
const ATHLETES_LABEL_ID = 'nav-rail-athletes';

/** What the open page is, so the rail can mark it without reading the pathname. */
export type NavRailCurrent = { athlete: string } | 'programs' | 'settings';

/**
 * The nav rail (`UI-5`) — **the athlete switcher**, not a list of links.
 *
 * 🔴 **The maintainer chose this over two static links (2026-11-13), and the reason is the app's
 * actual shape.** `/p` is the one top-level place and everything else hangs off an athlete, so a
 * rail that lists athletes gives a laptop the one thing a phone cannot: switch kid **without a round
 * trip through `/p`** — which is the stated laptop case, logging a missed day for one kid and then
 * building next week for another. Two links would have put "the page you are already on" at the top
 * of both `/p` and `/settings`.
 *
 * **It invents no destination.** Every item here is a link `/p` already renders.
 *
 * ⚠️ **A server component, deliberately.** `aria-current` wants `usePathname()`, which would make
 * this `'use client'` on every authenticated page. It is not needed: the page knows what it is and
 * passes `current`. This PR ships no client component at all.
 *
 * ⚠️ **The label is "Settings", not `SETTINGS_COPY.heading`** — the reasoning lives on
 * `NAV_RAIL_COPY`'s docblock, which is where it belongs; this is a pointer.
 *
 * ⚠️ **Archived athletes are absent** — the list comes from `listProfiles()`, which drops them
 * (`PROF-1` b criterion 5). Household settings is where an archived athlete is reachable, and that
 * is the last row.
 */
export function NavRail({
  athletes,
  current,
}: {
  athletes: readonly ProfileDTO[];
  current?: NavRailCurrent;
}) {
  const currentAthlete = typeof current === 'object' ? current.athlete : undefined;

  return (
    <nav
      aria-label={NAV_RAIL_COPY.label}
      // `hidden lg:flex` is plain CSS on plain links — permitted, unlike hiding a live region, which
      // `announcer.tsx` rule 3 forbids. `sticky top-0` so the rail stays put on a long day page.
      //
      // ⚠️ **`max-h-screen` is not decoration.** A sticky element TALLER than the
      // scrollport is pinned at `top: 0` with its tail unreachable until the page scrolls to its
      // end — so the Settings row, which is last, would be invisible on a laptop. The household cap
      // is `MAX_HOUSEHOLD_ATHLETES` (25). A row is 20px (`text-sm`) + 16 (`text-xs`) + 24 (`py-3`)
      // + 2 (border) = **62px**, 82 with a wrapped name — so 25 athletes is ~1.8k px, well past a
      // 1366×768 laptop's ~650px of viewport. (An earlier draft of this comment said ~50px; the
      // conclusion only gets stronger with the real number.) Today's three-athlete household never hits it; the households
      // the product allows do. The rail caps its own height and the LIST inside it scrolls — never
      // the grid or `<main>`, which would take the document's scrolling over (see `app-shell.tsx`).
      className="hidden lg:sticky lg:top-0 lg:flex lg:max-h-screen lg:flex-col lg:gap-2 lg:p-4"
    >
      {/*
        🔴 **A `<p>`, not an `<h2>`.** The rail precedes the page's `<h1>` in the DOM on every
        screen, so a heading here puts a level-2 before the level-1 in the heading list — and on
        `/settings` at `lg` it is the SECOND "Athletes" heading, naming a different list (rail links
        vs archive controls). ⚠️ Neither is visible to CI: `heading-order` and `landmark-unique` are
        axe `best-practice` rules and the scan runs `wcag2a`/`wcag2aa`. The `<nav>`'s own
        `aria-label` already names the region; this label just ties itself to the list it sits over.
      */}
      <p
        id={ATHLETES_LABEL_ID}
        className="text-muted-foreground px-1 text-xs font-semibold tracking-wide uppercase"
      >
        {NAV_RAIL_COPY.athletes}
      </p>

      {/*
        🔴 **The LIST scrolls, not the whole rail.** `max-h-screen overflow-y-auto` on the `<nav>`
        made Settings *reachable* on a large household; it did not make it *near* — it is the last
        row, so a parent on a 1366×768 laptop with nine or more athletes scrolled the rail to find
        it. Confining the scroll to the `<ul>` (`min-h-0` so a flex child may shrink below its
        content) keeps Settings pinned below the fold line of the list, always visible, with the
        keyboard order unchanged.
      */}
      <ul
        aria-labelledby={ATHLETES_LABEL_ID}
        className="flex min-h-0 flex-col gap-1 overflow-y-auto"
      >
        {athletes.map((athlete) => {
          const isCurrent = athlete.id === currentAthlete;
          return (
            <li key={athlete.id}>
              <Link
                href={athletePath(athlete.id)}
                aria-current={isCurrent ? 'page' : undefined}
                className={cn('group', NAV_ROW_CLASS, isCurrent && CURRENT_ROW_CLASS)}
              >
                {/* 🔴 `NAME_WRAP_CLASS`, not `truncate` — PROF-1 D11 is "every element that renders
                    an athlete's name", and its docblock already records that the rule drifted once.
                    The row is 190px wide here (256 − `p-4` − `px-4` − border), which ellipsises at
                    ~27 characters against a 40-character cap, so two siblings sharing a prefix would
                    read as the same row. The `<h1>` on the same page wraps the same name. */}
                <span className={cn('text-sm', NAME_WRAP_CLASS)}>{athlete.name}</span>
                {/* The kind, as the picker tile shows it — the same name/kind PAIR, at the rail's
                    smaller scale (`text-sm`/`text-xs` here against the tile's `text-lg`/`text-sm`),
                    not the same type sizes. The app PERMITS duplicate names and
                    `/edit` records that a tile "shows name AND kind, so a Child and an Adult sharing
                    a name are already distinct" — a second switcher without it would be two
                    identical rows. One display map, beside `PROFILE_KINDS`. */}
                {/* `group-hover:text-foreground`: `NAV_ROW_CLASS` fills the row with `--accent` on
                    hover. Muted text on accent was 4.34:1 when this was written; since
                    `--muted-foreground` moved to L 0.54 it is 4.64:1 and passes, and
                    `token-sets.test.ts` pins muted text on every ground. Un-muting on hover stays as
                    a choice: the hovered row reads a step stronger. */}
                <span className="text-muted-foreground group-hover:text-foreground text-xs">
                  {PROFILE_KIND_LABELS[athlete.kind]}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>

      {/* FAM-1 7b-i (a board-granted guest edit): Programs above Settings, as on Home. Its label is
          the builder's own word, so the rail and the page's `<h1>` cannot drift. */}
      {/* Two links, so a list, as Home's Household nav is. */}
      <ul className="mt-2 flex flex-col gap-2">
        <li>
          <Link
            href={PROGRAMS_PATH}
            aria-current={current === 'programs' ? 'page' : undefined}
            className={cn(NAV_ROW_CLASS, current === 'programs' && CURRENT_ROW_CLASS)}
          >
            <span className="text-sm">{BUILDER_COPY.programs}</span>
          </Link>
        </li>
        <li>
          <Link
            href={SETTINGS_PATH}
            aria-current={current === 'settings' ? 'page' : undefined}
            className={cn(NAV_ROW_CLASS, current === 'settings' && CURRENT_ROW_CLASS)}
          >
            <span className="text-sm">{NAV_RAIL_COPY.settings}</span>
          </Link>
        </li>
      </ul>
    </nav>
  );
}
