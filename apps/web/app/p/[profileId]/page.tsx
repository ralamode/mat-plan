import Link from 'next/link';
import { notFound } from 'next/navigation';

import { AppShell } from '@/components/layout/app-shell';

import { getActiveTimeZone } from '@/lib/active-timezone';
import { localDayIso, localWeekStartIso } from '@/lib/date';
import { dayPageFlags, resolveViewedDay } from '@/lib/entries/declared-day';
import { getWeeklyAdherence } from '@/lib/dal/adherence';
import { lastBodyweight, listEntriesForDay } from '@/lib/dal/entries';
import { requireSession } from '@/lib/dal/session';
import { getProfileByPublicId, listProfiles } from '@/lib/dal/profiles';
import { loggedBodyweight, loggedLifeActivities } from '@/lib/entries/activity-totals';
import { buildRoutineBlocks } from '@/lib/routine/catalog';

import {
  ALL_ATHLETES_LINK,
  APP_HOME_PATH,
  ATHLETE_FORM_COPY,
  CLOSED_DAY_NOTICE,
  EXPORT_CSV_LABEL,
  NAME_WRAP_CLASS,
  NAV_LINK_CLASS,
  NOTHING_TO_EXPORT,
  QUIET_LINK_CLASS,
  SETTINGS_COPY,
  SETTINGS_PATH,
  athleteEditPath,
  athleteExportPath,
  athletePath,
} from '@/lib/constants';
import { BodyweightSection } from './bodyweight-section';
import { LifeSection } from './life-section';
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
  // 🔴 **TWO reasons a day is read-only, and they must not be conflated** — the day (before
  // yesterday) and archive. `dayPageFlags` keeps them apart and is unit-tested; see its docblock.
  const { writable, amendable, showClosedNotice } = dayPageFlags(day, today, profile.archived);
  const weekStart = localWeekStartIso(day);
  // Independent reads → one round-trip (hot page, INP/LCP budget). `adherence` is [] until the ramp
  // schedule is seeded (V1-6b-1 ships it empty), so the "This week" section stays hidden today.
  const [entries, adherence] = await Promise.all([
    listEntriesForDay(profile.id, day),
    getWeeklyAdherence(profile.id, weekStart),
  ]);

  // V1-24 PR 1a: every bodyweight row on the day (usually zero or one) — what makes the weigh-in
  // surface render the RECEIPT instead of an empty input. Derived from the entries already fetched
  // above (no extra query).
  const bodyweight = loggedBodyweight(entries);
  // V1-24 3b-bw: "Last time", read only when the ✓ row renders (nothing logged, a writable day).
  const lastWeight =
    bodyweight.length === 0 && writable ? await lastBodyweight(profile.id, day) : null;

  // V1-24 3b-page: the day page is Bodyweight and Life. The routine still chooses the life
  // activities (`profile.routine`, resolved by the DAL); its strength and check-in keys render
  // nothing here until FAM-1 brings the program's workouts.
  const lifeKeys = buildRoutineBlocks(profile.routine.order).flatMap((block) =>
    block.kind === 'life' ? block.keys : [],
  );

  return (
    <AppShell athletes={await listProfiles()} current={{ athlete: profile.id }}>
      {/* ⚠️ `profile.id`, **not** the `profileId` URL segment. `uuidSchema` is `z.uuid()`, which
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
        {/* V1-15: DayNav REPLACES a date line rather than sitting beside one — the date has exactly
            one home. Its day-role label left with the program card it described (V1-24 3b-page);
            the prop stays on `DayNav` for FAM-1. */}
        <DayNav profileId={profileId} day={day} today={today} floor={profile.firstDay} />
        {/* V1-13b — the MVP's whole point: the CSV tree the Claude workflow consumes. A plain <a>,
            not a <Link>: this is a file download, and Next's client router would try to navigate to
            a zip. `download` names it, and `min-h-11` keeps it on the tap-target bar. */}
        {profile.hasHistory ? (
          <a href={athleteExportPath(profileId)} download className={NAV_LINK_CLASS}>
            {EXPORT_CSV_LABEL}
          </a>
        ) : (
          // 🔴 **Maintainer decision N3 applies to BOTH surfaces.** The first version gated only the
          // settings row, so the same athlete whose settings row said "nothing to export" still had a
          // live link here — handing back the EOCD-only zip N3 exists to eliminate. The privacy and
          // UX lenses found it independently, and the notice had already been written to claim "the
          // app says so", which made it a false published sentence rather than a gap.
          <p className={`${NAV_LINK_CLASS} flex items-center`}>{NOTHING_TO_EXPORT}</p>
        )}
      </header>

      {/* V1-15: ONE notice, above the sections, on a day before yesterday: an unexplained absence
          reads as a bug — the finding that explains the 2026-09-28 incident.
          Not for an archived athlete (V1-24 3b-page): the sentence says today and yesterday can be
          logged, which is false there, and the archived notice below gives the real reason. */}
      {showClosedNotice ? (
        <p className="border-input text-muted-foreground rounded-lg border border-dashed px-4 py-3 text-sm">
          {CLOSED_DAY_NOTICE}
        </p>
      ) : null}

      {/* PROF-1 b. ⚠️ **ONE copy for every member, with no "ask the owner" branch** — restore is
          any-member (decision M1), so sending a member off to find the owner would be sending them
          away from a control one tap below. The plan carried that branch until a UX lens caught it.
          🔴 **"Household settings" is a LINK.** Unlinked it is three taps from here (← All athletes →
          Household settings › → Restore); linked it is two. The back link above calls itself "the
          recovery path on a phone" and carries `min-h-11` for exactly this reason, and `a11y.spec.ts`
          excludes <a> from its tap scan, so nothing in CI would notice. */}
      {profile.archived ? (
        <p
          className={`border-input text-muted-foreground rounded-lg border border-dashed px-4 py-3 text-sm ${NAME_WRAP_CLASS}`}
        >
          {SETTINGS_COPY.archivedNotice(profile.name)}{' '}
          <Link href={SETTINGS_PATH} className={QUIET_LINK_CLASS}>
            {SETTINGS_COPY.heading}
          </Link>
          .
        </p>
      ) : null}

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
          activityKeys={lifeKeys}
          logged={loggedLifeActivities(entries, lifeKeys)}
        />
      </div>

      {adherence.length > 0 ? <WeeklyAdherence rows={adherence} /> : null}

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
      <Link
        href={`${athleteEditPath(profile.id)}?from=${encodeURIComponent(athletePath(profile.id))}`}
        className={`${NAV_LINK_CLASS} ${NAME_WRAP_CLASS}`}
      >
        {ATHLETE_FORM_COPY.renameLink(profile.name)}
      </Link>
    </AppShell>
  );
}
