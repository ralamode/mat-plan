import 'server-only';

import { programDayRows } from '@mat-plan/db';
import { type DayRole, uuidSchema } from '@mat-plan/shared';

import { type ProgramDayDTO, toProgramDay } from '@/lib/programming/program-day';

import { db } from './db';

export type { ProgramDayDTO };

/**
 * The programmed movements for `profilePublicId` on `dayRole` (V1-10 slice 2). Thin by design: guard the
 * id, run the single-sourced `programDayRows` (so `db:verify` proves this exact query — including its
 * BOLA scoping), and hand the rows to the pure, unit-tested `toProgramDay`. Returns `[]` when the kid has
 * no block or nothing is programmed for that day — the page then renders no card, the pre-V1-10 behavior.
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

  return toProgramDay(await programDayRows(db, { profilePublicId, dayRole }));
}
