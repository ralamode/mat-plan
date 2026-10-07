import 'server-only';

import { schema } from '@mat-plan/db';
import { type ProfileKind, type RoutineConfig, uuidSchema } from '@mat-plan/shared';
import { and, asc, eq, isNull } from 'drizzle-orm';

import { resolveProfileRoutine } from '@/lib/routine/catalog';

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
/**
 * The Today page's profile DTO — the tile fields PLUS the resolved per-kid routine (V1-18). Its own type
 * rather than a wider `ProfileDTO` so the picker tiles (`listProfiles`) don't have to carry a routine.
 * `routine` is ALWAYS resolved (never null/raw): `resolveProfileRoutine` maps a null/stale `routine_config`
 * to the NEUTRAL first-run routine (ONB-0) while still accepting every catalog key an existing household
 * has authored, so the page renders a real ordered routine unconditionally.
 */
export type ProfileWithRoutineDTO = ProfileDTO & {
  routine: RoutineConfig;
  /** The profile's first calendar day — V1-15's backward navigation floor. */
  firstDay: string;
};

export async function getProfileByPublicId(
  publicId: string,
): Promise<ProfileWithRoutineDTO | null> {
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
      routineConfig: schema.profiles.routineConfig, // untrusted JSON — resolved below, never returned raw
      // V1-15: the floor for day navigation — `‹` stops at the profile's first day rather than
      // letting a kid walk back into 2019 and conclude the app is broken. ZERO extra queries: this
      // SELECT already runs.
      createdAt: schema.profiles.createdAt,
    })
    .from(schema.profiles)
    .where(and(eq(schema.profiles.publicId, publicId), isNull(schema.profiles.deletedAt)))
    .limit(1);

  return row
    ? {
        id: row.publicId,
        name: row.name,
        kind: row.kind as ProfileKind,
        avatar: row.avatar,
        routine: resolveProfileRoutine(row.routineConfig),
        // The calendar DATE the profile was created, in UTC. Exact enough for a navigation floor —
        // a boundary off by one in a distant zone costs one unreachable empty day, not correctness.
        firstDay: row.createdAt.toISOString().slice(0, 10),
      }
    : null;
}

/**
 * Persist a kid's routine config (V1-18 PR 2, coach editor). A single-column `UPDATE profiles SET
 * routine_config = …` keyed on the profile's own `public_id` — DAL-local (NOT a `packages/db` writer):
 * unlike the strength set-edit, a routine write carries no cross-table ownership join, so there is no
 * IDOR-load-bearing SQL to single-source + prove via `db:verify`. It mirrors the simple single-table
 * writers (`logBodyweight`/`logCheckinEntries`), which also live in the DAL. `.returning` distinguishes a
 * live match from none: a soft-deleted / unknown id yields `null`, which the action maps to a typed error.
 *
 * The config is validated STRICTLY by the action (`validateRoutineForWrite`) BEFORE this call — the DAL
 * stores what it is given. Non-UUID ids never reach here: the action re-resolves via `getProfileByPublicId`
 * first (its `uuidSchema` guard), the same ownership seam every other writer uses.
 */
export async function updateProfileRoutine(
  publicId: string,
  config: RoutineConfig,
): Promise<{ id: string } | null> {
  const [row] = await db
    .update(schema.profiles)
    .set({ routineConfig: config })
    .where(and(eq(schema.profiles.publicId, publicId), isNull(schema.profiles.deletedAt)))
    .returning({ id: schema.profiles.publicId });

  return row ? { id: row.id } : null;
}
