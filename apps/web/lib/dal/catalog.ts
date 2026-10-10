import 'server-only';

import { type HouseholdScope, findOrCreateMovement, schema } from '@mat-plan/db';
import { eq } from 'drizzle-orm';
import { cache } from 'react';

import { db } from './db';

/**
 * Catalog lookups for the generalized entry write path (V1-1b). The catalog rows
 * (activity_types / metric_definitions) are stable reference data, so the read
 * helpers are request-`cache()`d (one query per key per request). `movements` is
 * the one write path here: the v0 strength form submits a free-text movement name,
 * so we FIND-OR-CREATE by slug — the v0→v1 bridge until the movement picker (V1-8).
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
 * ✅ **`findOrCreateMovementId` was the third, and TEN-2b removed it from that list** — it takes a
 * `HouseholdScope` now, so `scoped.test.ts`'s dead-entry assertion forced the entry out rather than
 * letting it stand as coverage nobody re-earned. Its remaining residual is not a scoping gap but the
 * TEN-2b→2c window; see its docblock below.
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

/**
 * Find-or-create a movement from a free-text name and return its internal id.
 *
 * ✅ **Household-scoped as of TEN-2b** — it takes a `HouseholdScope` and resolves **GLOBAL-FIRST**:
 * the curated namespace (`household_id IS NULL`), then this household's own, then an insert into this
 * household's own. The core is `findOrCreateMovement` in
 * `packages/db/src/writers/movement-catalog.ts`, single-sourced per `write-path.md` invariant 3 so
 * `db:verify` runs **this** function rather than a re-typed lookalike — the only way the
 * cross-household behaviour could be *proved* rather than asserted. **Read that docblock before
 * changing anything here**: it holds the resolution order, why it is not household-first, and the
 * one residual below.
 *
 * ⚠️ **One leak survives to TEN-2c, deliberately.** While the non-partial `movements_slug_unique`
 * lives, two households cannot both hold a row for one slug, so the core's `23505` fallback hands the
 * second household the first's row — the pre-existing read leak, kept in preference to a permanent
 * write failure, and it leaves a cross-household `entries.movement_id` that blocks household deletion
 * (`docs/runbooks.md` step 11). TEN-1 1d records the verdict; **TEN-2c** closes it.
 */
export async function findOrCreateMovementId(scope: HouseholdScope, name: string): Promise<number> {
  return findOrCreateMovement(db, scope, name);
}
