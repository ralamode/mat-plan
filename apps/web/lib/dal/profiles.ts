import 'server-only';

import { householdProfileRows, isLiveProfile, schema } from '@mat-plan/db';
import { type ProfileKind, type RoutineConfig, uuidSchema } from '@mat-plan/shared';

import { resolveProfileRoutine } from '@/lib/routine/catalog';

import { db } from './db';
import { getHouseholdScope, reportScopeMiss, SCOPE_MISS_ACTION } from './household';

/**
 * Profile reads and the routine write (V0-5). Every DAL function returns a minimal DTO — never a raw
 * row — and keeps DB access here (`server-only`). `public_id` (UUIDv7) is the id the UI/URLs ever see.
 *
 * **Household scoping landed at TEN-1 1b**, and all three functions here resolve it themselves:
 * `getHouseholdScope()` is ambient at the request boundary (`write-path.md` invariant 8 makes
 * `lib/dal/*` the one layer allowed ambient server state) and explicit at the SQL boundary. No page,
 * action or Route Handler signature carries a scope — threading one through ~11 files would move the
 * mistake to a layer where the compiler cannot see it (the parameter is present, just wrong).
 *
 * AUTH-1 replaces only `getHouseholdScope()`'s body. Nothing in this file moves.
 */
export type ProfileDTO = {
  id: string;
  name: string;
  kind: ProfileKind;
  avatar: string | null;
};

/**
 * The picker's profiles — **the session household's, and no others**.
 *
 * ⚠️ **Under ADR 0006 (option A, session-only) this function is the entire isolation boundary for
 * the app's front door.** `/p` is byte-identical for every household on earth, so there is no id in
 * the address to disagree with the session: nothing but this `WHERE` separates two families. Until
 * TEN-1 its only predicate was `deleted_at IS NULL` — *every profile in the database* — which is
 * `.github/SECURITY.md`'s #1 risk stated as a query.
 *
 * The query is single-sourced in `packages/db/src/queries/household-profiles.ts` so `db:verify`
 * proves **this function's SQL** against a real two-household database, which is ADR 0006's named
 * obligation. An emitted-SQL assertion alone would only prove a conjunct was appended, never which
 * rows come back.
 *
 * A null scope returns `[]` — the picker's empty state, the honest answer to an empty database. The
 * ≥2-household case never reaches here: the resolver throws.
 */
export async function listProfiles(): Promise<ProfileDTO[]> {
  const scope = await getHouseholdScope();
  if (!scope) return [];

  const rows = await householdProfileRows(db, { scope });

  return rows.map((r) => ({
    id: r.publicId,
    name: r.name,
    kind: r.kind as ProfileKind,
    avatar: r.avatar,
  }));
}

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

/**
 * Resolve a single profile by its public id (the id `/p/[profileId]` ever carries). **This is the
 * gate**: all 7 Server Actions, both profile pages and the export handler resolve through it
 * *first*, so scoping this one function fails every one of them closed in one place. Everything
 * deeper in the DAL is defence in depth, which `write-path.md` invariant 3 demands anyway (*"a guard
 * that exists only in the DAL is a guard no proof covers"*).
 *
 * Returns `null` when the id is unknown, soft-deleted, **or belongs to another household** — one
 * answer for all three, which is the whole point. ADR 0006 → "What a wrong-household request
 * returns": **404, never 403**, because the threat is not enumeration but a *leak* — an id an
 * attacker holds came from a shared link, a screenshot or a log line, and 403 would confirm the leak
 * is live. Callers map `null` the way they already do: page → `notFound()`, action → the typed
 * `NO_PROFILE_LOG` envelope, Route Handler → 404.
 *
 * ⚠️ **Consistent scoping is not authorization.** Before AUTH-1 the principal is a shared access
 * code, so this proves one household's data is unreachable *from a request scoped to another*; it
 * does not prove the requester is who they claim. That is AUTH-1, and it is the most likely thing
 * for a reader to over-claim.
 */
export async function getProfileByPublicId(
  publicId: string,
): Promise<ProfileWithRoutineDTO | null> {
  // The public id column is `uuid`; a malformed value (e.g. a garbage URL segment)
  // would make Postgres throw on the comparison. Treat a non-UUID as not-found so
  // callers get a clean null (page → 404), never a 500. Deliberately BEFORE the scope-miss report:
  // a value that is not a uuid is not a probe of an id, so it is not that event.
  if (!uuidSchema.safeParse(publicId).success) return null;

  const scope = await getHouseholdScope();
  if (!scope) {
    await reportScopeMiss({ action: SCOPE_MISS_ACTION.resolveProfile, profilePublicId: publicId });
    return null;
  }

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
    .where(isLiveProfile(publicId, scope))
    .limit(1);

  if (!row) {
    // ADR 0006 obligation 3. The external answer is still `null` → 404; this is the only signal the
    // server can produce for an event the scoped predicate makes invisible. ONE site, by design —
    // see `reportScopeMiss`.
    await reportScopeMiss({ action: SCOPE_MISS_ACTION.resolveProfile, profilePublicId: publicId });
    return null;
  }

  return {
    id: row.publicId,
    name: row.name,
    kind: row.kind as ProfileKind,
    avatar: row.avatar,
    routine: resolveProfileRoutine(row.routineConfig),
    // The calendar DATE the profile was created, in UTC. Exact enough for a navigation floor —
    // a boundary off by one in a distant zone costs one unreachable empty day, not correctness.
    firstDay: row.createdAt.toISOString().slice(0, 10),
  };
}

/**
 * Persist a kid's routine config (V1-18 PR 2, coach editor). A single-column `UPDATE profiles SET
 * routine_config = …` keyed on the profile's own `public_id` — DAL-local (NOT a `packages/db` writer):
 * unlike the strength set-edit, a routine write carries no cross-table ownership join, so there is no
 * IDOR-load-bearing SQL to single-source + prove via `db:verify`. It mirrors the simple single-table
 * writers (`logBodyweight`/`logCheckinEntries`), which also live in the DAL. `.returning` distinguishes a
 * live match from none: a soft-deleted, unknown **or foreign-household** id yields `null`, which the
 * action maps to a typed error.
 *
 * Since TEN-1 1b the WHERE is `isLiveProfile(publicId, scope)` — the same predicate, so this write
 * cannot scope by a weaker rule than the read that preceded it. The config is validated STRICTLY by
 * the action (`validateRoutineForWrite`) BEFORE this call — the DAL stores what it is given. Non-UUID
 * ids never reach here: the action re-resolves via `getProfileByPublicId` first (its `uuidSchema`
 * guard), which is also why the scope miss is reported there and not again here.
 */
export async function updateProfileRoutine(
  publicId: string,
  config: RoutineConfig,
): Promise<{ id: string } | null> {
  const scope = await getHouseholdScope();
  if (!scope) return null;

  const [row] = await db
    .update(schema.profiles)
    .set({ routineConfig: config })
    .where(isLiveProfile(publicId, scope))
    .returning({ id: schema.profiles.publicId });

  return row ? { id: row.id } : null;
}
