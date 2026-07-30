import {
  ACTIVITY_CATEGORY_ROWS,
  ACTIVITY_TYPE_SEED_ROWS,
  CALISTHENICS_METRIC_KEYS,
  CALISTHENICS_RAMP_SCHEDULE,
  METRIC_DEFINITION_SEED_ROWS,
  MOVEMENT_SEED_ROWS,
  newId,
  PROFILE_KIND,
  PROGRAM_SEED,
  type ProgramBlockSeedRow,
  type RoutineConfig,
  SEED_HOUSEHOLD_PUBLIC_ID,
  SEED_PROFILE_2_PUBLIC_ID,
  SEED_PROFILE_PUBLIC_ID,
  UNITS,
} from '@mat-plan/shared';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import * as schema from './schema';

/**
 * V1-18: Scarlett's EXPLICIT routine (rice bucket before strength, a metric habit, wake) so a fresh DB
 * demonstrates A≠B vs Liam (NULL → the default routine). Exported so an app-side test can bind these keys
 * to the REAL catalog (`CHECKIN_FIELDS`/`LIFE_ACTIVITY_KEYS`, which live app-side) — a stale seed key would
 * be silently dropped on render, so the test asserts every key resolves. The keys are grammar-valid
 * (`db:verify` parses them); `conditional` is the opaque V1-10 marker. Only differentiates on an EMPTY
 * target (fresh PGlite / Docker PG) — a prod re-seed no-ops via onConflictDoNothing.
 */
export const SEED_SCARLETT_ROUTINE = {
  version: 1,
  order: [
    // Check-ins FIRST (before strength) — a genuine reorder vs Liam's default — and CONTIGUOUS (rice bucket
    // + the push-up count in ONE block), so the check-in-logging e2e has a single, full surface. Then
    // strength (cosmetic `conditional` marker), then a life SUBSET (wake only, not wrestling). Demonstrates
    // A≠B via order + selection without splitting the check-in form.
    { key: 'checkin:rice_bucket' },
    { key: 'checkin:calisthenics:pushups' },
    { key: 'strength', conditional: true },
    { key: 'life:wake' },
  ],
} as const satisfies RoutineConfig;

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

// The fixed seed public_ids now live in `@mat-plan/shared` (packages/shared/src/seed-ids.ts) so the app-side
// PROGRAM_SEED can reference the same household + kids; re-exported here so existing importers (db:verify,
// tests) keep resolving them from '../src/seed'.
export {
  SEED_HOUSEHOLD_PUBLIC_ID,
  SEED_PROFILE_PUBLIC_ID,
  SEED_PROFILE_2_PUBLIC_ID,
} from '@mat-plan/shared';

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
        routineConfig: SEED_SCARLETT_ROUTINE,
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

  // V1-10: the programming blocks + prescriptions + per-kid load targets. Ships EMPTY today (PROGRAM_SEED =
  // []); the loop below is a no-op until Ray's real block lands in a data-only PR (the LLM never authors loads).
  await seedProgram(db, PROGRAM_SEED);
}

/**
 * Expand a program seed (V1-10) into `program_blocks` → `prescriptions` → `prescription_targets`, idempotent
 * by each table's partial-unique natural key. Row-by-row (config data, few rows): resolve each FK by its
 * natural key (household + block by public_id/slug, movement by `movements.slug`, profile by public_id) with
 * the existing `select({id}).where(eq(...))` idiom, insert with `onConflictDoNothing` whose arbiter REPEATS
 * the partial index's `WHERE deleted_at IS NULL` (the V1-5 lesson), then re-resolve the id so children attach
 * whether the parent was just inserted or already existed. Re-seed is INSERT-ONLY (a moved/replaced slot is a
 * future authoring path, not re-seed). An empty seed makes every loop a no-op.
 * Every referenced id is resolved among LIVE rows (`isNull(deleted_at)`) and an unresolved ref THROWS —
 * a misspelled movement slug / household / profile public_id in a future data-only PR fails the seed LOUDLY
 * (caught by CI's `db:seed`/`db:verify`) instead of silently dropping a prescription or an entire block. Refs
 * are resolved BEFORE the block insert, so a typo throws with nothing written. Each block resolves its
 * movements + profiles ONCE (one `inArray` query each, not an N+1 per prescription/target). Exported so
 * `db:verify` drives a non-empty fixture through the REAL resolver, not just the DDL.
 * INVARIANT (caller's responsibility, mirroring the supersets writer): a target's profile belongs to the
 * block's household — the seed authors profiles within the block's household; the slice-2 DAL scopes reads by
 * that household join (BOLA).
 */
export async function seedProgram(
  db: NodePgDatabase<typeof schema>,
  blocks: readonly ProgramBlockSeedRow[],
): Promise<void> {
  for (const block of blocks) {
    const [household] = await db
      .select({ id: schema.households.id })
      .from(schema.households)
      .where(
        and(
          eq(schema.households.publicId, block.householdPublicId),
          isNull(schema.households.deletedAt),
        ),
      );
    if (!household) {
      throw new Error(
        `seedProgram: unknown household "${block.householdPublicId}" for block "${block.slug}"`,
      );
    }

    // Resolve every referenced movement + profile ONCE for the block (one query each, no N+1), among LIVE
    // rows; a ref that doesn't resolve is an authoring typo → throw (before any write) rather than skip.
    const movementSlugs = [...new Set(block.prescriptions.map((p) => p.movementSlug))];
    const movementRows = movementSlugs.length
      ? await db
          .select({ id: schema.movements.id, slug: schema.movements.slug })
          .from(schema.movements)
          .where(inArray(schema.movements.slug, movementSlugs))
      : [];
    const movementIdBySlug = new Map(movementRows.map((m) => [m.slug, m.id]));
    for (const slug of movementSlugs) {
      if (!movementIdBySlug.has(slug)) {
        throw new Error(`seedProgram: unknown movement slug "${slug}" in block "${block.slug}"`);
      }
    }

    const profilePublicIds = [
      ...new Set(block.prescriptions.flatMap((p) => p.targets.map((t) => t.profilePublicId))),
    ];
    const profileRows = profilePublicIds.length
      ? await db
          .select({ id: schema.profiles.id, publicId: schema.profiles.publicId })
          .from(schema.profiles)
          .where(
            and(
              inArray(schema.profiles.publicId, profilePublicIds),
              isNull(schema.profiles.deletedAt),
            ),
          )
      : [];
    const profileIdByPublicId = new Map(profileRows.map((p) => [p.publicId, p.id]));
    for (const publicId of profilePublicIds) {
      if (!profileIdByPublicId.has(publicId)) {
        throw new Error(`seedProgram: unknown profile "${publicId}" in block "${block.slug}"`);
      }
    }

    await db
      .insert(schema.programBlocks)
      .values({
        publicId: newId(),
        householdId: household.id,
        slug: block.slug,
        name: block.name,
        notes: block.notes,
      })
      .onConflictDoNothing({
        target: [schema.programBlocks.householdId, schema.programBlocks.slug],
        where: isNull(schema.programBlocks.deletedAt),
      });
    // Re-resolve the block id (just-inserted OR pre-existing) by its natural key.
    const [blockRow] = await db
      .select({ id: schema.programBlocks.id })
      .from(schema.programBlocks)
      .where(
        and(
          eq(schema.programBlocks.householdId, household.id),
          eq(schema.programBlocks.slug, block.slug),
          isNull(schema.programBlocks.deletedAt),
        ),
      );
    if (!blockRow)
      throw new Error(`seedProgram: block "${block.slug}" failed to resolve after upsert`);

    for (const p of block.prescriptions) {
      await db
        .insert(schema.prescriptions)
        .values({
          publicId: newId(),
          blockId: blockRow.id,
          dayRole: p.dayRole,
          movementId: movementIdBySlug.get(p.movementSlug)!,
          idx: p.idx,
          sets: p.sets,
          targetReps: p.targetReps,
        })
        .onConflictDoNothing({
          target: [
            schema.prescriptions.blockId,
            schema.prescriptions.dayRole,
            schema.prescriptions.idx,
          ],
          where: isNull(schema.prescriptions.deletedAt),
        });
      const [presRow] = await db
        .select({ id: schema.prescriptions.id })
        .from(schema.prescriptions)
        .where(
          and(
            eq(schema.prescriptions.blockId, blockRow.id),
            eq(schema.prescriptions.dayRole, p.dayRole),
            eq(schema.prescriptions.idx, p.idx),
            isNull(schema.prescriptions.deletedAt),
          ),
        );
      if (!presRow) {
        throw new Error(
          `seedProgram: prescription (block "${block.slug}", ${p.dayRole}#${p.idx}) failed to resolve after upsert`,
        );
      }

      for (const target of p.targets) {
        await db
          .insert(schema.prescriptionTargets)
          .values({
            publicId: newId(),
            prescriptionId: presRow.id,
            profileId: profileIdByPublicId.get(target.profilePublicId)!,
            load: target.load,
            reps: target.reps ?? null, // per-kid reps override (null → the prescription's shared target_reps)
          })
          .onConflictDoNothing({
            target: [
              schema.prescriptionTargets.prescriptionId,
              schema.prescriptionTargets.profileId,
            ],
            where: isNull(schema.prescriptionTargets.deletedAt),
          });
      }
    }
  }
}
