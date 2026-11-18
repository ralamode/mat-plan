import { addDays, isoDayDiff } from '@mat-plan/shared';
import { athletePath, LOOK_AHEAD_DAYS, TICK_FOCUS_CLASS } from '@/lib/constants';
import Link from 'next/link';

import { formatDayLong, formatDayShort, localWeekStartIso } from '@/lib/date';

/**
 * The date line, and the controls that move it (V1-15).
 *
 * **This REPLACES the header's `<p>Today · {date}</p>`** — it does not sit beside it. The date has
 * exactly one home, and `formatDayLong` vs `formatDayShort` is chosen by `dayLine`. Off today the
 * short form ("Yesterday · Mon, Nov 16", ~160px) fits the 224px between the arrows at 360px. Today
 * keeps the long form (~250px), which wraps to two 20px lines there: inside the 44px row, so
 * nothing moves, and the full date is worth the second line on the day it is logged.
 *
 * A server component — two `<Link>`s and seven more, no client JS. Paging is a navigation, not a
 * fetch, which is also the cheapest answer to "don't hammer the API": one render per tap, and the
 * week strip turns a 9-tap journey into 2.
 */
/**
 * Which days the arrows and the week strip reach (FAM-1 12c): one rule for both, so a link labelled
 * "Thursday" never renders another day.
 *
 * - **Back:** to the same effective floor `resolveViewedDay` uses: never later than the earliest
 *   writable day, or the arrows would disable a day the resolver would render (and the server would
 *   accept).
 * - **Forward:** to today, and past it only as look-ahead: one day further while the athlete is on
 *   a program the next day (`DayPlan.canGoForward`, the resolver's), and never past today plus
 *   `LOOK_AHEAD_DAYS`. A future day already being
 *   viewed, and the days between it and today, stay reachable.
 * - **The viewed day is always reachable**, so the strip always carries one `aria-current`.
 */
export function dayNavBounds(args: {
  day: string;
  today: string;
  floor: string;
  canGoForward: boolean;
}) {
  const { day, today, floor, canGoForward } = args;
  const earliestWritable = addDays(today, -1);
  const effectiveFloor = isoDayDiff(floor, earliestWritable) < 0 ? floor : earliestWritable;
  // The furthest forward day: today, the viewed day if it is later, then one more on look-ahead.
  const viewedOrToday = isoDayDiff(day, today) > 0 ? day : today;
  const stepped =
    canGoForward && isoDayDiff(addDays(day, 1), today) > 0 ? addDays(day, 1) : viewedOrToday;
  // Never past the horizon (`LOOK_AHEAD_DAYS`, maintainer 2026-11-17), whatever the program holds.
  const horizon = addDays(today, LOOK_AHEAD_DAYS);
  const forwardLimit = isoDayDiff(stepped, horizon) > 0 ? horizon : stepped;
  const reachable = (d: string) =>
    d === day || (isoDayDiff(d, effectiveFloor) >= 0 && isoDayDiff(d, forwardLimit) <= 0);
  return {
    reachable,
    canGoBack: reachable(addDays(day, -1)),
    canGoForward: reachable(addDays(day, 1)),
  };
}

/** The date line: v12's `dayLabel`, short off-today so it fits between the arrows at 360px. */
export function dayLine(day: string, today: string): string {
  const offset = isoDayDiff(day, today);
  if (offset === 0) return `Today · ${formatDayLong(day)}`;
  if (offset === -1) return `Yesterday · ${formatDayShort(day)}`;
  if (offset === 1) return `Tomorrow · ${formatDayShort(day)}`;
  return formatDayShort(day);
}

export function DayNav({
  profileId,
  day,
  today,
  floor,
  canGoForward = false,
  dayRoleLabel,
}: {
  profileId: string;
  /** The day being viewed. */
  day: string;
  /** The active-tz today. */
  today: string;
  /** The profile's first day — the backward bound. */
  floor: string;
  /** Look-ahead: the athlete is on a program the next day (`DayPlan.canGoForward`). */
  canGoForward?: boolean;
  /** What the PROGRAM says this day is ("Strength B") — derived metadata, travels with the day. */
  dayRoleLabel?: string;
}) {
  const href = (d: string) =>
    d === today ? athletePath(profileId) : `${athletePath(profileId)}?d=${d}`;
  const bounds = dayNavBounds({ day, today, floor, canGoForward });

  const prev = addDays(day, -1);
  const next = addDays(day, 1);

  // The viewed day's week, Monday-first. Pure date arithmetic — ZERO new queries, which is what let
  // this come forward from the brainstorm's v1.x into v1: two chevrons cost 9 taps to reach last
  // Tuesday, and each tap is a full dynamic render.
  const weekStart = localWeekStartIso(day);
  const week = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  return (
    <nav aria-label="Change day" className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <DayArrow
          to={bounds.canGoBack ? href(prev) : null}
          label={`Previous day, ${formatDayLong(prev)}`}
          glyph="‹"
        />
        {/* The date itself is not a link — it is the current state, and a link to where you already
            are is a control that does nothing. */}
        <p className="text-muted-foreground flex-1 text-center text-sm">
          {dayLine(day, today)}
          {dayRoleLabel ? ` · ${dayRoleLabel}` : ''}
        </p>
        <DayArrow
          to={bounds.canGoForward ? href(next) : null}
          label={`Next day, ${formatDayLong(next)}`}
          glyph="›"
        />
      </div>

      {/* 328px / 7 = 46.9px. `gap-0.5` (6 × 2px = 12px) leaves 45.1px each — over the 44px bar, but
          only just, which is why the arithmetic is written down rather than left to flex-wrap. */}
      <ul className="flex items-stretch gap-0.5">
        {week.map((d) => {
          const isViewed = d === day;
          const reachable = bounds.reachable(d);
          const weekday = new Intl.DateTimeFormat('en-US', {
            weekday: 'narrow',
            timeZone: 'UTC',
          }).format(new Date(`${d}T00:00:00Z`));
          return (
            <li key={d} className="flex-1">
              {reachable ? (
                <Link
                  href={href(d)}
                  // `true`, not `date`: "the current date" read on the viewed day contradicted the
                  // ", today" on today's cell once look-ahead put them apart (12c review).
                  aria-current={isViewed ? 'true' : undefined}
                  aria-label={d === today ? `${formatDayLong(d)}, today` : formatDayLong(d)}
                  className={`${TICK_FOCUS_CLASS} flex min-h-11 items-center justify-center rounded-md border text-sm ${
                    isViewed
                      ? // The athlete switcher's mark for "current", one row up: the viewed day is
                        // the strongest mark in the strip, today's underline the second.
                        'bg-primary text-primary-foreground border-primary font-medium'
                      : 'border-input hover:bg-accent'
                  } ${
                    // Today, marked by more than colour: once look-ahead reaches past it, it is no
                    // longer simply the last day that can be opened (FAM-1 12c).
                    d === today ? 'underline decoration-2 underline-offset-4' : ''
                  }`}
                >
                  {weekday}
                </Link>
              ) : (
                // Present but disabled, never absent: a gap in the strip reads as a rendering bug,
                // and a screen reader should hear that the day exists and is unavailable.
                <span
                  aria-disabled="true"
                  className="text-muted-foreground/40 border-input/40 flex min-h-11 items-center justify-center rounded-md border text-sm"
                >
                  {/* One letter names two days ("T", "S"), so a screen reader hears the date. */}
                  <span aria-hidden="true">{weekday}</span>
                  <span className="sr-only">{`${formatDayLong(d)}, not available`}</span>
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * One chevron.
 *
 * A **`<button disabled>`** at the bound rather than a `<span>`: a screen reader announces it as
 * unavailable instead of skipping it silently, and `INTERACTIVE` in the a11y spec catches a
 * `<button>`, so its 44px is actually measured.
 *
 * Dimmed with a **muted foreground token**, never `opacity-40` — a 40%-opacity glyph is a live
 * `color-contrast` failure, and that is a rule the gate does catch.
 */
function DayArrow({ to, label, glyph }: { to: string | null; label: string; glyph: string }) {
  const base =
    'flex min-h-11 min-w-11 items-center justify-center rounded-md border text-lg leading-none';
  if (!to) {
    return (
      <button type="button" disabled aria-label={label} className={`${base} text-muted-foreground`}>
        {glyph}
      </button>
    );
  }
  return (
    // `prefetch={false}`: these are two of nine links on the page, and the route is force-dynamic —
    // prefetching them buys a skeleton, not data, and costs a request per link entering the viewport.
    <Link
      href={to}
      prefetch={false}
      aria-label={label}
      className={`${TICK_FOCUS_CLASS} hover:bg-accent border-input ${base}`}
    >
      {glyph}
    </Link>
  );
}
