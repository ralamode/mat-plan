import { and, sql, type SQL } from 'drizzle-orm';

import { schema } from '../client';
import type { HouseholdScope, OwnerScope } from '../scope';
import { isLiveProfile, isOwnerOf } from './ownership';
import type { Executor } from './executor';

/** What both archive writers return — the row's public id and the stored `archived_at`, or `null`. */
type ArchivedRow = { publicId: string; archivedAt: Date | null };

/**
 * The profile-identity write core (PROF-1 a-r) — one guarded `UPDATE profiles SET name`.
 *
 * ## Why this lives in `packages/db` and `updateProfileRoutine` does not
 *
 * `apps/web/lib/dal/profiles.ts` keeps `updateProfileRoutine` DAL-local on the stated ground that a
 * routine write "carries no cross-table ownership join, so there is no IDOR-load-bearing SQL to
 * single-source + prove via `db:verify`". A rename carries no join either — so the reason it is here
 * is a different one, and worth naming rather than inheriting:
 *
 * 🔴 **Rename is the first write whose own refusal is the product behaviour under test.** Acceptance
 * criterion 4 is _"if a rename names a profile outside the session's household, the system shall
 * respond as for an unknown profile and write nothing"_ — the write updating **0 rows** IS the
 * criterion, not a side effect of one. An emitted-SQL assertion proves the conjunct was appended; it
 * cannot prove which rows a real Postgres then touches. `db:verify` runs THIS function against two
 * real households, which is the only thing that can (`write-path.md` invariant 3).
 * PROF-1 b's archive and restore join it here for the same reason, which is why the module is
 * `profile.ts` and not `rename.ts`.
 *
 * ⚠️ **`updateProfileRoutine` is NOT converted in this PR** and that is deliberate: moving a shipped
 * writer is a diff with no behavioural question in it, and it would put a second concern in a PR that
 * already carries a route, an action module and a form. It is recorded as the pre-PROF-1 DAL-local
 * writer in `docs/features/write-path.md` rather than left to be rediscovered.
 */

/**
 * Rename ONE live profile inside `scope`. Returns the row's `public_id`, or `null` when the id is
 * unknown, soft-deleted or belongs to another household — one answer for all three, which the action
 * maps to the single `NO_ATHLETE_SAVE` envelope (ADR 0006 → 404, never 403).
 *
 * `isLiveProfile(publicId, scope)` is THE ownership predicate, imported rather than rebuilt: a
 * hand-written `and(eq(publicId), isNull(deletedAt), eq(householdId))` here would be the twelfth copy
 * of the thing `writers/ownership.ts` exists to have exactly one of.
 *
 * ⚠️ **`archived_at` is deliberately NOT a conjunct.** An archived athlete can still be renamed —
 * archive is "not currently training", not a lock (`schema.ts` → `profiles.archivedAt`). Adding it
 * here would make a typo in an archived athlete's name unfixable without first restoring them.
 *
 * ⚠️ **`kind` is not a parameter**, by decision (2026-11-07): a-r renames and nothing else. A later
 * chunk that wants to set `kind` adds its own writer and owes the export-history question an answer
 * first (the plan's § Out-of-scope).
 *
 * `updated_at` is set from the DATABASE clock (`now()`), not a JS `Date`: it is a server-side audit
 * column, and the LWW rule that compares a CLIENT-supplied `updated_at` is `/api/sync`'s at v1.5, a
 * different question (the `updateBodyweightEntryById` note makes the same distinction).
 */
export async function renameProfile(
  exec: Executor,
  scope: HouseholdScope,
  publicId: string,
  name: string,
): Promise<{ publicId: string } | null> {
  const rows = await exec
    .update(schema.profiles)
    .set({ name, updatedAt: sql`now()` })
    .where(isLiveProfile(publicId, scope))
    .returning({ publicId: schema.profiles.publicId });

  return rows[0] ?? null;
}

/**
 * The shared `archived_at` write — **it takes a PREDICATE, never a scope** (PROF-1 b).
 *
 * 🔴 **That signature is the whole point of this helper, and the plan's first draft got it wrong.**
 * It originally specified one exported `setProfileArchived(exec, scope, publicId, archived)` whose
 * `WHERE` was `isLiveProfile(publicId, scope)` alone. Read as the shared core it looked like, that is
 * an exported archive path taking a **plain** scope with **no owner conjunct** — a member archives,
 * and `isOwnerOf` ends up with no caller at all. A security lens found it in the plan before any code
 * existed.
 *
 * A helper that takes an already-built `where` cannot make that mistake: the authority decision is
 * made by the **caller's parameter type**, and by the time control reaches here the predicate is
 * sealed. The two exported writers below differ in exactly one visible way — which predicate they
 * hand in — which is what makes the authority readable at the call site instead of buried in a
 * boolean argument.
 *
 * `updated_at` comes from the DATABASE clock, as in `renameProfile`: it is a server-side audit
 * column, not a client-supplied LWW timestamp.
 */
async function writeArchivedAt(
  exec: Executor,
  where: SQL,
  archivedAt: SQL,
): Promise<ArchivedRow | null> {
  const rows = await exec
    .update(schema.profiles)
    .set({ archivedAt, updatedAt: sql`now()` })
    .where(where)
    .returning({
      publicId: schema.profiles.publicId,
      archivedAt: schema.profiles.archivedAt,
    });

  return rows[0] ?? null;
}

/**
 * Archive ONE live profile inside `scope`. **Owner authority, carried by the parameter type.**
 *
 * 🔴 **`OwnerScope`, not `HouseholdScope`, and that is the check.** A caller holding a plain scope
 * cannot reach this function without going through `ownerScope()` — forgetting the authority is a
 * COMPILE error, not a review miss. `isOwnerOf(owner)` then re-states the role inside the predicate
 * so a narrowing lost in a refactor matches **0 rows** instead of writing; see its docblock for what
 * that does and does not prove (it reads no column, and it is not a database-side check).
 *
 * Returns the row's `public_id` and the stored `archived_at`, or `null` for an id that is unknown,
 * soft-deleted, in another household **or** reached with a forged owner scope — one answer for all
 * four. ⚠️ **0 rows is therefore AMBIGUOUS between "not found" and "not owner"**, which is exactly
 * why the refusal ORDER lives in the DAL (`lib/dal/profiles.ts` → `archiveAthlete`) and not here: the
 * distinct `OWNER_ONLY_ATHLETE` message can only come from `ownerScope()` returning `null` *before*
 * this call. A second caller that skipped that resolve would get the 404-shaped answer instead, which
 * is safe but unhelpful.
 *
 * **`COALESCE(archived_at, now())` makes a replay idempotent on the DATE, not just on the row.**
 * Archiving an already-archived athlete must not move the timestamp — an offline queue flushing the
 * same tap twice, or a double tap on the gym floor, would otherwise rewrite when they stopped
 * training. The row count is 1 either way, so only the date can carry the distinction.
 *
 * ⚠️ **`archived_at` is not in `isLiveProfile`** (`ownership.ts`), so an archived athlete is still
 * reachable, renameable and exportable. Archive is "not currently training", not a lock.
 */
export async function archiveProfile(
  exec: Executor,
  owner: OwnerScope,
  publicId: string,
): Promise<ArchivedRow | null> {
  return writeArchivedAt(
    exec,
    and(isLiveProfile(publicId, owner), isOwnerOf(owner)) as SQL,
    sql`COALESCE(${schema.profiles.archivedAt}, now())`,
  );
}

/**
 * Restore ONE live profile inside `scope`. **ANY member, by decision M1** _(maintainer, 2026-11-06)_.
 *
 * 🔴 **A plain `HouseholdScope`, and the asymmetry with `archiveProfile` is deliberate.** Archiving
 * takes an athlete off everyone's picker; restoring puts one back, which is the recovery action. The
 * scenario the split exists for is a gym-floor one: the owner archives the wrong kid at home,
 * practice starts, and the other adult must be able to fix it without finding the owner. Requiring
 * owner authority to UNDO an owner's mistake is the failure mode, not the protection.
 *
 * No owner conjunct, therefore — and a mutation patch adds one so that absence is a proved decision
 * rather than a forgotten line. ⚠️ **That patch must change the SQL, not the type:** `db:mutations`
 * runs `verify.ts` under `tsx`, where a type-only edit is erased at runtime and the gate would stay
 * green on a vacuous proof.
 *
 * Restoring an already-live athlete is a harmless no-op: the row matches, `archived_at` is set to
 * `NULL` over `NULL`, one row comes back. The action's Undo path relies on that — it may fire twice.
 */
export async function restoreProfile(
  exec: Executor,
  scope: HouseholdScope,
  publicId: string,
): Promise<ArchivedRow | null> {
  return writeArchivedAt(exec, isLiveProfile(publicId, scope) as SQL, sql`NULL`);
}
