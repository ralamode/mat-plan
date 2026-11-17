import { and, asc, eq, isNull } from 'drizzle-orm';

import { uuidSchema, WEEKDAYS, type WeekDraft } from '@mat-plan/shared';

import { schema } from '../../client';
import type { HouseholdScope } from '../../scope';
import type { Executor } from '../../writers/executor';
import { liveTemplateBlockIn } from '../../writers/ownership';

/**
 * A program's week as the week editor and the program page hold it (`WeekDraft['days']`, FAM-1 step
 * 6b): every weekday, its live slots in order, each a live workout of the program and its label. A
 * rest day is `[]`. What `saveWeek` saved reads back equal.
 *
 * `null` when the id is not one of this household's live programs, or not a uuid.
 */
export async function readWeek(
  exec: Executor,
  scope: HouseholdScope,
  programPublicId: string,
): Promise<WeekDraft['days'] | null> {
  if (!uuidSchema.safeParse(programPublicId).success) return null;
  const [block] = await exec
    .select({ id: schema.programBlocks.id })
    .from(schema.programBlocks)
    .where(and(eq(schema.programBlocks.publicId, programPublicId), liveTemplateBlockIn(scope)))
    .limit(1);
  if (!block) return null;

  const slots = await exec
    .select({
      weekday: schema.blockDayWorkouts.weekday,
      workoutPublicId: schema.workouts.publicId,
      label: schema.blockDayWorkouts.label,
    })
    .from(schema.blockDayWorkouts)
    .innerJoin(
      schema.workouts,
      and(
        eq(schema.workouts.id, schema.blockDayWorkouts.workoutId),
        isNull(schema.workouts.deletedAt),
      ),
    )
    .where(
      and(eq(schema.blockDayWorkouts.blockId, block.id), isNull(schema.blockDayWorkouts.deletedAt)),
    )
    .orderBy(asc(schema.blockDayWorkouts.weekday), asc(schema.blockDayWorkouts.idx));

  const days = Object.fromEntries(WEEKDAYS.map((d) => [d, []])) as unknown as WeekDraft['days'];
  for (const { weekday, ...slot } of slots) days[weekday as keyof WeekDraft['days']].push(slot);
  return days;
}
