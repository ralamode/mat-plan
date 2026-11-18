import { and, asc, count, eq, isNull } from 'drizzle-orm';

import {
  isoDaySchema,
  MONDAY_FIRST,
  programViewSchema,
  uuidSchema,
  type ProgramView,
} from '@mat-plan/shared';

import { schema } from '../../client';
import type { HouseholdScope } from '../../scope';
import type { Executor } from '../../writers/executor';
import { liveTemplateBlockIn } from '../../writers/ownership';
import { athletesOnPrograms } from './athletes';
import { readWeek } from './week';

/**
 * The household's calendar day of an instant, in `tz`. In JS, with `Intl.formatToParts`, as the
 * app's `localDayIso` (`apps/web/lib/date.ts`) builds it: assembled by part, never from a locale's
 * format string. So a zone the app accepts reads the same here: Postgres's `at time zone` reads a
 * bare offset (`+05:00`) with the sign reversed (POSIX), `Intl` does not.
 */
function localDayOf(tz: string): (instant: Date) => string {
  let format: Intl.DateTimeFormat;
  try {
    format = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch {
    throw new Error('readProgramView needs a time zone Intl accepts');
  }
  return (instant) => {
    const parts = format.formatToParts(instant);
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((p) => p.type === type)?.value ?? '';
    return `${part('year')}-${part('month')}-${part('day')}`;
  };
}

/**
 * The program page (`ProgramView`, FAM-1 step 6c-ii), and the data its two dialogs open with. `null`
 * when the id is not one of this household's live programs, or not a uuid.
 *
 * `today` is the household's today and `tz` its IANA time zone, both resolved by the caller (the
 * DAL takes the day and the zone as arguments; only a route or an action reads the cookie). `tz`
 * turns a copy's `created_at` into the day it was copied, in the household's calendar.
 *
 * - **Who's on it** (`athletes`): the household's athletes on it as of `today` (on it now or starting
 *   later), earliest made first. `since` is the start of the stretch that places it, `lastDay` its
 *   inclusive last day once Take off ran, and `alsoOn` their other current programs, in their own
 *   order. **The candidates** are every live, not archived athlete; `keeps` lists all their current
 *   programs, this one included. Both follow the day page's rule (`athletesOnPrograms`).
 * - **Workouts**: the live ones, in the order they were made, each with its live item count, the
 *   weekdays of its live slots (Monday first) and, for a copy, the source program's frozen name and
 *   the copy's day.
 * - **The week** is `readWeek`'s, and **the other programs** are the household's other live programs
 *   in the Programs list's order (the order they were made).
 *
 * The answer is parsed with `programViewSchema` (which also checks that every slot names one of the
 * workouts) before it is returned. ⚠️ Several reads, not one snapshot: a save committing between
 * them can be seen in part. **The week keeps only slots of the workouts read**, so a workout saved
 * and put on the week in that window never makes the page throw on the schema's slot check; it
 * shows on the next load. ⚠️ Not proved by a gate: PGlite has one connection, so no proof can commit
 * a save between two reads of one call.
 */
export async function readProgramView(
  exec: Executor,
  scope: HouseholdScope,
  programPublicId: string,
  { today, tz }: { today: string; tz: string },
): Promise<ProgramView | null> {
  if (!isoDaySchema.safeParse(today).success) {
    throw new Error('readProgramView needs today as an ISO day');
  }
  // A zone `Intl` refuses is the caller's bug (the app's cookie check uses `Intl` too): fail here,
  // with fixed text.
  const dayIn = localDayOf(tz);
  if (!uuidSchema.safeParse(programPublicId).success) return null;

  const programs = await exec
    .select({
      id: schema.programBlocks.id,
      publicId: schema.programBlocks.publicId,
      name: schema.programBlocks.name,
    })
    .from(schema.programBlocks)
    .where(liveTemplateBlockIn(scope))
    .orderBy(asc(schema.programBlocks.id));
  const program = programs.find((p) => p.publicId === programPublicId.toLowerCase());
  if (!program) return null;

  const athletes: ProgramView['athletes'] = [];
  const candidates: ProgramView['candidates'] = [];
  for (const athlete of await athletesOnPrograms(exec, scope, today)) {
    const names = athlete.current.map((p) => p.name);
    const on = athlete.current.some((p) => p.blockId === program.id);
    candidates.push({ profilePublicId: athlete.publicId, name: athlete.name, on, keeps: names });
    if (!on) continue;
    // The row that places it (`currentPrograms`' rank): an open or upcoming one, else the one
    // closing today or later. `assignments` is in `(idx, id)` order.
    const rows = athlete.assignments.filter((a) => a.current && a.blockId === program.id);
    const placing = rows.find((a) => a.activeTo === null || a.activeFrom > today) ?? rows[0]!;
    athletes.push({
      profilePublicId: athlete.publicId,
      name: athlete.name,
      since: placing.activeFrom,
      lastDay: placing.activeTo,
      alsoOn: athlete.current.filter((p) => p.blockId !== program.id).map((p) => p.name),
    });
  }

  const w = schema.workouts;
  const workouts = await exec
    .select({
      id: w.id,
      publicId: w.publicId,
      name: w.name,
      copiedFromProgramName: w.copiedFromProgramName,
      createdAt: w.createdAt,
    })
    .from(w)
    .where(and(eq(w.blockId, program.id), isNull(w.deletedAt)))
    .orderBy(asc(w.id));
  const counts = await exec
    .select({ workoutId: schema.prescriptions.workoutId, n: count() })
    .from(schema.prescriptions)
    .where(
      and(eq(schema.prescriptions.blockId, program.id), isNull(schema.prescriptions.deletedAt)),
    )
    .groupBy(schema.prescriptions.workoutId);
  const itemCount = new Map(counts.map((c) => [c.workoutId, c.n]));

  const read = await readWeek(exec, scope, program.publicId);
  // Removed between the two reads: the program is gone, so the page is.
  if (!read) return null;
  const listed = new Set(workouts.map((workout) => workout.publicId));
  const week = Object.fromEntries(
    Object.entries(read).map(([day, slots]) => [
      day,
      slots.filter((slot) => listed.has(slot.workoutPublicId)),
    ]),
  ) as typeof read;

  return programViewSchema.parse({
    programPublicId: program.publicId,
    name: program.name,
    today,
    athletes,
    candidates,
    workouts: workouts.map((workout) => ({
      workoutPublicId: workout.publicId,
      name: workout.name,
      itemCount: itemCount.get(workout.id) ?? 0,
      usedOn: MONDAY_FIRST.filter((day) =>
        week[day].some((slot) => slot.workoutPublicId === workout.publicId),
      ),
      copiedFrom:
        workout.copiedFromProgramName === null
          ? null
          : { programName: workout.copiedFromProgramName, on: dayIn(workout.createdAt) },
    })),
    week,
    otherPrograms: programs
      .filter((p) => p.id !== program.id)
      .map((p) => ({ programPublicId: p.publicId, name: p.name })),
  });
}
