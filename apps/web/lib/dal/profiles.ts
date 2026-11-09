import 'server-only';

import {
  archiveProfile,
  createProfile,
  hasLiveEntries,
  householdProfileRows,
  isLiveProfile,
  ownerScope,
  renameProfile,
  restoreProfile,
  schema,
} from '@mat-plan/db';
import {
  type AddAthleteInput,
  type ProfileKind,
  type RoutineConfig,
  uuidSchema,
} from '@mat-plan/shared';

import { cache } from 'react';

import { resolveProfileRoutine } from '@/lib/routine/catalog';

import { db } from './db';
import {
  AUTHORITY_ACTION,
  getHouseholdScope,
  reportAuthorityRefusal,
  reportScopeMiss,
  SCOPE_MISS_ACTION,
} from './household';

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
 * A null scope returns `[]` — the picker's empty state. ⚠️ **Since `AUTH-1` 1c-4 that is no longer
 * only "an empty database":** it is also a signed-in person with no membership, which is the common
 * case now (an invited parent whose account was never linked, or the wrong Google account). The
 * screen is the same by design and the cause rides `scope_outcome` to the dashboard.
 *
 * The ambiguous case still never reaches here — the resolver throws — but it is now **two
 * memberships for one principal**, not two live households.
 */
/**
 * The household's athletes, **fetched once per request and mapped once** (PROF-1 b).
 *
 * 🔴 **`cache()` is load-bearing here, not a micro-optimisation.** The picker needs the live athletes
 * AND the archived count, and a reuse lens caught the first version running
 * `householdProfileRows` — `EXISTS` subquery included — **twice per render** of the app's most-visited
 * page, because neither DAL function was cached. The "one query, two consumers" argument in
 * `queries/household-profiles.ts` is only true if the request makes one query.
 *
 * It also makes the row→DTO mapping exist once. The first version wrote the same four-field map in
 * `listProfiles` and `listHouseholdAthletes`, with the `archivedAt === null` rule derived in three
 * places — which is the duplication the maintainer's N4 rule names.
 */
const householdAthletes = cache(async (): Promise<HouseholdAthleteDTO[]> => {
  const scope = await getHouseholdScope();
  if (!scope) return [];

  const rows = await householdProfileRows(db, { scope });

  return rows.map((r) => ({
    id: r.publicId,
    name: r.name,
    kind: r.kind as ProfileKind,
    avatar: r.avatar,
    archived: r.archivedAt !== null,
    hasHistory: r.hasEntries,
  }));
});

export async function listProfiles(): Promise<ProfileDTO[]> {
  // PROF-1 b, criterion 5: an ARCHIVED athlete leaves the picker. Filtered HERE and not in the
  // query's `WHERE`, because that predicate is the tenancy boundary (`household-profiles.ts`) and
  // must not grow a second rule.
  return (await householdAthletes()).filter((a) => !a.archived);
}

/**
 * Every athlete in the household, **archived ones included** — Household settings' list (PROF-1 b).
 *
 * The one surface that must show an archived athlete. `listProfiles` above is the same rows minus the
 * archived; both come from `householdAthletes`, so the query, the tenancy predicate and the mapping
 * are each defined exactly once.
 *
 * `hasHistory` exists for maintainer decision N3: the export control is disabled **with a stated
 * reason** when an athlete has logged nothing, rather than handing back a zip with no entries in it,
 * which iOS Files opens as nothing and which is indistinguishable from a failed download.
 */
export type HouseholdAthleteDTO = ProfileDTO & {
  archived: boolean;
  hasHistory: boolean;
};

export async function listHouseholdAthletes(): Promise<HouseholdAthleteDTO[]> {
  return householdAthletes();
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
  /**
   * PROF-1 b: archived means "not currently training", **not** gone and not locked. The row still
   * resolves, still renames and still exports — so this is a display and form-enable flag, never an
   * access decision.
   */
  archived: boolean;
  /**
   * PROF-1 b, decision N3: whether this athlete has logged anything. The day page's export link is
   * replaced by a stated reason when it is `false`, because `buildExportZip` otherwise returns an
   * EOCD-only archive that iOS Files opens as nothing — indistinguishable from a failed download.
   */
  hasHistory: boolean;
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
export const getProfileByPublicId = cache(
  async (publicId: string): Promise<ProfileWithRoutineDTO | null> => {
    // The public id column is `uuid`; a malformed value (e.g. a garbage URL segment)
    // would make Postgres throw on the comparison. Treat a non-UUID as not-found so
    // callers get a clean null (page → 404), never a 500. Deliberately BEFORE the scope-miss report:
    // a value that is not a uuid is not a probe of an id, so it is not that event.
    if (!uuidSchema.safeParse(publicId).success) return null;

    const scope = await getHouseholdScope();
    if (!scope) {
      await reportScopeMiss({
        action: SCOPE_MISS_ACTION.resolveProfile,
        profilePublicId: publicId,
      });
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
        // PROF-1 b. The day page turns its forms off for an archived athlete and shows the restore
        // pointer; `isLiveProfile` deliberately does NOT exclude archived rows, so the flag has to
        // come back as data rather than as an absent row.
        archivedAt: schema.profiles.archivedAt,
        // PROF-1 b, decision N3 — the SAME `EXISTS` the settings list uses, on a SELECT that already
        // runs. Without it the day page offered an export link for an athlete with nothing to export,
        // while the settings row for that same athlete said there was nothing. One rule, both surfaces.
        hasEntries: hasLiveEntries(db),
      })
      .from(schema.profiles)
      .where(isLiveProfile(publicId, scope))
      .limit(1);

    if (!row) {
      // ADR 0006 obligation 3. The external answer is still `null` → 404; this is the only signal the
      // server can produce for an event the scoped predicate makes invisible. ONE site, by design —
      // see `reportScopeMiss`.
      await reportScopeMiss({
        action: SCOPE_MISS_ACTION.resolveProfile,
        profilePublicId: publicId,
      });
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
      archived: row.archivedAt !== null,
      hasHistory: row.hasEntries,
    };
  },
);

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

/**
 * Rename one athlete (PROF-1 a-r).
 *
 * The action has already re-resolved the profile through `getProfileByPublicId` — the ownership seam
 * — so this is the second, deeper check rather than the only one, which is what `write-path.md`
 * invariant 3 asks for ("a guard that exists only in the DAL is a guard no proof covers", and the
 * converse: a guard that exists only in the action is one a second caller can skip). `renameProfile`
 * rides `isLiveProfile(publicId, scope)`, so an unknown, soft-deleted or foreign id updates 0 rows
 * and comes back `null`.
 *
 * The `name` is already trimmed, whitespace-collapsed and length-checked by `renameAthleteSchema`
 * (`@mat-plan/shared`) BEFORE it arrives — this layer stores what it is given, the
 * `updateProfileRoutine` convention. Non-UUID ids never reach here either, for the same reason that
 * function states: the action resolves the profile first, which is also why the scope miss is
 * reported there and not again here.
 *
 * ⚠️ **It returns `{ id }`, never the renamed row.** The action needs the public id to revalidate
 * two paths and nothing else; handing back a DTO would invite a caller to render a name this
 * function did not read back from the database.
 */
export async function renameAthlete(
  publicId: string,
  name: string,
): Promise<{ id: string } | null> {
  const scope = await getHouseholdScope();
  if (!scope) return null;

  const row = await renameProfile(db, scope, publicId, name);
  return row ? { id: row.publicId } : null;
}

/**
 * The refusal an athlete-authority write can produce, as a DISCRIMINATED result (PROF-1 b).
 *
 * 🔴 **Why this exists instead of `null`.** `archiveProfile`'s predicate is
 * `isLiveProfile ∧ isOwnerOf`, so **0 rows is ambiguous** between "unknown id" and "not the owner" —
 * the database cannot tell the action which refusal to show. The distinction can only be made
 * *before* the write, by `ownerScope()` returning `null`, which means **the order is part of the
 * contract and belongs to one place**. A security lens found the plan leaving that order to the
 * action's call sequence, where a second caller (`/api/sync`, a correction, a later page) would get
 * it the other way round: `write-path.md` invariant 3 — a guard that exists only in the action is one
 * a second caller can skip.
 */
export type AthleteWriteResult =
  | { ok: true; id: string }
  /**
   * ⚠️ **Widened at a-1w, not forked.** `createAthlete` adds `no_scope` (no household resolved) and
   * `refused` / `full` (the create's own answers). An earlier plan draft called the first of these
   * `no_household` in two rows and `no_scope` in a diagram — `no_household` was **retired at 1c-4**
   * and does not come back. One envelope for every athlete write keeps the actions' mapping in one
   * shape.
   */
  | { ok: false; reason: 'not_found' | 'not_owner' | 'no_scope' | 'refused' | 'full' };

/**
 * Archive one athlete. **Owner only** — and the ORDER is the point.
 *
 * 1. Resolve the id through the ownership seam (`getProfileByPublicId`, which is `cache()`d — a
 *    security lens found this comment claiming that before it was true, and the fix was to make it
 *    true rather than to weaken the claim, since the duplicate resolve in the action rests on it). A miss is `not_found`, which the action renders
 *    byte-identically to the no-session refusal (ADR 0006 → 404, never 403).
 * 2. **Then** narrow to an `OwnerScope`. A member reaches here with a real athlete, so the refusal is
 *    `not_owner` — a distinct message ADR 0006:348 permits precisely because the id is *inside the
 *    caller's own household*: they can already see that athlete on `/settings`, so naming the reason
 *    leaks nothing and "no athlete found" would be a lie.
 * 3. Only then write. `archiveProfile` requires `OwnerScope` by parameter type, so step 2 cannot be
 *    skipped by a future caller without a compile error.
 *
 * ⚠️ **Ownership-first is what hands different strings for an own vs a foreign id, and that is
 * correct** — the plan's first draft claimed the opposite (role-first hands the SAME string for every
 * id, which is strictly less useful: a stale link to a deleted athlete would read "not yours").
 */
export async function archiveAthlete(publicId: string): Promise<AthleteWriteResult> {
  const profile = await getProfileByPublicId(publicId);
  if (!profile) return { ok: false, reason: 'not_found' };

  const scope = await getHouseholdScope();
  if (!scope) return { ok: false, reason: 'not_found' };

  const owner = ownerScope(scope);
  if (!owner) {
    await reportAuthorityRefusal(AUTHORITY_ACTION.archiveProfile);
    return { ok: false, reason: 'not_owner' };
  }

  const row = await archiveProfile(db, owner, publicId);
  // Belt and braces: the predicate can still match 0 rows (a race with a soft-delete). It is
  // `not_found` rather than `not_owner` — we proved ownership a statement ago.
  return row ? { ok: true, id: row.publicId } : { ok: false, reason: 'not_found' };
}

/**
 * Restore one athlete. **Any member** (decision M1) — the recovery action needs no owner.
 *
 * No narrowing, and therefore no `not_owner` branch: the signature is the permission. Restoring an
 * athlete who is already live is a harmless no-op, which the Undo path depends on — it can fire
 * twice, and `db:verify` asserts that.
 */
export async function restoreAthlete(publicId: string): Promise<AthleteWriteResult> {
  const profile = await getProfileByPublicId(publicId);
  if (!profile) return { ok: false, reason: 'not_found' };

  const scope = await getHouseholdScope();
  if (!scope) return { ok: false, reason: 'not_found' };

  const row = await restoreProfile(db, scope, publicId);
  return row ? { ok: true, id: row.publicId } : { ok: false, reason: 'not_found' };
}

/**
 * Create one athlete in the request's household — **any member** (PROF-1 a-1w).
 *
 * No `getProfileByPublicId` here, unlike archive and restore: there is no id to resolve. The
 * authorization decision is simply whether a scope resolves at all, which `scoped.test.ts` requires
 * this function to make by awaiting `getHouseholdScope()`.
 *
 * ⚠️ **`no_scope` is NOT an error to show a person.** It means a signed-in account with no
 * membership reached a mutation, which the UI never offers — so the action maps it to the same
 * refusal an unauthenticated caller gets. `full` is the opposite: it is the household's own quota,
 * only reachable after the scope resolved, and it gets copy that says so.
 */
export async function createAthlete(input: AddAthleteInput): Promise<AthleteWriteResult> {
  const scope = await getHouseholdScope();
  if (!scope) return { ok: false, reason: 'no_scope' };

  const created = await createProfile(db, scope, input);
  return created.ok ? { ok: true, id: created.publicId } : { ok: false, reason: created.reason };
}
