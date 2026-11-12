import 'server-only';

import { schema } from '@mat-plan/db';
import { eq } from 'drizzle-orm';
import { cache } from 'react';

import { db } from './db';

/**
 * Catalog lookups for the generalized entry write path (V1-1b). The catalog rows
 * (activity_types / metric_definitions) are stable reference data, so the read
 * helpers are request-`cache()`d (one query per key per request).
 *
 * ✅ **As of PICK-1 PR 2 there is NO write path in this module.** `movements` used to be one — the
 * v0 form submitted a free-text name and `findOrCreateMovementId` found-or-created by slug, the
 * v0→v1 bridge until the picker. The **server half of that picker** is in now, and every way a
 * movement is resolved — by public id, then by typed name — lives in
 * `packages/db/src/writers/movement-catalog.ts`. (No screen sends an id until PR 4.)
 *
 * ## ⚠️ Two of the three unscoped `lib/dal` queries live here
 *
 * `apps/web/lib/dal/scoped.test.ts` (TEN-1 1d) allowlists them **by function** in `ALLOWED_UNSCOPED`,
 * with the reason beside each — that list is the source of truth. Both are **reference reads**:
 *
 * - `getActivityTypeByKey` and `getMetricDefinition` read `activity_types` / `metric_definitions`,
 *   seeded from `packages/shared` (`architecture.md` § 4), shared by every household, with **no
 *   `household_id` column** to scope by. Resolving one reveals nothing about any household.
 *
 * ✅ **`findOrCreateMovementId` was the third; TEN-2b removed it from that list, and PICK-1 PR 2
 * deleted the wrapper itself.** Movement resolution now lives wholly in `packages/db`
 * (`writers/movement-catalog.ts` → `resolveSessionMovements`), which the DAL calls directly, so
 * there is no app-side movement write path left here to scope. The reasoning that was in this
 * wrapper's docblock — global-first and why, and the pre-2b residual closing at `TEN-2c-1` — lives
 * in `findOrCreateMovement`'s own docblock, which is where the behaviour is.
 *
 * `reportScopeMiss`'s existence-only probe (`household.ts`) is the other unscoped query, allowlisted
 * separately by the same test, and `getHouseholdScope` is the scope point itself.
 *
 * A NEW read here that touches household data is a design question, not an edit: put it in a module
 * that resolves `getHouseholdScope()`, or the structural guard fails the build.
 */

/**
 * Resolve an activity_type by its stable key (e.g. 'weigh_in'). Cached.
 *
 * Returns `default_unit` alongside the id because the check-in write path (V1-5) must
 * write the unit that the DB row actually carries — a bare habit has no metric, so its
 * unit comes from here. Resolving only the id and taking the unit from a compiled const
 * would be exactly the shared-const-vs-seeded-DB drift this helper exists to prevent.
 */
export const getActivityTypeByKey = cache(
  async (key: string): Promise<{ id: number; defaultUnit: string | null }> => {
    const [row] = await db
      .select({ id: schema.activityTypes.id, defaultUnit: schema.activityTypes.defaultUnit })
      .from(schema.activityTypes)
      .where(eq(schema.activityTypes.key, key))
      .limit(1);
    if (!row) throw new Error(`activity_type not found for key: ${key}`);
    return row;
  },
);

/** Convenience for the v0 write paths that only need the id. */
export async function getActivityTypeIdByKey(key: string): Promise<number> {
  return (await getActivityTypeByKey(key)).id;
}

/**
 * Resolve a metric_definition by key (the entries.metric_key FK target). Cached.
 *
 * Returns `unit`/`value_type` — not just the key — so the writer stamps the unit from
 * the DB row rather than trusting a compiled const or (worse) the request body.
 */
export const getMetricDefinition = cache(
  async (key: string): Promise<{ key: string; unit: string; valueType: string }> => {
    const [row] = await db
      .select({
        key: schema.metricDefinitions.key,
        unit: schema.metricDefinitions.unit,
        valueType: schema.metricDefinitions.valueType,
      })
      .from(schema.metricDefinitions)
      .where(eq(schema.metricDefinitions.key, key))
      .limit(1);
    if (!row) throw new Error(`metric_definition not found for key: ${key}`);
    return row;
  },
);

/** Confirm a metric_definition exists for `key`. Cached (delegates to the full lookup). */
export async function assertMetricKeyExists(key: string): Promise<string> {
  return (await getMetricDefinition(key)).key;
}
