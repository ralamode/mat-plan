import { hasStarted, PROFILE_KIND_LABELS } from '@mat-plan/shared';
import Link from 'next/link';

import { PROGRAM_COPY } from '@/components/day/day-copy';
import { NO_PROGRAM_YET_LINE, startsText } from '@/components/program-builder/builder-text';
import { athletePath, NAME_WRAP_CLASS } from '@/lib/constants';
import type { AthleteProgramDTO } from '@/lib/dal/program/reads';
import type { ProfileDTO } from '@/lib/dal/profiles';

/**
 * The line under an athlete's name on Home (FAM-1 15 PR 3): their programs in their own order, in
 * the day page's words (`PROGRAM_COPY.line`), so Home and the day page name them the same way. A
 * program that begins after `today` says so, "Mat strength (starts Fri, Nov 20)", because the day
 * page shows it only from that day; the brackets keep the date's own comma out of the list. None is
 * "No program yet", the Put-on dialog's words.
 */
export function programsLine(programs: readonly AthleteProgramDTO[], today: string): string {
  if (!programs.length) return NO_PROGRAM_YET_LINE;
  return PROGRAM_COPY.line(
    programs.map((p) =>
      hasStarted({ since: p.activeFrom }, today)
        ? p.name
        : `${p.name} (${startsText(p.activeFrom)})`,
    ),
  );
}

/** The ids the tile's link is named and described by, from the profile's public id (unique). */
export const profileTileIds = (profileId: string) => ({
  name: `profile-tile-${profileId}-name`,
  kind: `profile-tile-${profileId}-kind`,
  programs: `profile-tile-${profileId}-programs`,
});

/**
 * A single profile picker tile (V1-3). A large, tappable navigation card linking
 * to the profile's scoped Today (`/p/[publicId]`). Semantic `<a>` (via next/link)
 * — this is navigation, not an action — with a focus-visible ring and a tap
 * target well above the 44px minimum. Profile tiles are a UX switch, not a
 * security boundary: the destination page re-validates the id server-side.
 *
 * `programs` is the athlete's entry in Home's one read (`getProgramsByAthlete`); `undefined` (no
 * entry, as in an athlete archived between Home's two reads) shows no line rather than claim "No
 * program yet".
 *
 * Pure sync Server Component (no `'use client'`, no state) — it only renders a link.
 */
export function ProfileTile({
  profile,
  programs,
  today,
}: {
  profile: ProfileDTO;
  programs?: readonly AthleteProgramDTO[];
  today: string;
}) {
  const initial = profile.name.trim().charAt(0).toUpperCase() || '?';
  const ids = profileTileIds(profile.id);

  return (
    /* 🔴 **Named by the name and kind, described by the programs line (FAM-1 15 PR 3, UX2-S4).**
       Without `aria-labelledby` the link's name is all of its text, so the programs line would
       join it: a screen reader's list of links would read every program name, and every e2e
       locator that names a tile by the athlete would also match a program named after them. */
    <Link
      href={athletePath(profile.id)}
      aria-labelledby={`${ids.name} ${ids.kind}`}
      aria-describedby={programs ? ids.programs : undefined}
      className="group/tile bg-card text-card-foreground ring-foreground/10 hover:ring-foreground/20 focus-visible:ring-ring flex min-h-24 items-center gap-4 rounded-xl px-5 py-4 ring-1 outline-none transition-all focus-visible:ring-3"
    >
      <span
        aria-hidden="true"
        className="bg-primary text-primary-foreground flex size-14 shrink-0 items-center justify-center rounded-full text-2xl font-semibold"
      >
        {profile.avatar ?? initial}
      </span>
      {/* 🔴 `min-w-0` on the COLUMN as well as on the name (`NAME_WRAP_CLASS`). This span is a
          row-flex item beside a `size-14 shrink-0` avatar, so its default `min-width: auto` floors it
          at its content's min-content width — and a wrap rule on the child cannot shrink a parent
          that refuses to shrink. This is the renderer D11 is really about: `break-words` would change
          nothing here, because only `overflow-wrap: anywhere` lets a break count toward min-content. */}
      <span className="flex min-w-0 flex-col gap-0.5">
        <span id={ids.name} className={`text-lg font-medium ${NAME_WRAP_CLASS}`}>
          {profile.name}
        </span>
        {/* 🔴 `PROFILE_KIND_LABELS`, not `capitalize` over the raw column. `capitalize {profile.kind}`
            rendered "Kid" — the schema's word shown to a parent — and criterion 9 asks for
            Child / Adult from one display map beside `PROFILE_KINDS`. */}
        <span id={ids.kind} className="text-muted-foreground text-sm">
          {PROFILE_KIND_LABELS[profile.kind]}
        </span>
        {/* Never truncated: the wrap rule lets a 60-character program name with no spaces break
            anywhere, so the line wraps inside the column rather than widening the tile. */}
        {programs ? (
          <span id={ids.programs} className={`text-foreground text-sm ${NAME_WRAP_CLASS}`}>
            {programsLine(programs, today)}
          </span>
        ) : null}
      </span>
    </Link>
  );
}
