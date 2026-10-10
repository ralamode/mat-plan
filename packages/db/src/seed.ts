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
  QUANTITY_SLOT_ROWS,
  type ProgramBlockSeedRow,
  type RoutineConfig,
  SEED_HOUSEHOLD_PUBLIC_ID,
  SEED_PROFILE_2_NAME,
  SEED_PROFILE_2_PUBLIC_ID,
  SEED_PROFILE_NAME,
  SEED_PROFILE_PUBLIC_ID,
  UNITS,
} from '@mat-plan/shared';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import * as schema from './schema';
import { householdScopeForScript } from './writers/household-scope-script';
import { inHousehold, movementIsGlobal, movementIsOwned } from './writers/ownership';

/**
 * V1-18: Athlete Two's EXPLICIT routine (rice bucket before strength, a metric habit, wake) so a fresh DB
 * demonstrates A≠B vs Athlete One (whose own routine is `SEED_FULL_ROUTINE` since ONB-0 — it was NULL, i.e. the
 * old whole-catalog default). Exported so an app-side test can bind these keys
 * to the REAL catalog (`CHECKIN_FIELDS`/`LIFE_ACTIVITY_KEYS`, which live app-side) — a stale seed key would
 * be silently dropped on render, so the test asserts every key resolves. The keys are grammar-valid
 * (`db:verify` parses them); `conditional` is the opaque V1-10 marker. Only differentiates on an EMPTY
 * target (fresh PGlite / Docker PG) — a prod re-seed no-ops via onConflictDoNothing.
 */
/**
 * The PRE-ONB-0 default routine, written out explicitly — the full `ROUTINE_CATALOG` order
 * (strength → check-ins → life).
 *
 * ONB-0 narrowed what a NULL `routine_config` falls back to, from the whole catalog down to
 * `['strength']`, so that a brand-new household no longer inherits this household's ~17 controls. Profile
 * 1 was NULL and therefore rode that fallback, which means two things it is this literal's job to fix:
 *
 *  1. **Fixtures.** `e2e/global.setup.ts` warms the check-ins path by submitting `Splits` on profile 1,
 *     and the V0-11 smoke drives `Rice bucket` + `Pressure` (a `brush_teeth` metric) there. Under the
 *     neutral fallback those controls stop rendering and the setup project fails, taking the whole suite
 *     with it. Writing the routine explicitly keeps every existing spec green with no spec edits.
 *  2. **The live household.** A seed cannot fix the row that already exists (`onConflictDoNothing` below),
 *     so the matching correction `null-routine-to-full-2026-10-07` writes this same config to any live
 *     profile whose `routine_config` is NULL. Run it BEFORE the deploy: it writes what the app renders
 *     today, so it is a no-op from the household's point of view.
 *
 * ⚠️ Hand-authored because `packages/db` cannot import the app-side `ROUTINE_CATALOG` (it is derived from
 * `CHECKIN_FIELDS`/`LIFE_ACTIVITIES`, which are React-adjacent). `apps/web/lib/routine/catalog.test.ts`
 * asserts this list EQUALS `ROUTINE_CATALOG` exactly, so the two cannot drift.
 */
export const SEED_FULL_ROUTINE = {
  version: 1,
  order: [
    { key: 'strength' },
    { key: 'checkin:rice_bucket' },
    { key: 'checkin:brain_rep' },
    { key: 'checkin:splits' },
    { key: 'checkin:brush_teeth:stance' },
    { key: 'checkin:brush_teeth:ladder' },
    { key: 'checkin:brush_teeth:bridge' },
    { key: 'checkin:brush_teeth:mobility' },
    { key: 'checkin:brush_teeth:pressure' },
    { key: 'checkin:brush_teeth:reaction' },
    { key: 'checkin:brush_teeth:shot' },
    { key: 'checkin:calisthenics:pushups' },
    { key: 'checkin:calisthenics:pullups' },
    { key: 'checkin:calisthenics:vsit_crunch' },
    { key: 'checkin:calisthenics:vsit_skill_step' },
    { key: 'life:wake' },
    { key: 'life:wrestling_practice' },
  ],
} as const satisfies RoutineConfig;

export const SEED_ATHLETE_TWO_ROUTINE = {
  version: 1,
  order: [
    // Check-ins FIRST (before strength) — a genuine reorder vs Athlete One's default — and CONTIGUOUS (rice bucket
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
 * reference tables, the root household, two kid profiles scoped to it (V1-3: Athlete One +
 * Athlete Two), and (V1-2) the FULL catalog — `activity_types`, `metric_definitions`, and
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
  SEED_PROFILE_NAME,
  SEED_PROFILE_2_NAME,
} from '@mat-plan/shared';

export async function seed(db: NodePgDatabase<typeof schema>): Promise<void> {
  // GAP-3: onConflictDoUPDATE, not DoNothing. The 7 pre-GAP-3 rows already exist in every deployed DB,
  // so DoNothing would leave them with whatever `dimension` the migration backfilled and never reconcile
  // them with the shared const again — a reference table that silently stops being a mirror of its source.
  // The migration backfills once; this keeps the seed authoritative on every subsequent run.
  await db
    .insert(schema.units)
    .values(UNITS)
    .onConflictDoUpdate({
      target: schema.units.code,
      set: { label: sql`excluded.label`, dimension: sql`excluded.dimension` },
    });

  // GAP-3: onConflictDoNOTHING here, deliberately NOT the DoUpdate above. `quantity_slots` is the
  // parent of a composite FK with no ON UPDATE CASCADE, so once any `entry_set_quantities` row exists,
  // an UPDATE of a slot's dimension is REJECTED by the FK — and `db:seed` runs on every push to main
  // (.github/workflows/migrate.yml), so a DoUpdate would turn the PROD migrate job red, not just a PR.
  // The PK is the (code, dimension) pair, so adding a slot or a new dimension for one still inserts
  // cleanly; only REMOVING a pair needs an expand→contract, which is the correct amount of friction.
  await db
    .insert(schema.quantitySlots)
    .values(QUANTITY_SLOT_ROWS)
    .onConflictDoNothing({ target: [schema.quantitySlots.code, schema.quantitySlots.dimension] });

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
  // household; idempotent by public_id. ⚠️ `onConflictDoNothing` means a re-seed CANNOT rename a row
  // that already exists: a live household keeps whatever names it entered, which is its own data and
  // not this seed's business (OSS-1 scrubbed the REPO, never the database). So these role names are a
  // FRESH-DB fixture only — what a reviewer sees in a preview, a screenshot or `db:verify`.
  await db
    .insert(schema.profiles)
    .values([
      {
        publicId: SEED_PROFILE_PUBLIC_ID,
        name: SEED_PROFILE_NAME,
        kind: 'kid',
        householdId: household.id,
        // ONB-0: EXPLICIT, where this row used to be NULL. NULL now means "the neutral first-run
        // routine" (`['strength']`), and the check-in specs drive habits + a brush-teeth metric here.
        routineConfig: SEED_FULL_ROUTINE,
      },
      {
        publicId: SEED_PROFILE_2_PUBLIC_ID,
        name: SEED_PROFILE_2_NAME,
        kind: 'kid',
        householdId: household.id,
        routineConfig: SEED_ATHLETE_TWO_ROUTINE,
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

  // ── TEN-2b: the SHADOW GUARD, and why it is the only detector of a silent failure ───────────────
  //
  // The arbiter below moved onto the partial `uq_movements_slug_global` (predicate repeated
  // literally, per the V1-5 lesson; `where:` not `targetWhere:`, which onConflictDoNothing silently
  // drops). But Postgres infers BOTH arbiters for `(slug)`: the non-partial `movements_slug_unique`
  // has an empty predicate, trivially implied by `WHERE household_id IS NULL`. So if a household
  // already owns a slug this seed is about to add globally, `DO NOTHING` absorbs the GLOBAL-unique
  // collision too and the catalog row is NEVER INSERTED — measured. `db:seed` reports success,
  // seed-twice idempotency stays green, and every household then resolves that slug through
  // `findOrCreateMovement`'s cross-household fallback. **The failure is silence, not a duplicate**,
  // which is why this guard exists and why nothing else would ever report it.
  //
  // REFUSE, never adopt: adopting would promote one household's free text into the global reference
  // namespace — the defect `ON DELETE SET NULL` is forbidden for (schema.ts → `movements`).
  //
  // ⚠️ NON-WEDGING ON PURPOSE. `migrate.yml` runs `db:migrate` then `db:seed` against PRODUCTION in
  // one job on every push to `main`, and this function is NOT transactional. So: detect BEFORE any
  // movement write, omit only the shadowed rows, let everything after this point seed normally, and
  // throw at the END (see the foot of this function). One colliding slug must not stop unrelated
  // reference data from reaching prod. Recovery: `docs/runbooks.md` → "the seed's shadow guard fired".
  //
  // ⚠️ The message names SEED SLUGS ONLY — a public const. Never the colliding row's `name`, which is
  // uncontrolled household free text, because this lands in a world-readable Actions log.
  const seedMovementSlugs = MOVEMENT_SEED_ROWS.map((m) => m.slug);
  const shadowedSlugs = (
    await db
      .select({ slug: schema.movements.slug })
      .from(schema.movements)
      .where(and(inArray(schema.movements.slug, seedMovementSlugs), movementIsOwned()))
  )
    .map((r) => r.slug)
    .sort();

  const seedableMovements = MOVEMENT_SEED_ROWS.filter((m) => !shadowedSlugs.includes(m.slug));
  // Drizzle rejects an empty VALUES list (the `ramp_targets` precedent below).
  if (seedableMovements.length > 0) {
    await db
      .insert(schema.movements)
      .values(seedableMovements)
      .onConflictDoNothing({ target: schema.movements.slug, where: movementIsGlobal() });
  }

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

  // TEN-2b: the shadow guard's refusal, LAST — everything above has seeded, so one colliding slug
  // costs the catalog row it names and nothing else. Seed slugs only (a public const); never the
  // colliding row's `name`. Recovery: `docs/runbooks.md` → "the seed's shadow guard fired".
  if (shadowedSlugs.length > 0) {
    throw new Error(
      `seed: ${shadowedSlugs.length} seeded movement slug(s) are already owned by a household, so ` +
        `the global catalog row(s) were NOT inserted: ${shadowedSlugs.join(', ')}. ` +
        'Adopting them would promote household free text into the global reference namespace. ' +
        'See docs/runbooks.md → "the seed\'s shadow guard fired".',
    );
  }
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
 *
 * **TEN-1 1c turns that invariant into a WHERE clause.** The profile resolution below already ran inside
 * the block's household by construction, so this is symmetry rather than a fix — but it is the last
 * hand-written copy of the live-profile predicate in `packages/db/src`, and leaving one behind is what
 * would force 1d's structural guard to ship with an allowlist. A target naming a profile in **another**
 * household now throws `unknown profile` with nothing written, instead of silently seeding a
 * cross-household `prescription_targets` row that `programDayRows` would then have to refuse.
 *
 * The scope comes from `householdScopeForScript`, named for what it is: the seed has **no request** to
 * derive one from, exactly like `db:verify` and `db:correct`. It is reached by relative path from inside
 * `packages/db` — `src/index.ts` never re-exports it, so `apps/web` cannot name it at all
 * (`packages/db/src/scope.test.ts` pins both halves).
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
    // TEN-2b: resolve in the GLOBAL namespace only (`household_id IS NULL`). One line, and it kills
    // the last-row-wins hazard STRUCTURALLY rather than by preference: the global namespace is unique
    // by slug (`uq_movements_slug_global`), so the map below can no longer be overwritten by a
    // household's own row, and a prescription can no longer silently attach to another household's
    // movement. A slug that exists ONLY in some household's namespace now falls through to the
    // unknown-slug throw below — correct and loud: `seedProgram` seeds `PROGRAM_SEED`, whose slugs
    // are all catalog slugs, and there is no authoring path that puts a household row here.
    const movementRows = movementSlugs.length
      ? await db
          .select({ id: schema.movements.id, slug: schema.movements.slug })
          .from(schema.movements)
          .where(and(inArray(schema.movements.slug, movementSlugs), movementIsGlobal()))
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
    // The plural variant of the live-profile predicate: `inArray` where `isLiveProfile` has `eq`, so it
    // cannot use the helper directly — but the household conjunct is the SAME single-sourced
    // `inHousehold`, which is the one function in the repo allowed to unwrap the scope (ADR 0006 fwd-1).
    const blockScope = householdScopeForScript(household.id);
    const profileRows = profilePublicIds.length
      ? await db
          .select({ id: schema.profiles.id, publicId: schema.profiles.publicId })
          .from(schema.profiles)
          .where(
            and(
              inArray(schema.profiles.publicId, profilePublicIds),
              isNull(schema.profiles.deletedAt),
              inHousehold(blockScope),
            ),
          )
      : [];
    const profileIdByPublicId = new Map(profileRows.map((p) => [p.publicId, p.id]));
    for (const publicId of profilePublicIds) {
      if (!profileIdByPublicId.has(publicId)) {
        throw new Error(
          `seedProgram: unknown profile "${publicId}" in block "${block.slug}" ` +
            `(not live, or not in household "${block.householdPublicId}")`,
        );
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
