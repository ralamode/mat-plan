import { HOUSEHOLD_ROLE, HOUSEHOLD_ROLES, type HouseholdRole } from '@mat-plan/shared';

import type { HouseholdRow } from './types';

/**
 * TEN-1 — the household scope, the one value every scoped read and write carries.
 *
 * ## What this is
 *
 * `HouseholdScope` is **THE household this request is authorized for — a CAPABILITY, never a naked
 * tenant id** ([ADR 0006](../../../docs/decisions/0006-household-addressing.md) → "Forward
 * compatibility", requirement 1). It is branded, so it cannot be forged from an object literal, and
 * it is a record rather than a `number` so COACH-1's _"not mine, but shared with me"_ can widen the
 * return type instead of replacing it.
 *
 * ## What each mechanism actually buys — stated precisely, because it is easy to over-claim
 *
 * `.github/SECURITY.md`'s _"never trust a `household_id` from the request body"_ does **not** become
 * a type error here: `householdScopeForScript(Number(formData.get('hh')))` type-checks. What the
 * three mechanisms do buy:
 *
 * - **The REQUIRED positional parameter on `isLiveProfile`** is the compile-time guarantee, and it is
 *   what makes an unconverted call site a build failure rather than a review miss.
 * - **The BRAND** blocks an inline object literal standing in for a derived scope. ⚠️ A one-word
 *   `as HouseholdScope` compiles too — this bullet claimed it took `as unknown as`, which is false
 *   (line ~135 of this file does the one-word form, and so does `verify.ts`'s named forgery). TS
 *   allows `x as T` whenever either side is assignable to the other. What the brand buys is that a
 *   bare `{ householdId: 4 }` is a compile error, so a scope cannot be *conjured*; a cast is a
 *   visible, greppable forgery, which `src/scope.test.ts` now also guards for `OwnerScope`.
 * - **The module boundary** keeps the SCRIPT constructor out of `apps/web` entirely:
 *   `householdScopeForScript` lives in `writers/household-scope-script.ts`, which `src/index.ts`
 *   does **not** re-export, and `packages/db/package.json` maps only `"."` — so a deep bare import
 *   from the app fails **module resolution**. Containment is lexical, not a text scan a defaulted
 *   parameter or an aliased re-export could defeat.
 *
 * `householdId` is typed **from the row** rather than re-declared, so a future change to the
 * column's drizzle `mode` is a compile error in `isLiveProfile`'s `eq()` instead of a comment that
 * went stale. The field name stays `householdId`, not `id`: this is a capability, not a row.
 *
 * It carries **NO observability flag**. `households.synthetic` (chunk 1a) is deliberately not a
 * member — an authorization capability is the wrong carrier for an observability flag, a per-request
 * single-tenant scope cannot exclude a household from a cross-household aggregate anyway, and
 * keeping it off means no PR between 1a and OBS-2 reads the column (the plan's §Design 1a).
 */
declare const householdScopeBrand: unique symbol;
declare const ownerScopeBrand: unique symbol;

export type HouseholdScope = {
  readonly householdId: HouseholdRow['id'];
  /**
   * **What this principal is TO this household** (`PROF-1 b-s`), carried from the same
   * `household_members` row the id came from — see `queries/household-membership.ts` for why a
   * second lookup would be a safety defect rather than an extra query.
   *
   * ⚠️ **A capability field, not a permission check.** Nothing branches on this string outside
   * `writers/ownership.ts` (the predicate) and `ownerScope()` below (the narrowing);
   * `src/scope.test.ts` pins both. A page never sees it at all — `write-path.md` invariant 2 keeps
   * the whole scope inside `lib/dal`, and PROF-1 b gives the page a `canManageAthletes` boolean.
   */
  readonly role: HouseholdRole;
  readonly [householdScopeBrand]: true;
};

/**
 * A `HouseholdScope` whose principal is the household's **owner** (`PROF-1 b-s`).
 *
 * 🔴 **The authority is a TYPE, so forgetting it is a compile error, not a review miss.** A writer
 * that requires owner authority takes `OwnerScope` **by parameter type** — `archiveProfile`,
 * and later `INVITE-1`'s minting, member removal and `PRIV-3`'s deletion inherit the check by
 * signature rather than by a reviewer remembering. That is `HouseholdScope`'s own argument one level
 * up: *"the REQUIRED positional parameter on `isLiveProfile` is the compile-time guarantee, and it is
 * what makes an unconverted call site a build failure rather than a review miss."*
 *
 * It is a SUBTYPE: an `OwnerScope` is a `HouseholdScope`, so a writer that needs only household
 * authority accepts one without a cast, and widening never requires a second call.
 *
 * ⚠️ **The type is not the whole guard, and must not be sold as one.** A brand stops an accidental
 * widening and an inline literal; a one-word `as OwnerScope` still compiles (it is a subtype), so
 * `src/scope.test.ts` guards the cast lexically instead — `ownerScope()` here and one named forgery
 * in `verify.ts` are the only places it may appear.
 *
 * ⚠️ **The owner conjunct in `writers/ownership.ts` is NOT a database-side second check** — this
 * docblock said it was. It emits `$1 = $2` over the scope's own role field and reads no column; see
 * its own docblock for what it does buy (a lost narrowing fails closed, as a row count). **The only
 * authority is the single live-row read in `queries/household-membership.ts`.**
 */
export type OwnerScope = HouseholdScope & {
  readonly [ownerScopeBrand]: true;
};

/**
 * Narrow a scope to an `OwnerScope`, or `null` when the principal is not the owner.
 *
 * ⚠️ **This is the SECOND of exactly two modules allowed to name `scope.role`**, and the division is
 * deliberate: this file *narrows the type*, `writers/ownership.ts` *turns the role into SQL*. It
 * mirrors `householdId`, where this file constructs the capability and `ownership.ts` is the only
 * place that unwraps it into an `eq()`. `src/scope.test.ts` names both modules with a reason each,
 * rather than allowing a bare count — a third namer is a visible test edit.
 *
 * 🔴 **Returns `null` rather than throwing.** A non-owner reaching an owner-only path is an ordinary
 * refusal a caller renders as a typed envelope, not an exception: the alternative hands `error.tsx`
 * to a parent who merely tapped the wrong control.
 */
export function ownerScope(scope: HouseholdScope): OwnerScope | null {
  return scope.role === HOUSEHOLD_ROLE.owner ? (scope as OwnerScope) : null;
}

/**
 * The scope for a caller that HAS a request — derived, never supplied.
 *
 * ⚠️ **`apps/web/lib/dal/household.ts` is the only legitimate caller in the repo**, because that is
 * the one module allowed to decide which household a request belongs to (`getHouseholdScope()`). It
 * is exported from the package barrel because the app has no other way to reach it; the containment
 * is a guard (`packages/db/src/scope.test.ts`), not the module system, and that difference is
 * deliberate — see the brand note above for what each mechanism really buys.
 *
 * Asserts a safe integer: drizzle's `eq(col, undefined)` does **not** fail loudly, so an unresolved
 * id must throw here rather than silently widen a predicate to every household.
 */
export function householdScopeForRequest(householdId: number, role: HouseholdRole): HouseholdScope {
  return makeHouseholdScope(householdId, role, 'householdScopeForRequest');
}

/**
 * The shared brand application, for the two named constructors only.
 *
 * ⚠️ `src/index.ts` re-exports `HouseholdScope` and `householdScopeForRequest` **by name** — not
 * `export * from './scope'` — precisely so this escapes into no bare-specifier import. It is reached
 * only by relative path, from inside `packages/db`.
 */
export function makeHouseholdScope(
  householdId: number,
  role: HouseholdRole,
  who: string,
): HouseholdScope {
  if (!Number.isSafeInteger(householdId)) {
    throw new Error(`${who}: household id must be a safe integer, got ${String(householdId)}`);
  }
  // ⚠️ **`role` is validated for the reason `householdId` is: a bad value FAILS CLOSED but SILENTLY.**
  // `undefined` reaches `ownerScope()` as `undefined !== 'owner'` → refused, and reaches
  // `isOwnerOf` as a NULL bind → 0 rows. An owner would simply stop being able to archive, with
  // nothing in the logs saying why. A recording stub that returned one column too few produced
  // exactly this value in `apps/web`'s DAL tests, where `toEqual` then ignored the missing key.
  if (!HOUSEHOLD_ROLES.includes(role)) {
    throw new Error(
      `${who}: role must be one of ${HOUSEHOLD_ROLES.join(', ')}, got ${String(role)}`,
    );
  }
  // ⚠️ **`role` is REQUIRED and positional, for the reason `householdId` is** — a defaulted or
  // optional role would make every unconverted call site compile as `member`, silently, which is the
  // one change that turns this widening from a compile error into an invisible downgrade. There is
  // no "unknown" role: a scope exists only because a live membership row produced it.
  return { householdId, role } as HouseholdScope;
}
