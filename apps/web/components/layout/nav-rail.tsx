import Link from 'next/link';

import type { ProfileDTO } from '@/lib/dal/profiles';
import { NAV_RAIL_COPY, NAV_ROW_CLASS, SETTINGS_PATH, athletePath } from '@/lib/constants';
import { cn } from '@/lib/utils';

/** What the open page is, so the rail can mark it without reading the pathname. */
export type NavRailCurrent = { athlete: string } | 'settings';

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
 * ⚠️ **The label is "Settings", not `SETTINGS_COPY.heading`.** The archived day page, `/p/new` and
 * `/edit` each render "Household settings" as a prose link, and two visible links with the same
 * accessible name on one page is the Playwright strict-mode collision this repo has already shipped
 * once.
 *
 * ⚠️ **Archived athletes are absent** — the list comes from `listProfiles()`, which drops them
 * (`PROF-1` b criterion 5). Household settings is where an archived athlete is reachable, and that
 * is the row below.
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
      className="hidden lg:sticky lg:top-0 lg:flex lg:flex-col lg:gap-2 lg:p-4"
    >
      <h2 className="text-muted-foreground px-1 text-xs font-semibold tracking-wide uppercase">
        {NAV_RAIL_COPY.athletes}
      </h2>

      <ul className="flex flex-col gap-1">
        {athletes.map((athlete) => {
          const isCurrent = athlete.id === currentAthlete;
          return (
            <li key={athlete.id}>
              <Link
                href={athletePath(athlete.id)}
                aria-current={isCurrent ? 'page' : undefined}
                className={cn(NAV_ROW_CLASS, isCurrent && 'bg-accent font-medium')}
              >
                <span className="truncate text-sm">{athlete.name}</span>
              </Link>
            </li>
          );
        })}
      </ul>

      <Link
        href={SETTINGS_PATH}
        aria-current={current === 'settings' ? 'page' : undefined}
        className={cn(NAV_ROW_CLASS, 'mt-2', current === 'settings' && 'bg-accent font-medium')}
      >
        <span className="text-sm">{NAV_RAIL_COPY.settings}</span>
      </Link>
    </nav>
  );
}
