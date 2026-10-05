import { DAY_ROLE_LABELS } from '@mat-plan/shared';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { EmptyState } from '@/components/ui/empty-state';
import { getActiveTimeZone } from '@/lib/active-timezone';
import { CHECKIN_FIELDS } from '@/lib/checkins/checkin-fields';
import { formatDayShort, localDayIso, localWeekStartIso } from '@/lib/date';
import { isWritableDay, resolveViewedDay } from '@/lib/entries/declared-day';
import { getWeeklyAdherence } from '@/lib/dal/adherence';
import { listEntriesForDay } from '@/lib/dal/entries';
import { requireGatedPage } from '@/lib/dal/gate';
import { getProfileByPublicId } from '@/lib/dal/profiles';
import { getProgramDay } from '@/lib/dal/programming';
import { resolveDayRole } from '@/lib/programming/day-role-schedule';
import {
  calisthenicsTotals,
  loggedBodyweight,
  type SessionRow,
  todayRows,
} from '@/lib/entries/activity-totals';
import {
  buildRoutineBlocks,
  checkinFieldsForKeys,
  lifeActivitiesForKeys,
} from '@/lib/routine/catalog';

import { LIFE_ACTIVITY_KEYS } from '@/lib/life/life-activities';

import { APP_HOME_PATH, CLOSED_DAY_NOTICE } from '@/lib/constants';
import { BodyweightSection } from './bodyweight-section';
import { CheckinForm } from './checkin-form';
import { LifeForm } from './life-form';
import { MovementLine } from './movement-line';
import { StrengthSection } from './strength-section';
import { sessionOrdinals, StrengthSessionReceipt } from './strength-session-receipt';
import { DayNav } from './day-nav';
import { TimeZoneSync } from './tz-sync';
import { WeeklyAdherence } from './weekly-adherence';

// Route-segment config must be a static inline literal (Next can't follow an
// imported const), so 'nodejs' stays here. pg → Node runtime, not Edge.
export const runtime = 'nodejs';

export default async function TodayPage({
  params,
  searchParams,
}: {
  params: Promise<{ profileId: string }>;
  // Next 16: a Promise, and `?d=a&d=b` arrives as an array.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireGatedPage(); // SEC-1: the proxy is not the boundary
  const { profileId } = await params;
  // Re-validate the URL-supplied public id server-side (the V1-3 ownership seam;
  // profile tiles are a UX switch, not a security boundary). Unknown → 404.
  const profile = await getProfileByPublicId(profileId);
  if (!profile) notFound();

  // "Today" is the LOCAL calendar date in the request's active tz (V1-6c) — the client
  // reports its zone via the `tz` cookie (see TimeZoneSync); the RSC validates + uses it,
  // falling back to DEFAULT_TIME_ZONE on first paint. The header weekday derives from this
  // same `day`, so date & weekday can't disagree.
  const timeZone = await getActiveTimeZone();
  const today = localDayIso(timeZone);
  // V1-15: the VIEWED day — today, or a validated `?d=`. Clamped forward to today and floored at the
  // profile's first day; a malformed value renders today rather than 404ing, because every date is a
  // legal day and a stale URL should land somewhere usable.
  const { d } = await searchParams;
  const day = resolveViewedDay(typeof d === 'string' ? d : undefined, today, profile.firstDay);
  const isToday = day === today;
  // Two booleans, deliberately: `isToday` drives COPY, `isWritable` drives FORMS. Conflating them is
  // how yesterday would have lost its forms — the server accepts a write within ±1 day
  // (`resolveDeclaredDay`), and the UI must not be stricter than the endpoint it fronts.
  const writable = isWritableDay(day, today);
  const weekStart = localWeekStartIso(day);
  // V1-10: which day the PROGRAM says this is, from the same active-tz `day` the header renders — so
  // the card can't claim Monday while the header says Sunday. TOTAL since the youth daily A/B rotation
  // landed (`resolveDayRole(day): DayRole`, no rest days), so there is no "not a programmed day" branch
  // to guard: every calendar day resolves to a role and reads its program.
  const dayRole = resolveDayRole(day);
  // Independent reads → one round-trip (hot page, INP/LCP budget). `adherence` is [] until the ramp
  // schedule is seeded (V1-6b-1 ships it empty), so the "This week" section stays hidden today;
  // `programDay` is [] when the kid's household has no block for today's role.
  const [entries, adherence, programDay] = await Promise.all([
    listEntriesForDay(profile.id, day),
    getWeeklyAdherence(profile.id, weekStart),
    getProgramDay(profile.id, dayRole),
  ]);

  // Which check-in fields are already logged today — derived from the entries we just
  // fetched, so the form's inert state costs no extra query. A field's identity is
  // `activityKey` (bare habit) or `activityKey:metricKey` (metric), matching the registry.
  // Accumulating fields (calisthenics) are EXCLUDED: they log multiple bouts a day, so they
  // must stay editable rather than go inert after the first reading.
  const accumulatingKeys = new Set(CHECKIN_FIELDS.filter((f) => f.accumulates).map((f) => f.key));
  const loggedFieldKeys = entries
    .filter((e) => e.activityKey !== null)
    .map((e) => (e.metricKey === null ? e.activityKey! : `${e.activityKey}:${e.metricKey}`))
    .filter((k) => !accumulatingKeys.has(k));

  // V1-7: which life activities (wake / wrestling practice) are already logged today, so their
  // one-tap buttons render inert. Derived from the same fetched entries (no extra query).
  const loggedLifeKeys = entries
    .map((e) => e.activityKey)
    .filter(
      (k): k is string => k !== null && (LIFE_ACTIVITY_KEYS as readonly string[]).includes(k),
    );

  // V1-24 PR 1a: every bodyweight row on the day (usually zero or one) — what makes the weigh-in
  // surface render the RECEIPT instead of an empty input. Derived from the entries already fetched
  // above (no extra query), the `loggedFieldKeys` idiom.
  const bodyweight = loggedBodyweight(entries);

  // V1-6a: the calisthenics tally — today's per-metric totals, folded from the day's entries.
  const calisTotals = calisthenicsTotals(entries);
  // Display rows for the "Logged entries" list: calisthenics bouts grouped into one row per
  // exercise (so repeated bouts don't read as duplicate rows), everything else individual.
  const rows = todayRows(entries);
  // V1-24 3a-ii: today's strength sessions feed the strength section; the list reuses the receipt.
  const sessionRows = rows.filter((r): r is SessionRow => r.kind === 'session');
  const ordinals = sessionOrdinals(sessionRows);
  // Whether the strength SECTION renders: if it does, it owns Change and the list copy is read-only.
  const routineBlocks = buildRoutineBlocks(profile.routine.order);
  const strengthOnPage = routineBlocks.some((b) => b.kind === 'strength');

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-4 py-12">
      {/* Reports the device tz → `tz` cookie so the RSC computes the local day (V1-6c). Renders nothing. */}
      <TimeZoneSync serverTimeZone={timeZone} />
      <header className="flex flex-col gap-2">
        <Link
          href={APP_HOME_PATH}
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring w-fit rounded-sm text-sm outline-none focus-visible:ring-3"
        >
          ← All profiles
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">{profile.name}</h1>
        {/* V1-23 D1: the day ROLE rides the date line, so "which day is it?" is answered in the band
            that already answers "what day is it?" — before V1-23 the letter was only visible inside
            the program card, a screenful down. This is DERIVED page metadata (what the calendar says
            via `resolveDayRole`), NOT the human's assertion: the athlete's assertion stays the
            `dayRole` select in `StrengthForm`, positioned after every movement card and immediately
            before submit, which is what makes the GAP-1 P0-1 provenance contract real (position, not
            visibility). Label via the SHARED `DAY_ROLE_LABELS` — no second map. It reads "Strength B"
            while the program is colloquially Day B because `strength_a`/`strength_b` are a documented
            temporary reuse of the roles (see `resolveDayRole`); not fixed here. */}
        {/* V1-15: DayNav REPLACES this line rather than sitting beside it — the date has exactly one
            home, and rendering it twice (once reworded, once in the nav) is how a "small" header
            change becomes a visual bug. The day ROLE stays here, appended, because it is derived page
            metadata about the day being viewed and travels with it. */}
        <DayNav
          profileId={profileId}
          day={day}
          today={today}
          floor={profile.firstDay}
          dayRoleLabel={DAY_ROLE_LABELS[dayRole]}
        />
        {/* V1-13b — the MVP's whole point: the CSV tree the Claude workflow consumes. A plain <a>,
            not a <Link>: this is a file download, and Next's client router would try to navigate to
            a zip. `download` names it, and `min-h-11` keeps it on the tap-target bar. */}
        <a
          href={`/p/${profileId}/export`}
          download
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex min-h-11 w-fit items-center rounded-sm text-sm outline-none focus-visible:ring-3"
        >
          ↓ Export CSV
        </a>
      </header>

      {/* V1-18: the logging surfaces render in this kid's OWN routine order (`profile.routine`, resolved by
          the DAL). Weigh-in is pinned FIRST by construction (bodyweight is never a routine `order` key), then
          each block — a contiguous run of check-ins/life collapses into one existing form (batch submit +
          single island preserved). A NULL config resolves to the default routine = today's exact order.
          Scope of "own order" (slice 1): the routine orders BLOCKS. WITHIN a check-in block, fields still
          render in `CheckinForm`'s group order (by `groupLabel`), not the authored per-key order — true
          per-key interleave inside check-ins is a later concern. Strength is routine-DRIVEN (the default +
          seeds include it); a config that omits `strength` shows no strength block (the routine is the
          selection — PR 2/V1-10 own an "always offer strength" affordance if wanted). */}
      {/* V1-15: ONE notice, above the blocks, when the viewed day is outside the server's write
          window. The forms below are gated on the SAME `writable`, so what the athlete can reach and
          what `resolveDeclaredDay` accepts cannot drift. An unexplained absence reads as a bug —
          which is the finding that explains the 2026-09-28 incident. */}
      {!writable ? (
        <p className="border-input text-muted-foreground rounded-lg border border-dashed px-4 py-3 text-sm">
          {CLOSED_DAY_NOTICE}
        </p>
      ) : null}

      <div className="flex flex-col gap-6">
        {/* V1-24 PR 1a — the day's state, not an empty form over a record. See the section. */}
        <BodyweightSection
          profileId={profile.id}
          day={day}
          writable={writable}
          logged={bodyweight}
        />
        {routineBlocks.map((block, i) => {
          if (block.kind === 'strength') {
            // V1-24 3a-ii: the section is the day's strength RECORD (receipts + the collapsible form).
            return (
              <StrengthSection
                key={`b${i}`}
                headingId={`str-${i}`}
                profileId={profile.id}
                day={day}
                writable={writable}
                dayRole={dayRole}
                programDay={programDay}
                sessions={sessionRows}
              />
            );
          }
          if (block.kind === 'checkins') {
            const fields = checkinFieldsForKeys(block.keys);
            if (fields.length === 0) return null; // an empty run renders nothing (mirrors the old guard)
            return (
              <section
                key={`b${i}`}
                aria-labelledby={`checkins-${i}`}
                className="flex flex-col gap-3"
              >
                <h2 id={`checkins-${i}`} className="text-lg font-medium">
                  Check-ins
                </h2>
                {writable ? (
                  <CheckinForm
                    profileId={profile.id}
                    day={day}
                    fields={fields}
                    loggedFieldKeys={loggedFieldKeys}
                  />
                ) : null}
              </section>
            );
          }
          if (lifeActivitiesForKeys(block.keys).length === 0) return null; // empty run → render nothing
          return (
            <section key={`b${i}`} aria-labelledby={`life-${i}`} className="flex flex-col gap-3">
              <h2 id={`life-${i}`} className="text-lg font-medium">
                Life
              </h2>
              {writable ? (
                <LifeForm
                  profileId={profile.id}
                  day={day}
                  loggedLifeKeys={loggedLifeKeys}
                  activityKeys={block.keys}
                />
              ) : null}
            </section>
          );
        })}
      </div>

      {calisTotals.length > 0 ? (
        <section
          aria-labelledby="calisthenics-total-heading"
          className="flex flex-col gap-2 rounded-lg border px-4 py-3"
        >
          <h2 id="calisthenics-total-heading" className="text-lg font-medium">
            {isToday ? 'Calisthenics today' : 'Calisthenics'}
          </h2>
          <ul className="flex flex-col gap-1">
            {calisTotals.map((t) => (
              <li key={t.metricKey} className="flex items-center justify-between tabular-nums">
                <span>{t.label}</span>
                <span className="font-medium">
                  {t.total}
                  {t.readings > 1 ? (
                    <span className="text-muted-foreground ml-2 text-sm">{t.readings} sets</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {adherence.length > 0 ? <WeeklyAdherence rows={adherence} /> : null}

      <section aria-labelledby="entries-heading">
        {/* Visible when the strength section ALSO shows today's sessions (V1-24 3a-ii UX review): two
            identical unlabelled cards read as a double-log, which has no in-app undo. 3b demotes the
            list properly. */}
        <h2
          id="entries-heading"
          className={
            strengthOnPage && sessionRows.length > 0
              ? 'text-muted-foreground text-sm font-medium'
              : 'sr-only'
          }
        >
          Logged entries
        </h2>

        {rows.length === 0 ? (
          <EmptyState>
            {isToday ? 'No entries logged today.' : `Nothing logged on ${formatDayShort(day)}.`}
          </EmptyState>
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((row) => {
              if (row.kind === 'calisthenics') {
                // Grouped calisthenics: ONE row per exercise, so N bouts don't read as N
                // duplicate rows. Shows the bouts + "(N sets · total)" when there's more than one.
                return (
                  <li
                    key={`c:${row.total.metricKey}`}
                    className="flex items-center justify-between gap-3 rounded-lg border px-4 py-3"
                  >
                    <span className="font-medium">
                      {row.total.label} — {row.total.values.join(', ')}
                    </span>
                    {row.total.readings > 1 ? (
                      <span className="text-muted-foreground text-sm tabular-nums">
                        {row.total.readings} sets · {row.total.total}
                      </span>
                    ) : null}
                  </li>
                );
              }
              if (row.kind === 'session') {
                // V1-8-3a: a logged strength session as ONE block, via the SAME renderer the strength
                // section uses (V1-24 3a-ii). Read-only here while the section is on the page, so each
                // set has exactly one Change; the list keeps Change when the routine has no strength
                // block (it is then the only surface).
                return (
                  <li key={`s:${row.session.id}`}>
                    <StrengthSessionReceipt
                      row={row}
                      profileId={profile.id}
                      placement="list"
                      ordinal={ordinals.get(row.session.id)}
                      editable={!strengthOnPage}
                    />
                  </li>
                );
              }
              return (
                <li key={row.entry.id} className="flex flex-col gap-1 rounded-lg border px-4 py-3">
                  <MovementLine entry={row.entry} profileId={profile.id} />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* V1-23 D3 — the routine editor's only entry point (V1-20's discoverability half). The editor
          at /p/[profileId]/routine already does the whole job (Remove per item, one catalog entry per
          individual check-in row); only the link was missing.
          BELOW the logged entries on purpose: parents scroll to here, kids do not scroll past their own
          work, and the header is already dense. Named for its audience ("Edit Nora's routine") rather
          than a gear icon — a gear would be the only icon on a page whose idiom is text arrows, and it
          reads as "settings for this screen".
          ⚠️ `min-h-11` is load-bearing and UNGUARDED by CI: `e2e/a11y.spec.ts` excludes <a> from its
          tap-target scan (the SC 2.5.8 inline-text exception), so a short link here fails no check. */}
      <Link
        href={`/p/${profileId}/routine`}
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex min-h-11 w-fit items-center rounded-sm text-sm outline-none focus-visible:ring-3"
      >
        → Edit {profile.name}&rsquo;s routine
      </Link>
    </main>
  );
}
