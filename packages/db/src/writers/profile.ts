import { sql } from 'drizzle-orm';

import { schema } from '../client';
import type { HouseholdScope } from '../scope';
import { isLiveProfile } from './ownership';
import type { Executor } from './executor';

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
