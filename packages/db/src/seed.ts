import {
  ACTIVITY_CATEGORY_ROWS,
  CATALOG_ACTIVITY_TYPE_SEED_ROWS,
  CATALOG_METRIC_DEFINITION_SEED_ROWS,
  UNITS,
} from '@mat-plan/shared';
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import * as schema from './schema';

/**
 * Idempotent seed (AGENTS.md: seed reference data ON CONFLICT DO NOTHING; runs
 * twice → identical result). Seeds the `units` + `activity_type_categories`
 * reference tables, the root household, two kid profiles scoped to it (V1-3), and (V1-1b) the
 * three minimal catalog rows the entry write paths reference (weigh_in / sc_lift /
 * bodyweight). Fixed UUIDv7s let re-runs conflict on the natural key / public_id
 * instead of inserting duplicates. The FULL catalog is seeded at V1-2, which
 * reuses these exact keys (ON CONFLICT DO NOTHING → no dup).
 */

// Fixed UUIDv7s for the single-tenant v0/v1 seed rows (stable identity for idempotency).
export const SEED_HOUSEHOLD_PUBLIC_ID = '019826b4-0000-7000-8000-000000000010';
// V1-3: two kid profiles (Liam + Scarlett) under the root household — the picker tiles.
// SEED_PROFILE_PUBLIC_ID keeps the v0 id (was "Athlete One", now Liam) so prod's existing
// row is matched by public_id on re-seed (ON CONFLICT DO NOTHING → prod keeps its name;
// a prod rename is out of scope). SEED_PROFILE_2_PUBLIC_ID (Scarlett) is a new fixed id.
export const SEED_PROFILE_PUBLIC_ID = '019826b4-0000-7000-8000-000000000001';
export const SEED_PROFILE_2_PUBLIC_ID = '019826b4-0000-7000-8000-000000000002';

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

  // V1-3: the two kid profiles the picker tiles render. Both scoped to the root
  // household; idempotent by public_id (a re-seed of prod's existing "Athlete One"
  // row conflicts on SEED_PROFILE_PUBLIC_ID and keeps its name — rename is fresh-DB only).
  await db
    .insert(schema.profiles)
    .values([
      {
        publicId: SEED_PROFILE_PUBLIC_ID,
        name: 'Liam',
        kind: 'kid',
        householdId: household.id,
      },
      {
        publicId: SEED_PROFILE_2_PUBLIC_ID,
        name: 'Scarlett',
        kind: 'kid',
        householdId: household.id,
      },
    ])
    .onConflictDoNothing({ target: schema.profiles.publicId });

  // V1-1b: the three minimal catalog rows the entry backfill + DAL dual-write need.
  // Sourced from @mat-plan/shared (single source; V1-2's full catalog reuses these keys).
  await db
    .insert(schema.activityTypes)
    .values([...CATALOG_ACTIVITY_TYPE_SEED_ROWS])
    .onConflictDoNothing({ target: schema.activityTypes.key });

  await db
    .insert(schema.metricDefinitions)
    .values([...CATALOG_METRIC_DEFINITION_SEED_ROWS])
    .onConflictDoNothing({ target: schema.metricDefinitions.key });
}
