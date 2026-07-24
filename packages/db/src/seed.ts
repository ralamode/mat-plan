import {
  ACTIVITY_CATEGORY_ROWS,
  ACTIVITY_TYPE_SEED_ROWS,
  CALISTHENICS_METRIC_KEYS,
  CALISTHENICS_RAMP_SCHEDULE,
  METRIC_DEFINITION_SEED_ROWS,
  MOVEMENT_SEED_ROWS,
  newId,
  PROFILE_KIND,
  UNITS,
} from '@mat-plan/shared';
import { eq, isNull } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import * as schema from './schema';

/**
 * Idempotent seed (AGENTS.md: seed reference data ON CONFLICT DO NOTHING; runs
 * twice → identical result). Seeds the `units` + `activity_type_categories`
 * reference tables, the root household, two kid profiles scoped to it (V1-3: Liam +
 * Scarlett), and (V1-2) the FULL catalog — `activity_types`, `metric_definitions`, and
 * `movements` — sourced from @mat-plan/shared as the single source of truth. Fixed
 * UUIDv7s let re-runs conflict on the natural key / public_id instead of inserting
 * duplicates. V1-1b's three minimal rows (weigh_in / sc_lift / bodyweight) are SPREAD
 * into these arrays, so they keep one definition and re-seed as a no-op (ON CONFLICT
 * DO NOTHING).
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

  // V1-6b-1: expand the calisthenics ramp schedule into `ramp_targets` rows —
  // CALISTHENICS_RAMP_SCHEDULE × KID profiles × the calisthenics metric keys. The schedule
  // ships EMPTY (see ramp-schedule.ts), so this seeds ZERO rows today; the mechanism is present
  // and correct for the later data-only follow-up that fills the schedule. Config data is
  // per-KID, so profiles are filtered to `kind='kid'` (never all profiles). Idempotency is the
  // partial natural-key UNIQUE — the ON CONFLICT arbiter repeats its `WHERE deleted_at IS NULL`
  // predicate (the V1-5 partial-index lesson) so a re-seed with real numbers can't duplicate.
  const kidProfiles = await db
    .select({ id: schema.profiles.id })
    .from(schema.profiles)
    .where(eq(schema.profiles.kind, PROFILE_KIND.kid));

  const rampTargetRows = kidProfiles.flatMap((p) =>
    CALISTHENICS_RAMP_SCHEDULE.flatMap((week) =>
      CALISTHENICS_METRIC_KEYS.map((metricKey) => ({
        publicId: newId(),
        profileId: p.id,
        metricKey,
        weekStart: week.weekStart,
        targetValue: String(week.targets[metricKey]), // numeric column takes a string (precision-safe)
      })),
    ),
  );

  // Drizzle rejects an empty VALUES list; skip the insert entirely under the empty schedule.
  if (rampTargetRows.length > 0) {
    await db
      .insert(schema.rampTargets)
      .values(rampTargetRows)
      .onConflictDoNothing({
        target: [
          schema.rampTargets.profileId,
          schema.rampTargets.metricKey,
          schema.rampTargets.weekStart,
        ],
        where: isNull(schema.rampTargets.deletedAt),
      });
  }
}
