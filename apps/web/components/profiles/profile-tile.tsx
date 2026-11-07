import { PROFILE_KIND_LABELS } from '@mat-plan/shared';
import Link from 'next/link';

import { athletePath, NAME_WRAP_CLASS } from '@/lib/constants';
import type { ProfileDTO } from '@/lib/dal/profiles';

/**
 * A single profile picker tile (V1-3). A large, tappable navigation card linking
 * to the profile's scoped Today (`/p/[publicId]`). Semantic `<a>` (via next/link)
 * — this is navigation, not an action — with a focus-visible ring and a tap
 * target well above the 44px minimum. Profile tiles are a UX switch, not a
 * security boundary: the destination page re-validates the id server-side.
 *
 * Pure sync Server Component (no `'use client'`, no state) — it only renders a link.
 */
export function ProfileTile({ profile }: { profile: ProfileDTO }) {
  const initial = profile.name.trim().charAt(0).toUpperCase() || '?';

  return (
    <Link
      href={athletePath(profile.id)}
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
        <span className={`text-lg font-medium ${NAME_WRAP_CLASS}`}>{profile.name}</span>
        {/* 🔴 `PROFILE_KIND_LABELS`, not `capitalize` over the raw column. `capitalize {profile.kind}`
            rendered "Kid" — the schema's word shown to a parent — and criterion 9 asks for
            Child / Adult from one display map beside `PROFILE_KINDS`. */}
        <span className="text-muted-foreground text-sm">{PROFILE_KIND_LABELS[profile.kind]}</span>
      </span>
    </Link>
  );
}
