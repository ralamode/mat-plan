import type { DayPlan } from '@mat-plan/shared';
import Link from 'next/link';

import { NAME_WRAP_CLASS, TICK_FOCUS_CLASS } from '@/lib/constants';
import { cn } from '@/lib/utils';

import { PROGRAM_COPY } from './day-copy';

/**
 * Each athlete's label: their first name, or the whole name where two share a first name (the seed
 * household's "Athlete One" and "Athlete Two"). Compared ignoring case, so "Sam" and "sam" count as one
 * first name.
 */
export function switcherLabels(athletes: DayPlan['athletes']): string[] {
  const first = (name: string) => name.trim().split(/\s+/)[0] ?? name;
  const key = (name: string) => first(name).toLocaleLowerCase();
  const counts = new Map<string, number>();
  for (const a of athletes) counts.set(key(a.name), (counts.get(key(a.name)) ?? 0) + 1);
  return athletes.map((a) => (counts.get(key(a.name))! > 1 ? a.name : first(a.name)));
}

/**
 * The household's athletes, as first-name pills under the athlete's name (FAM-1 step 13d).
 *
 * **Placed by the page, not by `DayScreen`** (maintainer, 2026-11-16): v12 has it at the top of the
 * page, by the `<h1>`, and the screen is mounted after Bodyweight and Life. It takes the same
 * `DayPlan` the screen does.
 *
 * Decisions (maintainer, 2026-11-16, from the UX panel): **first names, not v12's initials** (a kid
 * reads "Athlete Two"; "At" and "AT" differ only by case, and 44px initials fit only three beside
 * the name at 360px), in **their own wrapping row**; and **a switch opens that athlete's today**,
 * as v12 and the nav rail do, so `hrefFor` gives the athlete's page with no day.
 *
 * No `'use client'`: it holds no state, so the page renders it on the server and the preview can
 * pass a function for `hrefFor`. Hidden when no one else is listed (a household of one).
 */
export function AthleteSwitcher({
  plan,
  hrefFor,
  className,
}: {
  plan: DayPlan;
  hrefFor: (profilePublicId: string) => string;
  /** The placer's: the day page passes `lg:hidden`, since from `lg` its nav rail lists the athletes. */
  className?: string;
}) {
  // Hidden only with nowhere to go. Not a count: `athletes` leaves an archived athlete out, so on
  // their day the list holds only the others, and one live athlete is the way back.
  if (!plan.athletes.some((a) => a.profilePublicId !== plan.profilePublicId)) return null;
  // Whole names when the viewed athlete is not listed (archived): their name is not here to be
  // told apart from, so "Athlete" under "Athlete Two" would read as "this is you".
  const viewedListed = plan.athletes.some((a) => a.profilePublicId === plan.profilePublicId);
  const labels = viewedListed ? switcherLabels(plan.athletes) : plan.athletes.map((a) => a.name);
  return (
    <nav aria-label={PROGRAM_COPY.switcher} className={className}>
      <ul className="flex flex-wrap gap-2">
        {plan.athletes.map((athlete, index) => {
          const current = athlete.profilePublicId === plan.profilePublicId;
          return (
            <li key={athlete.profilePublicId} className="min-w-0">
              <Link
                href={hrefFor(athlete.profilePublicId)}
                aria-current={current ? 'page' : undefined}
                className={cn(
                  // The ✓'s foreground outline (≥3:1, WCAG 1.4.11): `FOCUS_TARGET_CLASS` is for an
                  // element focused by script, and its `ring/50` is ~1.5:1 on a Tab stop (12c panel).
                  TICK_FOCUS_CLASS,
                  'inline-flex min-h-11 max-w-full min-w-11 items-center justify-center rounded-full border px-4 text-sm font-medium',
                  NAME_WRAP_CLASS,
                  current
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background text-foreground',
                )}
              >
                {labels[index]}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
