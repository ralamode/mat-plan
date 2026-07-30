import 'server-only';

import { programDayRows } from '@mat-plan/db';
import { type DayRole, uuidSchema } from '@mat-plan/shared';

import { db } from './db';

/**
 * One programmed movement on a kid's day — the read-only "Today's program" reference card's row (V1-10
 * slice 2). Every field is the coach's VERBATIM authored text (`sets` is the only number): `targetReps`
 * and `load` carry "8-12" / "AMRAP" / "BW +5" / "40 yd, to grip failure" losslessly, because that text IS
 * the coach's safety cue and the numeric log schema cannot hold it. The card DISPLAYS these; the kid types
 * what they actually performed into the (unchanged, still-required) strength form — so a prescribed load
 * can never be logged as a performed one.
 */
export type ProgramDayDTO = {
  movementName: string;
  sets: number | null;
  /** The reps to display — this kid's per-kid override, falling back to the shared prescription. */
  targetReps: string | null;
  /** This kid's suggested load; null when they have no target on this prescription. */
  load: string | null;
};

/**
 * The programmed movements for `profilePublicId` on `dayRole` (V1-10 slice 2). Thin: guard the id, run the
 * single-sourced `programDayRows` (so `db:verify` proves this exact query — including its BOLA scoping),
 * and map rows → DTO. Returns `[]` when the kid has no household/block or nothing is programmed for that
 * day — the page then renders no card, which is the pre-V1-10 behavior.
 *
 * Never leaks an internal id: the query resolves profile → household → block internally, so no caller can
 * pass a household id and read another household's program.
 */
export async function getProgramDay(
  profilePublicId: string,
  dayRole: DayRole,
): Promise<ProgramDayDTO[]> {
  // A malformed id would make Postgres throw on the `uuid` comparison — treat it as "nothing programmed"
  // (the `getProfileByPublicId` guard), never a 500.
  if (!uuidSchema.safeParse(profilePublicId).success) return [];

  const rows = await programDayRows(db, { profilePublicId, dayRole });

  return rows.map((r) => ({
    movementName: r.movementName,
    sets: r.sets,
    // Per-kid reps override wins; otherwise the prescription's shared target (spec: `prescription_target.reps`
    // is null for the common case). `??` not `||` — an authored empty string is not a reason to fall back.
    targetReps: r.reps ?? r.targetReps,
    load: r.load,
  }));
}
