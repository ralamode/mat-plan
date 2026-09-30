import Link from 'next/link';

import { addDays, formatDayLong, formatDayShort, isoDayDiff, localWeekStartIso } from '@/lib/date';

/**
 * The date line, and the controls that move it (V1-15).
 *
 * **This REPLACES the header's `<p>Today · {date}</p>`** — it does not sit beside it. The date has
 * exactly one home, and `formatDayLong` vs `formatDayShort` is chosen here by `isToday`: the long
 * form is ~240px and does not fit beside two 44px arrows inside the 328px available at 360px.
 *
 * A server component — two `<Link>`s and seven more, no client JS. Paging is a navigation, not a
 * fetch, which is also the cheapest answer to "don't hammer the API": one render per tap, and the
 * week strip turns a 9-tap journey into 2.
 */
export function DayNav({
  profileId,
  day,
  today,
  floor,
  dayRoleLabel,
}: {
  profileId: string;
  /** The day being viewed. */
  day: string;
  /** The active-tz today — the forward bound. */
  today: string;
  /** The profile's first day — the backward bound. */
  floor: string;
  /** What the PROGRAM says this day is ("Strength B") — derived metadata, travels with the day. */
  dayRoleLabel?: string;
}) {
  const isToday = day === today;
  const href = (d: string) => (d === today ? `/p/${profileId}` : `/p/${profileId}?d=${d}`);

  // The SAME effective floor `resolveViewedDay` uses: never later than the earliest writable day, or
  // the arrows would disable a day the resolver would happily render (and the server would accept).
  const earliestWritable = addDays(today, -1);
  const effectiveFloor = isoDayDiff(floor, earliestWritable) < 0 ? floor : earliestWritable;

  const prev = addDays(day, -1);
  const next = addDays(day, 1);
  const canGoBack = isoDayDiff(prev, effectiveFloor) >= 0;
  const canGoForward = isoDayDiff(next, today) <= 0;

  // The viewed day's week, Monday-first. Pure date arithmetic — ZERO new queries, which is what let
  // this come forward from the brainstorm's v1.x into v1: two chevrons cost 9 taps to reach last
  // Tuesday, and each tap is a full dynamic render.
  const weekStart = localWeekStartIso(day);
  const week = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  return (
    <nav aria-label="Change day" className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <DayArrow
          to={canGoBack ? href(prev) : null}
          label={`Previous day, ${formatDayLong(prev)}`}
          glyph="‹"
        />
        {/* The date itself is not a link — it is the current state, and a link to where you already
            are is a control that does nothing. */}
        <p className="text-muted-foreground flex-1 text-center text-sm">
          {isToday ? `Today · ${formatDayLong(day)}` : formatDayShort(day)}
          {dayRoleLabel ? ` · ${dayRoleLabel}` : ''}
        </p>
        <DayArrow
          to={canGoForward ? href(next) : null}
          label={`Next day, ${formatDayLong(next)}`}
          glyph="›"
        />
      </div>

      {/* 328px / 7 = 46.9px. `gap-0.5` (6 × 2px = 12px) leaves 45.1px each — over the 44px bar, but
          only just, which is why the arithmetic is written down rather than left to flex-wrap. */}
      <ul className="flex items-stretch gap-0.5">
        {week.map((d) => {
          const isViewed = d === day;
          const reachable = isoDayDiff(d, today) <= 0 && isoDayDiff(d, effectiveFloor) >= 0;
          const weekday = new Intl.DateTimeFormat('en-US', {
            weekday: 'narrow',
            timeZone: 'UTC',
          }).format(new Date(`${d}T00:00:00Z`));
          return (
            <li key={d} className="flex-1">
              {reachable ? (
                <Link
                  href={href(d)}
                  aria-current={isViewed ? 'date' : undefined}
                  aria-label={formatDayLong(d)}
                  className={`focus-visible:ring-ring flex min-h-11 items-center justify-center rounded-md border text-sm outline-none focus-visible:ring-2 ${
                    isViewed
                      ? 'bg-secondary text-secondary-foreground border-transparent font-medium'
                      : 'border-input hover:bg-accent'
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
                  {weekday}
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
      className={`focus-visible:ring-ring hover:bg-accent border-input outline-none focus-visible:ring-2 ${base}`}
    >
      {glyph}
    </Link>
  );
}
