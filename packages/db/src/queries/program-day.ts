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
 * - **Deterministic single block.** A household may accumulate blocks; a bare join would fan the day out
 *   across all of them. `ORDER BY program_blocks.id DESC LIMIT 1` in the block subquery pins it to the
 *   newest — the MVP's "the household's one block" (multi-block "active block" selection is backlogged).
 * - **LEFT JOIN `prescription_targets`**, scoped in the `ON` to `(this prescription, THIS profile)`. In the
 *   `WHERE` it would silently inner-join (a kid with no target vanishes) or, worse, match the sibling's row.
 *   No target → `load`/`reps` come back NULL and the caller renders the shared prescription.
 * - Ordered by `idx` — the coach's authored order within the day.
 */
export function programDayRows(
  db: NodePgDatabase<typeof schema>,
  args: { profilePublicId: string; dayRole: string },
) {
  // The profile's own household's newest live block. A scalar subquery (not a join) so the LIMIT 1 applies
  // to the BLOCK, not to the prescription rows we want all of.
  const blockId = db
    .select({ id: schema.programBlocks.id })
    .from(schema.programBlocks)
    .innerJoin(schema.profiles, eq(schema.profiles.householdId, schema.programBlocks.householdId))
    .where(
      and(
        eq(schema.profiles.publicId, args.profilePublicId),
        isNull(schema.profiles.deletedAt),
        isNull(schema.programBlocks.deletedAt),
      ),
    )
    .orderBy(desc(schema.programBlocks.id))
    .limit(1);

  return (
    db
      .select({
        movementName: schema.movements.name,
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
          eq(
            schema.prescriptionTargets.profileId,
            db
              .select({ id: schema.profiles.id })
              .from(schema.profiles)
              .where(
                and(
                  eq(schema.profiles.publicId, args.profilePublicId),
                  isNull(schema.profiles.deletedAt),
                ),
              ),
          ),
        ),
      )
      .where(
        and(
          eq(schema.prescriptions.blockId, blockId),
          eq(schema.prescriptions.dayRole, args.dayRole),
          isNull(schema.prescriptions.deletedAt),
        ),
      )
      .orderBy(asc(schema.prescriptions.idx))
  );
}

/** One raw programmed-movement row (drizzle-inferred). The DAL maps this → its `ProgramDayDTO`. */
export type ProgramDayRow = Awaited<ReturnType<typeof programDayRows>>[number];
