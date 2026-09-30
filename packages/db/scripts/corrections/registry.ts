import { and, eq, isNull, sql } from 'drizzle-orm';

import type { Database } from '../../src/client';
import * as schema from '../../src/schema';

/**
 * One guarded, idempotent correction to live data.
 *
 * `run` MUST be safe to call twice: every `WHERE` includes the value being corrected *from*, so a
 * second run matches nothing and reports 0. That is what makes `--apply` re-runnable after a partial
 * failure, and what stops a correction becoming a second, wrong write.
 */
export type Correction = {
  name: string;
  /** One line, in the past tense — what was wrong. */
  what: string;
  /** The backlog row that fixes the CAUSE. A correction treats data; the bug still needs a PR. */
  issue: string;
  /** Returns a human-readable line per row it would change (dry run) or did change (`--apply`). */
  run: (db: Database, apply: boolean) => Promise<string[]>;
};

/**
 * 2026-09-28 — Liam's KB swings were logged `20 × BW` when the session was **10 reps × 20 lb**,
 * five sets.
 *
 * Two app bugs produced it, both V1-24: the strength form offered a BW toggle on a movement the
 * catalog declares as loaded (`kb_swings` is seeded `isBodyweight: false, unitDefault: 'lb'`), and
 * `isEditableSet` refuses to edit a bodyweight set — which, with no delete action anywhere in the
 * app, made it **unrecoverable through the UI**. Hence a correction.
 *
 * The fix, per set: `reps 20 → 10`, clear `is_bodyweight`, and add the `primary` mass quantity of
 * 20 lb that should have been there. Note the quantity is an INSERT, not an update — a bodyweight set
 * has no quantity row at all, which is exactly why the read line said `20 × BW`.
 */
const liamKbSwings: Correction = {
  name: 'liam-kb-swings-2026-09-28',
  what: '5 KB-swing sets logged `20 × BW`; they were `10 reps × 20 lb`',
  issue: 'V1-24',
  async run(db, apply) {
    const LIAM = '019826b4-0000-7000-8000-000000000001';
    const DAY = '2026-09-28';

    // Target by (profile public_id, day, movement slug) — never an internal id, which differs
    // between environments. The `is_bodyweight` predicate is the GUARD: once corrected, it matches
    // nothing.
    const sets = await db
      .select({
        id: schema.entrySets.id,
        publicId: schema.entrySets.publicId,
        idx: schema.entrySets.idx,
        reps: schema.entrySets.reps,
      })
      .from(schema.entrySets)
      .innerJoin(schema.entries, eq(schema.entries.id, schema.entrySets.entryId))
      .innerJoin(schema.profiles, eq(schema.profiles.id, schema.entries.profileId))
      .innerJoin(schema.movements, eq(schema.movements.id, schema.entries.movementId))
      .where(
        and(
          eq(schema.profiles.publicId, LIAM),
          eq(schema.entries.activityDate, DAY),
          eq(schema.movements.slug, 'kb_swings'),
          eq(schema.entrySets.isBodyweight, true), // ← the guard: already-fixed rows don't match
          isNull(schema.entrySets.deletedAt),
          isNull(schema.entries.deletedAt),
          isNull(schema.profiles.deletedAt),
        ),
      )
      .orderBy(schema.entrySets.idx);

    const changes = sets.map(
      (s) => `set ${s.idx} (${s.publicId}): reps ${s.reps} → 10, BW → 20 lb primary`,
    );
    if (!apply || sets.length === 0) return changes;

    // One transaction: a set left half-corrected (reps fixed, still bodyweight, no quantity) is a
    // worse state than the bug — it would read `10 × BW` and look deliberate.
    await db.transaction(async (tx) => {
      for (const s of sets) {
        await tx
          .update(schema.entrySets)
          .set({ reps: 10, isBodyweight: false, updatedAt: sql`now()` })
          .where(eq(schema.entrySets.id, s.id));

        // INSERT, not update — a bodyweight set carries no quantity row at all.
        await tx.insert(schema.entrySetQuantities).values({
          clientId: crypto.randomUUID(),
          entrySetId: s.id,
          slot: 'primary',
          dimension: 'mass',
          unit: 'lb',
          valueNum: '20',
        });
      }
    });
    return changes;
  },
};

export const CORRECTIONS: readonly Correction[] = [liamKbSwings];
