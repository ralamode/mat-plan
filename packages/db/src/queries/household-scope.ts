import { isNull } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { schema } from '../client';

/**
 * How many live households this database contains, up to two — **the pre-AUTH-1 scope resolution,
 * single-sourced** (TEN-1 1b) so `apps/web/lib/dal/household.ts` and `db:verify` run the IDENTICAL
 * query. The `weeklyAdherenceRows` / `householdProfileRows` precedent.
 *
 * ⚠️ **`LIMIT 2` is an AMBIGUITY PROBE, not a pick.** Exactly one row → that household's scope.
 * Zero → the app is dark (an empty database). Two → `getHouseholdScope()` **throws**: the server
 * cannot tell whose data it holds, and *"just use the first one"* is a silent cross-wire between two
 * families. There is deliberately **no `ORDER BY`** — there is no correct ordering, because there is
 * no correct answer.
 *
 * **`deleted_at IS NULL` is the load-bearing conjunct**, and the reason this is worth extracting:
 * a soft-deleted household must stop resolving, so its profiles become unreachable even though
 * `profiles.household_id` still points at it. That is a statement about rows, which only a real
 * database can prove — and only if the proof runs this function rather than a re-typed lookalike.
 *
 * ⚠️ **This module predicted its own retirement and it did NOT happen.** `AUTH-1` 1c-4 replaced
 * `getHouseholdScope()`'s body with session → `household_members`, so this query stopped being the
 * resolution — but it did not go with it. Two callers keep it: `db:verify`'s own soft-delete proofs,
 * and `screenshot-ephemeral.ts`'s fixture scope, which must derive a household without naming an id.
 * ⚠️ **It is no longer a request-path query**, so do not cite it as what the app resolves through.
 */
export function liveHouseholdIds(db: NodePgDatabase<typeof schema>) {
  return db
    .select({ id: schema.households.id })
    .from(schema.households)
    .where(isNull(schema.households.deletedAt))
    .limit(2);
}
