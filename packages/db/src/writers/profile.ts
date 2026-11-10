import { and, sql, type SQL } from 'drizzle-orm';

import { foldName, MAX_HOUSEHOLD_ATHLETES, type ProfileKind } from '@mat-plan/shared';

import { schema } from '../client';
import type { HouseholdScope, OwnerScope } from '../scope';
import {
  countProfilesIn,
  findNameMatch,
  type NameMatch,
  insertProfileOwnedBy,
  isLiveProfile,
  isOwnerOf,
  profileByClientId,
} from './ownership';
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
 * What `renameProfile` answers. `refused` is the one answer for unknown / soft-deleted / another
 * household (ADR 0006 → 404, never 403); `duplicate` is ADVISORY — the name is free to collide, and
 * an acknowledgement waves it through.
 */
export type RenameProfileResult =
  | { ok: true; publicId: string }
  | { ok: false; reason: 'refused' }
  | { ok: false; reason: 'duplicate'; match: NameMatch };

/**
 * The stored name of ONE live profile in `scope`, for the fold guard in `renameProfile`.
 *
 * ⚠️ **Scoped, and narrow on purpose.** It returns the name and nothing else: a caller handed a
 * fuller row would be tempted to render it, and this value exists only to be folded. `scope` reaches
 * the query through `isLiveProfile`, so `scope.householdId` keeps leaving only `ownership.ts`
 * (`scope.test.ts`'s `UNWRAPS_SCOPE`).
 */
async function profileNameFor(
  exec: Executor,
  scope: HouseholdScope,
  publicId: string,
): Promise<{ name: string } | null> {
  const rows = await exec
    .select({ name: schema.profiles.name })
    .from(schema.profiles)
    .where(isLiveProfile(publicId, scope))
    .limit(1);
  return rows[0] ?? null;
}

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
  options: { acknowledgedDuplicate?: string } = {},
): Promise<RenameProfileResult> {
  // The CURRENT row, read first — the fold guard below needs the stored name, and `refused` must
  // stay distinguishable from `duplicate`. One answer for unknown / soft-deleted / other household.
  const current = await profileNameFor(exec, scope, publicId);
  if (!current) return { ok: false, reason: 'refused' };

  // 🔴 **A rename that does not change the FOLD creates no new collision, so there is nothing to
  // warn about.** `ada` → `Ada`, `Jose` → `José`, a stray double space, or Save with nothing edited
  // all land here. Without this guard the warning fires on exactly the edit this screen exists for.
  //
  // ⚠️ **It also replaces the `excludeProfileId` this plan carried for two chunks.** Excluding SELF
  // is not enough: two live athletes sharing a name is the designed case (the add form's "Add
  // another Ada" creates it, with consent), so a casing fix on Ada #1 would be warned about Ada #2 —
  // a collision that already existed and that nobody is creating here. And the parameter is not
  // merely redundant, it is unreachable: with the fold unchanged this returns before the lookup, and
  // with the fold CHANGED the row's stored name folds to the OLD value and cannot match the new one.
  // There is no third case, which is why `findNameMatch` needs no exclusion argument at all.
  const folded = foldName(name);
  if (folded !== foldName(current.name) && options.acknowledgedDuplicate !== folded) {
    const match = await findNameMatch(exec, scope, folded);
    // ⚠️ **No `atCap` here, unlike `createProfile`.** A rename creates nothing, so the quota is
    // never consulted and a field that is always `false` would read as meaningful.
    if (match) return { ok: false, reason: 'duplicate', match };
  }

  const rows = await exec
    .update(schema.profiles)
    .set({ name, updatedAt: sql`now()` })
    .where(isLiveProfile(publicId, scope))
    .returning({ publicId: schema.profiles.publicId });

  const row = rows[0];
  return row ? { ok: true, publicId: row.publicId } : { ok: false, reason: 'refused' };
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

/**
 * What `createProfile` answers. `refused` and `full` are both "no row was created", but they are not
 * the same event and the DAL maps them to different copy: `refused` is a key that belongs to another
 * household (or to a soft-deleted row), `full` is this household's own quota.
 */
export type CreateProfileResult =
  | { ok: true; publicId: string }
  | { ok: false; reason: 'refused' | 'full' }
  /**
   * PROF-1 a-1d. **A warning, not a refusal** — the caller may resubmit with
   * `acknowledgedDuplicate` and the add proceeds.
   *
   * 🔴 **`atCap` rides along because the UI must not offer a button the endpoint will reject.** The
   * duplicate check runs BEFORE the quota (so an archived twin can be restored by a household that is
   * full — restore needs no slot), which means a household at the cap sees the warning first. Without
   * this flag the screen would offer "Add another", and that resubmit would die on `full`.
   */
  | { ok: false; reason: 'duplicate'; match: NameMatch; atCap: boolean };

/**
 * Create one athlete in `scope` — **replay-first** (PROF-1 a-1, decision D2).
 *
 * `HouseholdScope`, not `OwnerScope`: **any member adds** (§ Role authority). Archive is the
 * owner-only act; adding is not.
 *
 * ## The order, and why each step is where it is
 *
 * 1. **Look up the `client_id` inside the scope, BEFORE anything else.** A double submit, a replayed
 *    pre-hydration POST and an offline flush all arrive as the same key, and all three must return
 *    the FIRST row rather than mint a twin. Reading first also means a replay costs one indexed point
 *    read and no write.
 * 2. **The duplicate-name fold (a-1d), BEFORE the quota.** 🔴 **That order is deliberate and was
 *    contested.** Quota-first reads more naturally, but an archived twin occupies a slot — so a full
 *    household re-adding an archived `Zoë` would be told "write to us" instead of being offered
 *    **Restore, which needs no slot at all.** Duplicate-first keeps the one recovery that works
 *    reachable. The price is that the warning can appear to a household that is full, which is why
 *    the result carries `atCap` and the screen hides "Add another" when it is set.
 *    ⚠️ **Skipped entirely when the caller acknowledges**, and the acknowledgement is compared to
 *    `foldName(name)` so consent to "Ada" cannot wave "Bea" through.
 * 3. **The quota, after the replay check and before the insert.** That order is the whole subtlety:
 *    a household at the cap replaying a key it already used must still get `ok`, because that request
 *    creates nothing. Checking first would turn a retry into a refusal at exactly the moment the
 *    parent's connection is flaky.
 * 4. **Insert, `ON CONFLICT (client_id) DO NOTHING`**, then **re-read through the same scoped
 *    lookup**. The conflict path is reached when the key is already spent — by this household (a
 *    race with step 1) or by another one, since `uq_profiles_client_id` is global and non-partial.
 *    The re-read is what tells those apart: it returns a row only if the key is *ours*.
 *
 * 🔴 **Steps 1 and 4 are the same function, and that is the isolation boundary.** See
 * `profileByClientId`'s docblock for what a lost `inHousehold` costs — it is A's `public_id` handed
 * to B, which a row-count proof cannot see.
 *
 * ⚠️ **`refused` is the honest answer for a soft-deleted row too.** The key is spent and the index is
 * non-partial, so a replay cannot resurrect it; saying so beats silently minting a second athlete
 * under a key the parent believes they already used.
 *
 * ## ⚠️ What the duplicate warning does NOT promise
 *
 * **It is advisory and best-effort, not an invariant.** Two requests with DIFFERENT keys and the same
 * name arriving together both pass step 2 and both insert — exactly the duplicate this feature exists
 * to discourage. A unique index on a folded name is impossible, because "Add another" is a *feature*:
 * two cousins really can both be Ada. The same count-then-insert race already applies to the quota
 * (`docs/tech-debt.md`). Nothing here should be described as preventing duplicates; it warns about
 * them.
 */
export async function createProfile(
  exec: Executor,
  scope: HouseholdScope,
  input: {
    name: string;
    kind: ProfileKind;
    clientId: string;
    /** The FOLDED name the caller was warned about, if they are re-confirming. */
    acknowledgedDuplicate?: string;
  },
): Promise<CreateProfileResult> {
  const existing = await profileByClientId(exec, scope, input.clientId);
  if (existing) return { ok: true, publicId: existing.publicId };

  // Step 2 — the duplicate fold. `acknowledgedDuplicate` is the FOLDED name the caller was warned
  // about, so an acknowledgement of "Ada" does not wave "Bea" through on stale consent.
  if (input.acknowledgedDuplicate !== foldName(input.name)) {
    // ⚠️ `excludeClientId` is this caller's OWN key. A concurrent same-key twin that loses the race
    // to step 1 but wins it to step 2 must not be told "duplicate" by the row its own twin just
    // inserted — it falls through to steps 3-4 and returns that row's id.
    //
    // 🔴 **THIS ARGUMENT HAS NO MUTATION PATCH, deliberately.** One was written and stayed GREEN:
    // the replay lookup above returns at step 1, so the exclusion is never consulted sequentially,
    // and the interleaving it actually guards — a twin inserting BETWEEN those two reads — cannot
    // be staged in single-connection PGlite. It is real against a pooled Neon, so the argument
    // stays; what does not ship is a patch that reddens nothing, since `db:mutations` exists to
    // catch exactly that. ⚠️ The ORDERING is a different question and DOES have a patch (`30`):
    // once a second athlete of the same name exists, the exclusion can no longer rescue a replay.
    const match = await findNameMatch(exec, scope, foldName(input.name), {
      excludeClientId: input.clientId,
    });
    if (match) {
      const atCap = (await countProfilesIn(exec, scope)) >= MAX_HOUSEHOLD_ATHLETES;
      return { ok: false, reason: 'duplicate', match, atCap };
    }
  }

  if ((await countProfilesIn(exec, scope)) >= MAX_HOUSEHOLD_ATHLETES) {
    return { ok: false, reason: 'full' };
  }

  await insertProfileOwnedBy(exec, scope, input);

  const created = await profileByClientId(exec, scope, input.clientId);
  return created ? { ok: true, publicId: created.publicId } : { ok: false, reason: 'refused' };
}
