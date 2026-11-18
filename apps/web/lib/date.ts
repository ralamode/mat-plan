import { addDays, isoDaySchema, localWeekday } from '@mat-plan/shared';

/**
 * Date helpers for the "declared date" of an entry (activity_date is a plain DATE,
 * not a timestamp).
 *
 * RULE (V1-6c): calendar dates & weekdays come from the ACTIVE IANA TIMEZONE; UTC is
 * only for exact moments (created_at/deleted_at timestamptz). "Today" is the local
 * calendar date in the active tz — never `new Date().toISOString().slice(0,10)` (that's
 * UTC, which rolls over mid-afternoon in the Pacific and shows tomorrow's workout).
 * These helpers are pure + injectable so the whole tz/DST matrix is fast unit tests; the
 * server resolves the active tz in `lib/active-timezone.ts`.
 */

/**
 * A declared date on the wire: `YYYY-MM-DD`.
 *
 * ⚠️ **Re-exported from `@mat-plan/shared` since `V1-9b` B1-1, not declared here.** The shared
 * package needed it for `hide.ts`'s wire schemas and cannot import from `apps/web`; two declarations
 * would be a day format free to disagree across the wire. Import it from either place — they are the
 * same object.
 */
export { isoDaySchema };

/**
 * The LOCAL date+time parts of the instant `now`, in `timeZone` — the shared `formatToParts`
 * primitive `localDayIso` and `localMinutesSinceMidnight` both build on (engine-proof: assembled
 * by part `type`, no reliance on a locale's format string). `hourCycle: 'h23'` so midnight is hour
 * `00` (not `12` on a 12-hour locale, nor `24` on `h24`). Uses the platform tz database → DST and
 * no-DST zones (Arizona, Hawaii) are handled without any manual offset math.
 */
function localDateParts(timeZone: string, now: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
  };
}

/**
 * The LOCAL calendar date (`YYYY-MM-DD`) of the instant `now`, in `timeZone`. NEVER
 * `toISOString().slice` (UTC) and NEVER `new Date("YYYY-MM-DD")` (parsed as UTC midnight).
 */
export function localDayIso(timeZone: string, now: Date = new Date()): string {
  const { year, month, day } = localDateParts(timeZone, now);
  return `${year}-${month}-${day}`;
}

/**
 * Whole minutes since LOCAL midnight of `now` in `timeZone` (0–1439). The wall-clock projection
 * `wake` stores in `value_num` (V1-7) so the clock renders tz-free at read time. `hourCycle:'h23'`
 * (via `localDateParts`) makes 00:00 → 0 and 23:59 → 1439 — a 12-hour hour part would map midnight
 * to 720. DST-safe: the tz database resolves the wall time; this is the wake CLOCK time, which is
 * what "average wake time" wants (not elapsed minutes).
 */
export function localMinutesSinceMidnight(timeZone: string, now: Date = new Date()): number {
  const { hour, minute } = localDateParts(timeZone, now);
  return Number(hour) * 60 + Number(minute);
}

/**
 * Format minutes-since-midnight (0–1439) as a local 12-hour clock string ("6:52 AM"). tz-FREE by
 * design: the minutes are anchored at UTC epoch and formatted in UTC, so no zone re-enters (the same
 * discipline as `formatDayLong`) — the caller already projected the local wall time into the number.
 */
export function minutesToClock(minutes: number): string {
  return (
    new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: 'UTC',
    })
      .format(new Date(minutes * 60_000))
      // Modern ICU (>=72) separates the time from AM/PM with a NARROW NO-BREAK SPACE (U+202F);
      // JS \s matches it, so normalize to a plain space -> display/test/e2e read "6:52 AM".
      .replace(/\s/g, ' ')
  );
}

/**
 * True iff `tz` is a resolvable IANA zone NAME. Dependency-free: the Intl constructor throws
 * `RangeError` on an unknown zone (more portable than `Intl.supportedValuesOf`). Used to validate
 * the client-supplied `tz` cookie before it's ever fed to date math.
 *
 * ⚠️ **A name, not a signed offset.** Intl also accepts a bare offset (`+05:00`, `-0500`).
 * Postgres reads a bare offset with the sign REVERSED (POSIX: `+05` is five hours WEST), so the same
 * cookie would name two different days on the two sides the moment a query does zone math with it.
 * So this passes an `Area/Location` name (which includes `Etc/GMT+5`, whose sign both sides read the
 * same way), exactly `UTC`, or a ZERO offset: a device set to GMT reports `+00:00`
 * (`resolvedOptions().timeZone`), and a zero offset has no sign to reverse. Abbreviations without a
 * `/` (`EST`, `GMT`) are refused too, not because their sign is reversed but because a real device
 * reports the canonical name instead. What a refusal means is the caller's: `active-timezone.ts`
 * falls back to the default zone, `screenshot-ephemeral.ts` exits.
 */
const ZERO_OFFSET = /^[+-]00(?::?00)?$/;

export function isIanaTimeZone(tz: string | null | undefined): tz is string {
  if (!tz) return false;
  if (tz !== 'UTC' && !ZERO_OFFSET.test(tz) && !tz.includes('/')) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * The Monday that starts the ISO-week containing the calendar date `day` (`YYYY-MM-DD`).
 *
 * THE week-boundary seam (V1-6b-2): feed it a LOCAL day (`localDayIso(activeTz)`); V1-15 day-nav
 * and any dashboard ISO-week bucketing should reuse this, not re-encode weekday math. Monday-based
 * (ISO-8601), matching `ramp_targets.week_start`. Pure UTC-epoch integer-day arithmetic on the safe
 * `…T00:00:00Z` parse (NEVER `new Date("YYYY-MM-DD")`): `day` is already a bare local calendar date,
 * so no zone is reinterpreted and DST never enters — the Monday is always correct.
 */
export function localWeekStartIso(day: string): string {
  // `localWeekday` is 0=Sun … 6=Sat; Mon→0 … Sun→6 steps back to THIS week's Monday.
  return addDays(day, -((localWeekday(day) + 6) % 7));
}

/**
 * A day in a sentence, as the day page's date line names it: `today`, or `on Tue, Nov 10`
 * (`formatDayShort`). Shared by every "… today / on <day>" line, so they cannot drift.
 */
export function onDayText(day: string, today: string): string {
  return day === today ? 'today' : `on ${formatDayShort(day)}`;
}

/**
 * Human-readable long date from a `YYYY-MM-DD` calendar date.
 *
 * Anchored at UTC midnight and formatted in UTC BY DESIGN — and it deliberately takes NO
 * `timeZone` param. A bare calendar date has exactly one weekday, tz-invariant, so this
 * renders it correctly; re-interpreting the date-only value through a zone here would
 * reintroduce an off-by-one. The active tz belongs in computing the day (`localDayIso`),
 * never in formatting it. Feed this the LOCAL day so the header weekday matches the plan.
 */
export function formatDayShort(iso: string): string {
  // `Tue, Sep 22` ≈ 90px against `formatDayLong`'s ≈ 240px. The nav row carries two 44px arrows and a
  // Today control inside 328px, so the long form does not fit off-today. Same UTC anchoring and the
  // same no-timeZone-param reasoning as the long form below.
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${iso}T00:00:00Z`));
}

export function formatDayLong(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${iso}T00:00:00Z`));
}
