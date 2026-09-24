import { type DayRole } from '@mat-plan/shared';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { schema } from '../client';

/**
 * The programmed movements for ONE kid on ONE `day_role` (V1-10 slice 2), single-sourced here so the app
 * read DAL and the `db:verify` proof run the IDENTICAL SQL (the `weeklyAdherenceRows` precedent — the proof
 * would otherwise cover a different join shape than the DAL ships). `db` is typed like the seed's
 * (`NodePgDatabase<schema>`); the PGlite verify harness passes its cast db.
 *
 * OWNERSHIP (BOLA): the household is resolved INSIDE this query via `profiles.public_id → household_id →
 * program_blocks.household_id` — the caller never supplies (and `ProfileDTO` never exposes) a household id,
 * so a kid can only ever see their OWN household's block. A profile with a NULL `household_id` matches no
 * block → zero rows.
 *
 * Shape notes:
 * - **Deterministic single block, chosen among the blocks that actually PROGRAM this day.** A household
 *   accumulates blocks (a new mesocycle gets a new `slug` — `uq_program_blocks_household_slug` encourages
 *   that over editing in place), and a bare join would fan the day out across all of them. So the block
 *   subquery takes the newest — but only from blocks holding a live prescription for the REQUESTED
 *   `day_role`. Ordering by `id DESC` alone would be a silent blanking bug: seed a new block that programs
 *   `strength`/`conditioning`, and Monday's `strength_a` card goes empty with no error and no fallback to
 *   the block that does have the data. Restricting the candidate set makes "newest wins" degrade to "the
 *   newest block that can answer this question". (An explicit active-block marker is the real fix when
 *   multi-block authoring lands; this keeps the MVP's "the household's one block" honest until then.)
 * - **LEFT JOIN `prescription_targets`**, scoped in the `ON` to `(this prescription, THIS profile)`. In the
 *   `WHERE` it would silently inner-join (a kid with no target vanishes) or, worse, match the sibling's row.
 *   No target → `load`/`reps` come back NULL and the caller renders the shared prescription.
 * - Ordered by `idx` — the coach's authored order within the day.
 */
export function programDayRows(
  db: NodePgDatabase<typeof schema>,
  args: { profilePublicId: string; dayRole: DayRole },
) {
  // THE ownership predicate — "the live profile this request is for". Named once and used by BOTH
  // sub-selects below (the household hop and the per-kid target scope) so the two can never drift into
  // scoping by different rules — which is exactly how a BOLA hole gets introduced by a later edit.
  const isThisProfile = and(
    eq(schema.profiles.publicId, args.profilePublicId),
    isNull(schema.profiles.deletedAt),
  );

  // The newest of the profile's own household's live blocks THAT PROGRAMS THIS DAY — see the shape note.
  // A scalar subquery (not a join) so the LIMIT 1 picks a BLOCK, not one of the prescription rows we want
  // all of; the inner join to `prescriptions` only narrows the candidate blocks.
  const blockId = db
    .select({ id: schema.programBlocks.id })
    .from(schema.programBlocks)
    .innerJoin(schema.profiles, eq(schema.profiles.householdId, schema.programBlocks.householdId))
    .innerJoin(
      schema.prescriptions,
      and(
        eq(schema.prescriptions.blockId, schema.programBlocks.id),
        eq(schema.prescriptions.dayRole, args.dayRole),
        isNull(schema.prescriptions.deletedAt),
      ),
    )
    .where(and(isThisProfile, isNull(schema.programBlocks.deletedAt)))
    .orderBy(desc(schema.programBlocks.id))
    .limit(1);

  // This request's profile id — the scalar the per-kid target join scopes to, built from the SAME
  // `isThisProfile` predicate as the household hop.
  const profileId = db
    .select({ id: schema.profiles.id })
    .from(schema.profiles)
    .where(isThisProfile);

  return (
    db
      .select({
        idx: schema.prescriptions.idx,
        movementName: schema.movements.name,
        // V1-13b: the CSV export keys `prescribed` back to a logged movement, and its grouping key is
        // the SLUG (`movements.name` is a display string — "Front Squat" — and would never match).
        // Selected here rather than converted at the call site so both sides read one column.
        movementSlug: schema.movements.slug,
        sets: schema.prescriptions.sets,
        targetReps: schema.prescriptions.targetReps,
        load: schema.prescriptionTargets.load,
        reps: schema.prescriptionTargets.reps,
      })
      .from(schema.prescriptions)
      .innerJoin(schema.movements, eq(schema.prescriptions.movementId, schema.movements.id))
      // Scoped to THIS profile in the ON — see the LEFT JOIN note above.
      .leftJoin(
        schema.prescriptionTargets,
        and(
          eq(schema.prescriptionTargets.prescriptionId, schema.prescriptions.id),
          isNull(schema.prescriptionTargets.deletedAt),
          eq(schema.prescriptionTargets.profileId, profileId),
        ),
      )
      .where(
        and(
          eq(schema.prescriptions.blockId, blockId),
          eq(schema.prescriptions.dayRole, args.dayRole),
          isNull(schema.prescriptions.deletedAt),
          // A retired movement drops off the card rather than being prescribed from the grave. Every
          // other table in this query excludes soft deletes; the inner join to `movements` must too.
          isNull(schema.movements.deletedAt),
        ),
      )
      .orderBy(asc(schema.prescriptions.idx))
  );
}

/** One raw programmed-movement row (drizzle-inferred). The DAL maps this → its `ProgramDayDTO`. */
export type ProgramDayRow = Awaited<ReturnType<typeof programDayRows>>[number];
