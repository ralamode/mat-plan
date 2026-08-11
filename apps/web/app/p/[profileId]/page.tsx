import {
  DAY_ROLE_LABELS,
  DEFAULT_SESSION_TYPE,
  DEFAULT_SUPERSET_LABEL,
  ENTRY_STATUS,
  SESSION_TYPE_LABELS,
} from '@mat-plan/shared';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { EmptyState } from '@/components/ui/empty-state';
import { getActiveTimeZone } from '@/lib/active-timezone';
import { CHECKIN_FIELDS } from '@/lib/checkins/checkin-fields';
import { formatDayLong, localDayIso, localWeekStartIso } from '@/lib/date';
import { getWeeklyAdherence } from '@/lib/dal/adherence';
import { listEntriesForDay, type EntryDTO } from '@/lib/dal/entries';
import { getProfileByPublicId } from '@/lib/dal/profiles';
import { getProgramDay } from '@/lib/dal/programming';
import { resolveDayRole } from '@/lib/programming/day-role-schedule';
import { calisthenicsTotals, todayRows } from '@/lib/entries/activity-totals';
import {
  buildRoutineBlocks,
  checkinFieldsForKeys,
  lifeActivitiesForKeys,
} from '@/lib/routine/catalog';
import { entryLabel } from '@/lib/entries/entry-label';

import { LIFE_ACTIVITY_KEYS } from '@/lib/life/life-activities';

import { BodyweightForm } from './bodyweight-form';
import { CheckinForm } from './checkin-form';
import { EditableSet } from './editable-set';
import { formatSetLine, isEditableSet } from './set-display';
import { LifeForm } from './life-form';
import { ProgramReference } from './program-reference';
import { StrengthForm } from './strength-form';
import { TimeZoneSync } from './tz-sync';
import { WeeklyAdherence } from './weekly-adherence';

// Route-segment config must be a static inline literal (Next can't follow an
// imported const), so 'nodejs' stays here. pg → Node runtime, not Edge.
export const runtime = 'nodejs';

export default async function TodayPage({ params }: { params: Promise<{ profileId: string }> }) {
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
  const day = localDayIso(timeZone);
  const weekStart = localWeekStartIso(day);
  // V1-10: which day the PROGRAM says this is (Mon/Wed/Fri → Strength A/B/C), from the same active-tz
  // `day` the header renders — so the card can't claim Monday while the header says Sunday. null on a
  // non-strength day → no program read, no card.
  const dayRole = resolveDayRole(day);
  // Independent reads → one round-trip (hot page, INP/LCP budget). `adherence` is [] until the ramp
  // schedule is seeded (V1-6b-1 ships it empty), so the "This week" section stays hidden today;
  // `programDay` is [] on a rest day or when the kid's household has no block.
  const [entries, adherence, programDay] = await Promise.all([
    listEntriesForDay(profile.id, day),
    getWeeklyAdherence(profile.id, weekStart),
    dayRole ? getProgramDay(profile.id, dayRole) : [],
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

  // V1-6a: the calisthenics tally — today's per-metric totals, folded from the day's entries.
  const calisTotals = calisthenicsTotals(entries);
  // Display rows for the "Logged entries" list: calisthenics bouts grouped into one row per
  // exercise (so repeated bouts don't read as duplicate rows), everything else individual.
  const rows = todayRows(entries);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-4 py-12">
      {/* Reports the device tz → `tz` cookie so the RSC computes the local day (V1-6c). Renders nothing. */}
      <TimeZoneSync serverTimeZone={timeZone} />
      <header className="flex flex-col gap-2">
        <Link
          href="/"
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring w-fit rounded-sm text-sm outline-none focus-visible:ring-3"
        >
          ← All profiles
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">{profile.name}</h1>
        <p className="text-muted-foreground">Today · {formatDayLong(day)}</p>
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
      <div className="flex flex-col gap-6">
        <section aria-labelledby="log-bw-heading" className="flex flex-col gap-3">
          <h2 id="log-bw-heading" className="text-lg font-medium">
            Log bodyweight
          </h2>
          <BodyweightForm profileId={profile.id} day={day} />
        </section>
        {buildRoutineBlocks(profile.routine.order).map((block, i) => {
          if (block.kind === 'strength') {
            return (
              <section key={`b${i}`} aria-labelledby={`str-${i}`} className="flex flex-col gap-3">
                <h2 id={`str-${i}`} className="text-lg font-medium">
                  Log strength
                </h2>
                {/* V1-10: today's programmed movements, read-only, directly above the form the coach
                    types the PERFORMED values into. Inside the routine's strength gate — a kid whose
                    routine has no strength block sees no program card either. */}
                {dayRole && programDay.length > 0 ? (
                  <ProgramReference dayRole={dayRole} rows={programDay} />
                ) : null}
                {/* GAP-1 P0-1: the weekday's role PRE-SELECTS the form's day picker; it is never
                    submitted implicitly (see the note on that select). */}
                <StrengthForm profileId={profile.id} day={day} defaultDayRole={dayRole} />
              </section>
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
                <CheckinForm
                  profileId={profile.id}
                  day={day}
                  fields={fields}
                  loggedFieldKeys={loggedFieldKeys}
                />
              </section>
            );
          }
          if (lifeActivitiesForKeys(block.keys).length === 0) return null; // empty run → render nothing
          return (
            <section key={`b${i}`} aria-labelledby={`life-${i}`} className="flex flex-col gap-3">
              <h2 id={`life-${i}`} className="text-lg font-medium">
                Life
              </h2>
              <LifeForm
                profileId={profile.id}
                day={day}
                loggedLifeKeys={loggedLifeKeys}
                activityKeys={block.keys}
              />
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
            Calisthenics today
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
        <h2 id="entries-heading" className="sr-only">
          Logged entries
        </h2>

        {rows.length === 0 ? (
          <EmptyState>No entries logged today.</EmptyState>
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
                // V1-8-3a: a logged strength session as ONE block — a type header + movement count, its
                // items nested (each via the shared <MovementLine>). V1-8-3d: superset members sub-bracket.
                // GAP-1 P0-1: prefer the ASSERTED programmed day ("Strength B") over the generic
                // session type ("Strength"). Surfacing it is what makes the stored value auditable —
                // a role nobody sees is one nobody can notice is wrong.
                const typeLabel = row.session.dayRole
                  ? DAY_ROLE_LABELS[row.session.dayRole]
                  : SESSION_TYPE_LABELS[row.session.type ?? DEFAULT_SESSION_TYPE];
                const count = row.movementCount;
                return (
                  <li
                    key={`s:${row.session.id}`}
                    className="flex flex-col gap-2 rounded-lg border px-4 py-3"
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <h3 className="font-medium">{typeLabel} session</h3>
                      <span className="text-muted-foreground text-sm">
                        {count} {count === 1 ? 'movement' : 'movements'}
                      </span>
                    </div>
                    {row.session.feel ? (
                      // V1-8-3b: the optional session feel. Truthiness-guarded so a normalized-empty
                      // feel never renders a blank line.
                      <p className="text-muted-foreground text-sm italic">
                        Felt: {row.session.feel}
                      </p>
                    ) : null}
                    <ul className="flex flex-col gap-2">
                      {row.items.map((item) =>
                        item.kind === 'superset' ? (
                          // V1-8-3d: a superset bracket — its members alternate, so group them under a
                          // labeled sub-list (each member still via the shared <MovementLine>).
                          <li
                            key={`ss:${item.superset.id}`}
                            className="border-foreground/25 flex flex-col gap-1.5 border-l-2 pl-3"
                          >
                            <span className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                              {DEFAULT_SUPERSET_LABEL}
                            </span>
                            <ul className="flex flex-col gap-1.5">
                              {item.members.map((m) => (
                                <SessionMovementItem key={m.id} entry={m} profileId={profile.id} />
                              ))}
                            </ul>
                          </li>
                        ) : (
                          <SessionMovementItem
                            key={item.entry.id}
                            entry={item.entry}
                            profileId={profile.id}
                          />
                        ),
                      )}
                    </ul>
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
    </main>
  );
}

/**
 * A movement line as a nested session `<li>` item — shared by superset members and standalone
 * movements inside a session block (V1-8-3d), so the wrapper markup lives in ONE place and the two
 * can't drift. The flat `{kind:'entry'}` row keeps its own bordered wrapper (a different context).
 */
function SessionMovementItem({ entry, profileId }: { entry: EntryDTO; profileId: string }) {
  return (
    <li className="flex flex-col gap-1">
      <MovementLine entry={entry} profileId={profileId} />
    </li>
  );
}

/**
 * One movement's display: its label + (non-done) status, then its sets. Shared (V1-8-3a) by the flat
 * `{kind:'entry'}` row and each movement inside a session block, so the reps × weight/label fallback
 * lives once. The caller supplies the `<li>` wrapper (flat = a bordered row; session = a nested item).
 */
function MovementLine({ entry, profileId }: { entry: EntryDTO; profileId: string }) {
  const label = entryLabel(entry);
  return (
    <>
      <div className="flex items-center justify-between">
        <span className="font-medium">{label}</span>
        {entry.status !== ENTRY_STATUS.done ? (
          <span className="text-muted-foreground text-sm">{entry.status}</span>
        ) : null}
      </div>
      {entry.sets.length > 0 ? (
        // A vertical list (was a horizontal wrap) so each set is a tappable row. V1-9: a numeric set gets
        // an inline Edit affordance via the <EditableSet> CLIENT island; a read-only set (labeled/null)
        // stays SERVER-rendered here — so only editable sets hydrate (RSC-first). The read line format is
        // single-sourced in formatSetLine, shared by both branches.
        <ul className="text-muted-foreground flex flex-col gap-0.5 text-sm tabular-nums">
          {entry.sets.map((s) =>
            isEditableSet(s) ? (
              <EditableSet
                key={s.publicId}
                set={s}
                profileId={profileId}
                unit={entry.unit}
                ariaLabel={`${label} set ${s.idx}`}
              />
            ) : (
              <li key={s.publicId}>{formatSetLine(s, entry.unit)}</li>
            ),
          )}
        </ul>
      ) : null}
    </>
  );
}
