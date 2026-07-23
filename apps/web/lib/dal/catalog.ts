import 'server-only';

import { schema } from '@mat-plan/db';
import { movementSlug, newId } from '@mat-plan/shared';
import { eq } from 'drizzle-orm';
import { cache } from 'react';

import { db } from './db';

/**
 * Catalog lookups for the generalized entry write path (V1-1b). The catalog rows
 * (activity_types / metric_definitions) are stable reference data, so the read
 * helpers are request-`cache()`d (one query per key per request). `movements` is
 * the one write path here: the v0 strength form submits a free-text movement name,
 * so we FIND-OR-CREATE by slug — the v0→v1 bridge until the movement picker (V1-8).
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
 * Idempotent by `slug` (UNIQUE): INSERT … ON CONFLICT DO NOTHING, then select the
 * id. The slug is derived once via the shared `movementSlug` (the same derivation
 * the V1-1b migration backfill uses), so v0 names converge on the same rows.
 */
export async function findOrCreateMovementId(name: string): Promise<number> {
  const slug = movementSlug(name);
  await db
    .insert(schema.movements)
    .values({ publicId: newId(), slug, name, isBodyweight: false })
    .onConflictDoNothing({ target: schema.movements.slug });

  const [row] = await db
    .select({ id: schema.movements.id })
    .from(schema.movements)
    .where(eq(schema.movements.slug, slug))
    .limit(1);
  if (!row) throw new Error(`movement not found after upsert for slug: ${slug}`);
  return row.id;
}
