import 'server-only';

import { schema } from '@mat-plan/db';
import { type ProfileKind, uuidSchema } from '@mat-plan/shared';
import { and, asc, eq, isNull } from 'drizzle-orm';

import { db } from './db';

/**
 * DAL skeleton (V0-5). Every DAL function returns a minimal DTO — never a raw
 * row — and keeps DB access here (server-only). Ownership scoping (Clerk
 * `getCurrentUser()` + `household_id`) lands with auth at V1-1/v1.5; this is the
 * seam it plugs into. `public_id` (UUIDv7) is the id the UI/URLs ever see.
 */
export type ProfileDTO = {
  id: string;
  name: string;
  kind: ProfileKind;
  avatar: string | null;
};

export async function listProfiles(): Promise<ProfileDTO[]> {
  const rows = await db
    .select({
      publicId: schema.profiles.publicId,
      name: schema.profiles.name,
      kind: schema.profiles.kind,
      avatar: schema.profiles.avatar,
    })
    .from(schema.profiles)
    .where(isNull(schema.profiles.deletedAt))
    // Stable tile order — earliest-created first (the seed order: Liam, Scarlett).
    .orderBy(asc(schema.profiles.id));

  return rows.map((r) => ({
    id: r.publicId,
    name: r.name,
    kind: r.kind as ProfileKind,
    avatar: r.avatar,
  }));
}

/**
 * Resolve a single profile by its public id (the id the URL/`/p/[profileId]`
 * ever carries). This is the ownership seam: V1-3 re-validates the tile-supplied
 * `profileId` here (server-side), and v1.5 tightens it to scope by the Clerk
 * household. Returns null when the id is unknown or soft-deleted — callers treat
 * that as not-found (page → `notFound()`, action → typed `{ ok:false }`).
 */
export async function getProfileByPublicId(publicId: string): Promise<ProfileDTO | null> {
  // The public id column is `uuid`; a malformed value (e.g. a garbage URL segment)
  // would make Postgres throw on the comparison. Treat a non-UUID as not-found so
  // callers get a clean null (page → 404), never a 500.
  if (!uuidSchema.safeParse(publicId).success) return null;

  const [row] = await db
    .select({
      publicId: schema.profiles.publicId,
      name: schema.profiles.name,
      kind: schema.profiles.kind,
      avatar: schema.profiles.avatar,
    })
    .from(schema.profiles)
    .where(and(eq(schema.profiles.publicId, publicId), isNull(schema.profiles.deletedAt)))
    .limit(1);

  return row
    ? { id: row.publicId, name: row.name, kind: row.kind as ProfileKind, avatar: row.avatar }
    : null;
}
