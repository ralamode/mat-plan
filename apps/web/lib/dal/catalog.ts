import 'server-only';

import { findOrCreateMovement, schema } from '@mat-plan/db';
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
 * ## ⚠️ Three of the five `lib/dal` functions that reach `db` with NO household scope live here
 *
 * `apps/web/lib/dal/scoped.test.ts` (TEN-1 1d) allowlists them **by function**, with the reason
 * beside each — the other two are in `household.ts` (`getHouseholdScope`, which *is* the scope
 * point, and `reportScopeMiss`'s existence-only probe). These three are **global reference data by
 * design**, not sites TEN-1 forgot:
 *
 * - `activity_types`, `metric_definitions` and `units` are seeded from `packages/shared`
 *   (`architecture.md` § 4), shared by every household, and carry **no `household_id` column** to
 *   scope by. Resolving a unit or a metric definition reveals nothing about any household.
 * - `movements` carries none either, and that one is **not benign** — see `findOrCreateMovementId`
 *   below. It is the one residual TEN-1 proves rather than closes, and **TEN-2** is its fix.
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
 * ⚠️ **The one write reachable from this app that is NOT household-scoped, and it cannot be here.**
 * The core is `findOrCreateMovement` in `packages/db/src/writers/movement-catalog.ts`, single-sourced
 * per `write-path.md` invariant 3 so `db:verify` runs **this** function rather than a re-typed
 * lookalike — which is the only way the cross-household behaviour could be *proved* rather than
 * asserted. Read that docblock before changing anything here: `movements` has **no `household_id`
 * column at all**, so another household's free-text name binds to the row this one created, and
 * whichever household types a name first pins that slug's metadata permanently.
 *
 * TEN-1 1d records the verdict and its evidence; **TEN-2** is the fix.
 */
export async function findOrCreateMovementId(name: string): Promise<number> {
  return findOrCreateMovement(db, name);
}
