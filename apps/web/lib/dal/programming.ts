import 'server-only';

import { householdHasProgram, programDayRows } from '@mat-plan/db';
import { type DayRole, uuidSchema } from '@mat-plan/shared';

import { type ProgramDayDTO, toProgramDay } from '@/lib/programming/program-day';

import { db } from './db';
import { getHouseholdScope } from './household';

export type { ProgramDayDTO };

/**
 * The programmed movements for `profilePublicId` on `dayRole` (V1-10 slice 2). Thin by design: resolve the
 * household scope, guard the id, run the single-sourced `programDayRows` (so `db:verify` proves this exact
 * query — including its BOLA scoping), and hand the rows to the pure, unit-tested `toProgramDay`. Returns
 * `[]` when the kid has no block or nothing is programmed for that day — the page then renders no card,
 * the pre-V1-10 behavior.
 *
 * Never leaks an internal id: the query resolves profile → household → block internally, so no caller can
 * pass a household id and read another household's program. **Since TEN-1 1c the REQUESTER's household is
 * asserted too, independently of the profile's own row** — the old chain authorized the block against the
 * profile's `household_id` and nothing checked who was asking. `programDayRows`'s docblock has the
 * property; the scope is what supplies it.
 *
 * A null scope (zero live households — the dark app) returns `[]`, the same "nothing programmed" shape a
 * malformed id takes, so no new UI state appears.
 */
export async function getProgramDay(
  profilePublicId: string,
  dayRole: DayRole,
): Promise<ProgramDayDTO[]> {
  const scope = await getHouseholdScope();
  if (!scope) return [];

  // A malformed id would make Postgres throw on the `uuid` comparison — treat it as "nothing programmed"
  // (the `getProfileByPublicId` guard), never a 500.
  if (!uuidSchema.safeParse(profilePublicId).success) return [];

  return toProgramDay(await programDayRows(db, { profilePublicId, dayRole, scope }));
}

/**
 * Does this household program at all? (`PROF-1` a-g)
 *
 * The day page needs it to tell apart two states `getProgramDay` renders identically, both `[]`:
 * **"nothing is programmed here yet"** (say nothing) and **"this household programs, but you are an
 * adult so none of it is yours"** (say so). Without it an adult sees an empty strength card with no
 * reason, which reads as a breakage rather than a policy.
 *
 * ⚠️ **Returns a BOOLEAN, never the blocks.** The page has no business knowing what the household
 * programs for someone else — a DTO of other people's prescriptions would be a new read surface for
 * no gain. A null scope is `false`, the same shape as the dark app.
 */
export async function householdProgramsAnything(): Promise<boolean> {
  const scope = await getHouseholdScope();
  if (!scope) return false;
  return householdHasProgram(db, { scope });
}
