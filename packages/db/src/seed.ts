import {
  ACTIVITY_CATEGORY_ROWS,
  ACTIVITY_TYPE_SEED_ROWS,
  METRIC_DEFINITION_SEED_ROWS,
  MOVEMENT_SEED_ROWS,
  UNITS,
} from '@mat-plan/shared';
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import * as schema from './schema';

/**
 * Idempotent seed (AGENTS.md: seed reference data ON CONFLICT DO NOTHING; runs
 * twice → identical result). Seeds the `units` + `activity_type_categories`
 * reference tables, the root household, one profile scoped to it, and (V1-2) the
 * FULL catalog — `activity_types`, `metric_definitions`, and `movements` — sourced
 * from @mat-plan/shared as the single source of truth. Fixed UUIDv7s let re-runs
 * conflict on the natural key / public_id instead of inserting duplicates. V1-1b's
 * three minimal rows (weigh_in / sc_lift / bodyweight) are SPREAD into these arrays,
 * so they keep one definition and re-seed as a no-op (ON CONFLICT DO NOTHING).
 */

// Fixed UUIDv7s for the single-tenant v0/v1 seed rows (stable identity for idempotency).
export const SEED_HOUSEHOLD_PUBLIC_ID = '019826b4-0000-7000-8000-000000000010';
export const SEED_PROFILE_PUBLIC_ID = '019826b4-0000-7000-8000-000000000001';

export async function seed(db: NodePgDatabase<typeof schema>): Promise<void> {
  await db.insert(schema.units).values(UNITS).onConflictDoNothing({ target: schema.units.code });

  await db
    .insert(schema.activityTypeCategories)
    .values(ACTIVITY_CATEGORY_ROWS)
    .onConflictDoNothing({ target: schema.activityTypeCategories.code });

  await db
    .insert(schema.households)
    .values({ publicId: SEED_HOUSEHOLD_PUBLIC_ID, name: 'Home' })
    .onConflictDoNothing({ target: schema.households.publicId });

  // Resolve the root household id to scope the seed profile (household_id is enforced
  // NOT NULL by the migration's CHECK, so the profile must carry it).
  const [household] = await db
    .select({ id: schema.households.id })
    .from(schema.households)
    .where(eq(schema.households.publicId, SEED_HOUSEHOLD_PUBLIC_ID));

  await db
    .insert(schema.profiles)
    .values({
      publicId: SEED_PROFILE_PUBLIC_ID,
      name: 'Athlete One',
      kind: 'kid',
      householdId: household.id,
    })
    .onConflictDoNothing({ target: schema.profiles.publicId });

  // V1-2: the FULL catalog (activity_types + metric_definitions + movements), sourced from
  // @mat-plan/shared (single source of truth). ON CONFLICT on each natural key → idempotent,
  // and a safe no-op for V1-1b's 3 reused rows (weigh_in / sc_lift / bodyweight). Runs after
  // the FK parents (units + activity_type_categories) so category/unit references resolve.
  await db
    .insert(schema.activityTypes)
    .values([...ACTIVITY_TYPE_SEED_ROWS])
    .onConflictDoNothing({ target: schema.activityTypes.key });

  await db
    .insert(schema.metricDefinitions)
    .values([...METRIC_DEFINITION_SEED_ROWS])
    .onConflictDoNothing({ target: schema.metricDefinitions.key });

  await db
    .insert(schema.movements)
    .values([...MOVEMENT_SEED_ROWS])
    .onConflictDoNothing({ target: schema.movements.slug });
}
