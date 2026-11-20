import { clearDayOpenFor } from '@mat-plan/shared';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { AthleteSwitcher } from '@/components/day/athlete-switcher';
import { PROGRAM_COPY } from '@/components/day/day-copy';
import { DayScreen } from '@/components/day/day-screen';
import { dayPageView, lookAheadFallsBack, offersProgramsLink } from '@/components/day/day-notices';
import { NotOnAProgram } from '@/components/day/not-on-a-program';
import { ProgramLine } from '@/components/day/program-line';
import { programPath, PROGRAMS_PATH } from '@/components/program-builder/routes';
import { ExportControl } from '@/components/profiles/export-control';
import { AppShell } from '@/components/layout/app-shell';
import { TimeZoneSync } from '@/components/layout/tz-sync';

import { getActiveTimeZone } from '@/lib/active-timezone';
import { localDayIso } from '@/lib/date';
import { dayPageFlags, resolveViewedDay } from '@/lib/entries/declared-day';
import { getDayPlan } from '@/lib/dal/day/day';
import { householdState } from '@/lib/dal/household';
import { dayClearEvents, lastBodyweight, listEntriesForDay } from '@/lib/dal/entries';
import { requireSession } from '@/lib/dal/session';
import { getProfileByPublicId, listProfiles } from '@/lib/dal/profiles';
import { loggedBodyweight, loggedLifeActivities } from '@/lib/entries/activity-totals';
import { clearDaySummary } from '@/lib/entries/clear-summary';
import { restoreDeadline } from '@/lib/entries/restore-deadline';
import { buildRoutineBlocks } from '@/lib/routine/catalog';

import {
  ALL_ATHLETES_LINK,
  APP_HOME_PATH,
  ATHLETE_FORM_COPY,
  CLOSED_DAY_NOTICE,
  NAME_WRAP_CLASS,
  NAV_LINK_CLASS,
  NOTICE_CLASS,
  QUIET_LINK_CLASS,
  SETTINGS_COPY,
  SETTINGS_PATH,
  athleteEditPath,
  athletePath,
} from '@/lib/constants';
import { BodyweightSection } from './bodyweight-section';
import { ClearDay } from './clear-day';
import { ClearDayBanner } from './clear-day-banner';
import { clearedNoticeLine } from './clear-day-notice';
import { LifeSection } from './life-section';
import { DayNav } from './day-nav';
import {
  amendRowAction,
  logRowAction,
  reorderProgramsAction,
  retickRowAction,
  untickRowAction,
} from './row-actions';

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
  // 🔴 **BOTH, in-process. The gate is deleted at 1d, and 1c-4 is what made that safe.**
  // 🔴 **The session IS the boundary (AUTH-1 1d).** `getHouseholdScope()` resolves the signed-in
  // principal's `household_members` row, so a session proves WHOSE data this is rather than only
  // that the caller is someone this Clerk instance admits — the obligation 1d was blocked on, and
  // the reason the gate could not simply be deleted before `1c-4`.
  // Re-checked HERE rather than inherited from the proxy: SECURITY.md refuses to call a
  // matcher-driven layer a boundary (CVE-2025-29927), and SEC-1's own scar was a prefetch header
  // skipping the matcher entirely. `app/pages-need-a-session.test.ts` is what keeps this call here
  // (PR C renames that file to `pages-need-a-session.test.ts`; its contents already moved here).
  await requireSession();
  const { profileId } = await params;
  // Re-validate the URL-supplied public id server-side (the V1-3 ownership seam;
  // profile tiles are a UX switch, not a security boundary). Unknown → 404.
  const profile = await getProfileByPublicId(profileId);
  if (!profile) notFound();
  // The export control's capability (FAM-1 export follow-up). `getHouseholdScope` is `cache()`d, so
  // this is no second scope query.
  const { canExportAthletes } = await householdState();

  // "Today" is the LOCAL calendar date in the request's active tz (V1-6c) — the client
  // reports its zone via the `tz` cookie (see TimeZoneSync); the RSC validates + uses it,
  // falling back to DEFAULT_TIME_ZONE on first paint. The header weekday derives from this
  // same `day`, so date & weekday can't disagree.
  const timeZone = await getActiveTimeZone();
  const today = localDayIso(timeZone);
  // V1-15: the VIEWED day — today, or a validated `?d=`. Floored at the profile's first day; a
  // malformed value renders today rather than 404ing, because every date is a legal day and a stale
  // URL should land somewhere usable.
  const { d } = await searchParams;
  let day = resolveViewedDay(typeof d === 'string' ? d : undefined, today, profile.firstDay);
  // FAM-1 12c: the athlete's programs on that day, which the day screen and its placed parts read.
  // `today` is read here, never below (day-page invariant 17).
  let plan = await getDayPlan({ profilePublicId: profile.id, day, today });
  // Look-ahead goes forward only while the athlete is on a program (plan §9): any other future day
  // renders today, as every future day did before 12c.
  if (plan && lookAheadFallsBack(plan)) {
    day = today;
    plan = await getDayPlan({ profilePublicId: profile.id, day, today });
  }
  // The athlete resolved above, so the plan can only be missing if the household did meanwhile.
  if (!plan) notFound();
  // 🔴 **THREE reasons a day is read-only, and they must not be conflated** — the day (before
  // yesterday, or after today) and archive. `dayPageFlags` keeps them apart and is unit-tested; see
  // its docblock.
  const { writable, amendable, future, showClosedNotice } = dayPageFlags(
    day,
    today,
    profile.archived,
  );
  // Independent reads → one round-trip (hot page, INP/LCP budget). The weekly ramp read left with the
  // "This week" card (FAM-1 12f PR 4, D21).
  const [entries, clears] = await Promise.all([
    listEntriesForDay(profile.id, day),
    // V1-9b B2: the day's clears, newest first, for the banner and the notice's cleared sentence.
    dayClearEvents(profile.id, day),
  ]);
  // V1-9b B2: Clear this day is offered on today only, for a live athlete (`clearDayOpenFor`, the
  // action's own rule); its dialog's summary is derived from the two reads above, no query.
  const clearable = clearDayOpenFor(profile, day, today);
  const clearSummary = clearable && entries.length > 0 ? clearDaySummary(plan, entries) : null;
  const deadline = restoreDeadline(day, today);
  const clearedTotal = clears.reduce((sum, c) => sum + c.count, 0);

  // V1-24 PR 1a: every bodyweight row on the day (usually zero or one) — what makes the weigh-in
  // surface render the RECEIPT instead of an empty input. Derived from the entries already fetched
  // above (no extra query).
  const bodyweight = loggedBodyweight(entries);
  // V1-24 3b-bw: "Last time", read only when the ✓ row renders (nothing logged, a writable day).
  const lastWeight =
    bodyweight.length === 0 && writable ? await lastBodyweight(profile.id, day) : null;

  // V1-24 3b-page: the routine still chooses the Life activities (`profile.routine`, resolved by the
  // DAL). Since FAM-1 12f PR 5 its catalog is `strength` and Wrestling practice; `strength` renders
  // nothing here, because the day's workouts come from the program.
  const lifeKeys = buildRoutineBlocks(profile.routine.order).flatMap((block) =>
    block.kind === 'life' ? block.keys : [],
  );

  // What shows around the screen: the one state notice, the sections, the screen itself (tested in
  // `day-notices.test.ts`).
  const view = dayPageView(plan, { future, showClosedNotice, archived: profile.archived });
  // V1-9b B2: a cleared day's sentence, carried inside the one notice box (`clear-day-notice.ts`).
  const clearedLine = clearedNoticeLine({
    notice: view.notice,
    clearedTotal,
    deadline,
    athleteName: profile.name,
  });

  // The day screen's writes (FAM-1 12b's Server Actions, 12d's Change and 15c's Program order). An
  // action left out hides its control (plan §6).
  const dayActions = {
    logRow: logRowAction,
    untickRow: untickRowAction,
    retickRow: retickRowAction,
    amendRow: amendRowAction,
    reorderPrograms: reorderProgramsAction,
  };

  return (
    <AppShell athletes={await listProfiles()} current={{ athlete: profile.id }}>
      {/* ⚠️ `profile.id`, **not** the `profileId` URL segment. The segment is checked, never parsed, so it
          accepts upper-case hex, and the `uuid` column matches case-insensitively — so
          `/p/AAAAAAAA-…` renders this page while `athlete.id === currentAthlete` finds nothing and
          the rail marks no row. The DTO carries the canonical id; identity is not re-derived from
          the request. */}
      {/* Reports the device tz → `tz` cookie so the RSC computes the local day (V1-6c). Renders nothing. */}
      <TimeZoneSync serverTimeZone={timeZone} />
      <header className="flex flex-col gap-2">
        {/* 🔴 "athletes", not "profiles" (PUX-8). "Profile" is the schema's word and the one the
            person reading this does not use; `PICKER_EMPTY_COPY` and `PICKER_COPY.subhead` already
            made the same switch. `min-h-11` for the reason the edit link below carries it: this is
            the recovery path on a phone, and `e2e/a11y.spec.ts` excludes <a> from its tap-target
            scan, so nothing in CI would notice its absence. */}
        {/* ⚠️ `ALL_ATHLETES_LINK`, and **visible at every width**. `/p/new` has read it from the
            constant since `lib/constants.ts:550`; this page, the screen that sentence was written
            for, still spelled it out. One string, two renderers.

            🔴 **It is NOT `lg:hidden`, a deviation from the plan's Decision 4.** That bullet was
            written for a rail of two static links, where this would have been an exact duplicate of
            "Home". The rail that shipped is the athlete SWITCHER, and `/p` is more than switching:
            it is the only home of sign out, the theme toggle, Add an athlete and the archived
            count. Hiding this at `lg` would strand all four on a laptop. */}
        <Link href={APP_HOME_PATH} className={NAV_LINK_CLASS}>
          {ALL_ATHLETES_LINK}
        </Link>
        {/* `NAME_WRAP_CLASS` (D11): a 40-character unbroken name is wider than a 360px phone's 328px
            of usable width at this type size. ⚠️ a-g's plan row claimed this wrap had shipped; it had
            not — `gh pr diff 346` carries no wrap rule at all. It ships here, with every other
            renderer, from one constant. */}
        <h1 className={`text-3xl font-semibold tracking-tight ${NAME_WRAP_CLASS}`}>
          {profile.name}
        </h1>
        {/* FAM-1 12c (D34; the 13d decision): the household's athletes, UNDER the `<h1>` in their
            own row, never beside it, where a 40-character name would be squeezed to a few letters a
            line at 360px. `lg:hidden`: from `lg` the nav rail lists them. */}
        <AthleteSwitcher plan={plan} hrefFor={athletePath} className="lg:hidden" />
        {/* V1-15: DayNav REPLACES a date line rather than sitting beside one — the date has exactly
            one home. FAM-1 12c: it looks ahead while the athlete is on a program the next day. */}
        <DayNav
          profileId={profileId}
          day={day}
          today={today}
          floor={profile.firstDay}
          canGoForward={plan.canGoForward}
        />
      </header>

      {/* 🔴 **ONE state notice, never a stack** (FAM-1 12c; maintainer, 2026-11-17): archived, else
          coming up, else closed. Each explains why everything below is inert, so it sits ABOVE the
          program line (a recorded difference from v12, which puts its read-only notice after it).

          PROF-1 b, the archived notice. ⚠️ **ONE copy for every member, with no "ask the owner"
          branch** — restore is any-member (decision M1). 🔴 **"Household settings" is a LINK**: two
          taps from here instead of three, and `a11y.spec.ts` excludes <a> from its tap scan.
          "Nothing new can be logged" covers every day, a future one included, so it stands alone.

          Coming up (look-ahead): v12's words, never the closed-day sentence, which reads as a
          missed day. Only reached while on a program that day (the resolve above).

          V1-15, the closed day: an unexplained absence reads as a bug — the finding that explains
          the 2026-09-28 incident. Not for an archived athlete, where it is false. */}
      {/* V1-9b B2: a cleared day's sentence rides IN the one notice box, as a second paragraph,
          never as a second box. An archived athlete whose day is still open for Restore all is told
          how to get it back; a closed day, that the entries are kept. */}
      {view.notice === 'archived' ? (
        <div className={`${NOTICE_CLASS} ${NAME_WRAP_CLASS} flex flex-col gap-2`}>
          <p>
            {SETTINGS_COPY.archivedNotice(profile.name)}{' '}
            <Link href={SETTINGS_PATH} className={QUIET_LINK_CLASS}>
              {SETTINGS_COPY.heading}
            </Link>
            .
          </p>
          {clearedLine ? <p>{clearedLine}</p> : null}
        </div>
      ) : view.notice === 'comingUp' ? (
        <p className={`${NOTICE_CLASS} ${NAME_WRAP_CLASS}`}>
          {PROGRAM_COPY.comingUp(profile.name, day)}
        </p>
      ) : view.notice === 'closed' ? (
        <div className={`${NOTICE_CLASS} flex flex-col gap-2`}>
          <p>{CLOSED_DAY_NOTICE}</p>
          {clearedLine ? <p>{clearedLine}</p> : null}
        </div>
      ) : null}

      {/* V1-9b B2: the day's clears and Restore all, on a day open for it. Mounted on every day and
          keyed by athlete and day: it owns the outcome line every Restore all lands on. */}
      <ClearDayBanner
        key={`clear-banner-${profile.id}-${day}`}
        profileId={profile.id}
        day={day}
        today={today}
        // Only where Restore all is offered: a closed or archived day's clear is a sentence in the
        // notice (its total computed here), so its tokens need not reach the browser.
        events={writable ? clears : []}
        writable={writable}
        relogged={entries.length > 0}
        deadline={deadline}
      />

      {/* FAM-1 13d's placed parts (D34): the programs line with Program order, and "Not on a
          program.", above Bodyweight. Each name on the line links to its program's page (15c, D49). */}
      <ProgramLine plan={plan} actions={dayActions} programHrefFor={programPath} />
      <NotOnAProgram
        plan={plan}
        programsHref={
          offersProgramsLink({ archived: profile.archived }) ? PROGRAMS_PATH : undefined
        }
      />

      {/* Not on a future day (maintainer, 2026-11-17, v12): nothing has happened there to show, and
          "Nothing logged." under each would read as a missed day. */}
      {view.sections ? (
        <div className="flex flex-col gap-6">
          {/* V1-24 PR 1a — the day's state, not an empty form over a record. See the section. */}
          <BodyweightSection
            profileId={profile.id}
            day={day}
            writable={writable}
            amendable={amendable}
            logged={bodyweight}
            last={lastWeight}
          />
          <LifeSection
            profileId={profile.id}
            day={day}
            writable={writable}
            amendable={amendable}
            activityKeys={lifeKeys}
            logged={loggedLifeActivities(entries, lifeKeys)}
          />
        </div>
      ) : null}

      {/* FAM-1 12c: the workouts, below Life (D34; the maintainer kept the order, 2026-11-17: "chosen
          by person who programmed the workout / day"). Not mounted for an athlete on no program
          with no rows to show: it would be an empty landmark under a hidden heading, every day. */}
      {view.screen ? <DayScreen plan={plan} actions={dayActions} /> : null}

      {/* 🔴 **This slot used to link the ROUTINE EDITOR; PROF-1 a-r replaces it** (acceptance
          criterion 11 / M30: nothing in the app links to `/routine` until ACT-1 replaces that editor;
          the route stays in code, unlinked, as it was before V1-23 PR 2). A routine already saved
          still chooses the Life items above; a profile with none keeps the neutral default.
          It becomes rename — criterion 8's "rename shall be reachable from the athlete's own page".
          At the foot of the page, for the reason the routine link was: parents scroll to here, kids
          do not scroll past their own work, and the header is already dense. Text, not a gear icon —
          a gear would be the only icon on a page whose idiom is text arrows, and it reads as
          "settings for this screen".
          ⚠️ `min-h-11` is load-bearing and UNGUARDED by CI: `e2e/a11y.spec.ts` excludes <a> from its
          tap-target scan (the SC 2.5.8 inline-text exception), so a short link here fails no check.
          🔴 `NAME_WRAP_CLASS` — and this link is WHY the constant says `wrap-anywhere` rather than
          `break-words` (D11). The element is `inline-flex w-fit`, so its width DERIVES from
          min-content, and only `anywhere` lets a break count toward min-content. The previous copy,
          "→ Edit {name}'s routine", measured 322–384px against 328px of usable width at 360px for an
          average 40-character name: it overflowed, and had done since V1-23. */}
      {/* V1-13b — the CSV tree families take with them. At the foot since FAM-1 12c, beside rename:
          a parent's action, where parents scroll and kids do not, so the header above the day's work
          is one row shorter on a phone. A plain <a>, not a <Link>: a file download, which Next's
          client router would try to navigate to; `download` names it, `min-h-11` keeps the bar.
          🔴 Maintainer decision N3 applies to BOTH surfaces: no history → no link (the EOCD-only zip
          N3 exists to eliminate), the same sentence the settings row shows. And only the household's
          owner sees either (FAM-1 export follow-up, Q1): `ExportControl` holds all three states. */}
      {/* V1-9b B2: Clear this day, at the foot with export and rename. Placement is not a control: any member may clear. Mounted on
          every day it can act on, even with nothing left to clear, so its answer is not lost when
          the clear empties the day (the plan's P5). */}
      {clearable && deadline ? (
        <ClearDay
          key={`clear-day-${profile.id}-${day}`}
          profileId={profile.id}
          athleteName={profile.name}
          day={day}
          today={today}
          summary={clearSummary}
          deadline={deadline}
        />
      ) : null}
      <ExportControl
        profileId={profileId}
        hasHistory={profile.hasHistory}
        canExport={canExportAthletes}
        surface="day"
      />
      <Link
        href={`${athleteEditPath(profile.id)}?from=${encodeURIComponent(athletePath(profile.id))}`}
        className={`${NAV_LINK_CLASS} ${NAME_WRAP_CLASS}`}
      >
        {ATHLETE_FORM_COPY.renameLink(profile.name)}
      </Link>
    </AppShell>
  );
}
