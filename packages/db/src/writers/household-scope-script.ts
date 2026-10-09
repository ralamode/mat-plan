import { type HouseholdScope, makeHouseholdScope } from '../scope';

/**
 * TEN-1 — the household scope for a caller with **no request**: `db:verify` and `db:correct`.
 *
 * It **NAMES** the household, so the name says what it is. Every other way of obtaining a scope
 * derives it; this one is handed one, which is exactly why it must not be reachable from the app.
 *
 * ## Why this module exists at all
 *
 * `packages/db/src/index.ts` is the app's only entry point (`package.json` maps **only** `"."`), so
 * anything the barrel re-exports lands in `apps/web`'s autocomplete on the same specifier the app
 * already imports — an unauthenticated constructor for the authorization capability, sitting beside
 * the predicate the app is supposed to use. The barrel does **not** re-export this module, so a deep
 * bare import (`@mat-plan/db/src/writers/household-scope-script`) fails **module resolution**:
 * containment is lexical rather than a text scan.
 *
 * That matters because the drafted guard was a grep of `apps/web` for the identifier, and three
 * mistake paths defeat a grep without the name ever appearing there — a `packages/db` helper that
 * **defaults** the scope parameter (silently removing the required-parameter compile error, this
 * plan's primary safety mechanism), an aliased re-export, and `import * as db`.
 *
 * ## Who may call it
 *
 * `packages/db/scripts/**` by relative path, **plus `src/seed.ts`**. Today: `scripts/verify.ts` (the
 * TEN-1 matrix), `scripts/corrections/registry.ts` (a correction has no request to derive a household
 * from, and it must still be household-scoped), and `src/seed.ts` (TEN-1 1c — `seedProgram` resolves
 * **one household per block, inside the loop**, so a caller-supplied scope would be the wrong one).
 * Three real consumers, not a speculative extraction.
 *
 * ⚠️ `src/seed.ts` is in the barrel's graph, so this constructor is transitively in `apps/web`'s
 * module graph. That is safe only because nothing re-exports it and nothing in `apps/web` names it —
 * both pinned by `packages/db/src/scope.test.ts`. Do not relax either assertion.
 */
export function householdScopeForScript(householdId: number): HouseholdScope {
  return makeHouseholdScope(householdId, 'householdScopeForScript');
}
