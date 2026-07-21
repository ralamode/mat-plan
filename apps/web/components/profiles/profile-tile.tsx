import Link from 'next/link';

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
      href={`/p/${profile.id}`}
      className="group/tile bg-card text-card-foreground ring-foreground/10 hover:ring-foreground/20 focus-visible:ring-ring flex min-h-24 items-center gap-4 rounded-xl px-5 py-4 ring-1 outline-none transition-all focus-visible:ring-3"
    >
      <span
        aria-hidden="true"
        className="bg-primary text-primary-foreground flex size-14 shrink-0 items-center justify-center rounded-full text-2xl font-semibold"
      >
        {profile.avatar ?? initial}
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="text-lg font-medium">{profile.name}</span>
        <span className="text-muted-foreground text-sm capitalize">{profile.kind}</span>
      </span>
    </Link>
  );
}
