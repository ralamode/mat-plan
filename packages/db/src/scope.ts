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
 * - **The BRAND** blocks an inline object literal standing in for a derived scope. A deliberate
 *   `as unknown as HouseholdScope` still compiles — that is a visible, reviewable forgery, which is
 *   the point: it cannot happen by accident.
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

export type HouseholdScope = {
  readonly householdId: HouseholdRow['id'];
  readonly [householdScopeBrand]: true;
};

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
export function householdScopeForRequest(householdId: number): HouseholdScope {
  return makeHouseholdScope(householdId, 'householdScopeForRequest');
}

/**
 * The shared brand application, for the two named constructors only.
 *
 * ⚠️ `src/index.ts` re-exports `HouseholdScope` and `householdScopeForRequest` **by name** — not
 * `export * from './scope'` — precisely so this escapes into no bare-specifier import. It is reached
 * only by relative path, from inside `packages/db`.
 */
export function makeHouseholdScope(householdId: number, who: string): HouseholdScope {
  if (!Number.isSafeInteger(householdId)) {
    throw new Error(`${who}: household id must be a safe integer, got ${String(householdId)}`);
  }
  return { householdId } as HouseholdScope;
}
