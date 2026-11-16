import type { ProgramView } from '@mat-plan/shared';
import Link from 'next/link';

import { buttonVariants } from '@/components/ui/button';
import { CTA_CLASS, NAME_WRAP_CLASS } from '@/lib/constants';
import { cn } from '@/lib/utils';

import { BUILDER_COPY, copiedFromText, workoutSummary } from './builder-text';
import { CHEVRON_CLASS, GROUP_LIST_CLASS, GROUP_ROW_LINK_CLASS } from './classes';
import { newWorkoutPath, workoutPath } from './routes';

const HEADING_ID = 'program-workouts';

/**
 * A program's workouts, each a link to its editor (FAM-1 step 8a; the prototype's "Workouts").
 *
 * Each `<li>` is a row whose link takes the remaining width, so step 10b's "Copy to…" joins it as
 * a sibling button without reshaping the row. A copy names where it came from, frozen at the copy.
 * "+ New workout" is the section's main action while there are none, as in the prototype.
 */
export function WorkoutsList({ program }: { program: ProgramView }) {
  const { programPublicId, workouts } = program;
  return (
    <section aria-labelledby={HEADING_ID} className="flex flex-col gap-3">
      <h2 id={HEADING_ID} className="text-lg font-semibold">
        {BUILDER_COPY.workouts}
      </h2>
      {workouts.length ? (
        <ul className={GROUP_LIST_CLASS}>
          {workouts.map((workout) => (
            <li key={workout.workoutPublicId} className="flex items-stretch">
              <Link
                href={workoutPath(programPublicId, workout.workoutPublicId)}
                className={cn(GROUP_ROW_LINK_CLASS, 'min-w-0 flex-1')}
              >
                <span className="flex items-center gap-3">
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className={`font-semibold ${NAME_WRAP_CLASS}`}>{workout.name}</span>
                    <span className="text-muted-foreground text-sm">
                      {workoutSummary(workout.itemCount, workout.usedOn)}
                    </span>
                    {workout.copiedFrom ? (
                      <span className={`text-muted-foreground text-sm italic ${NAME_WRAP_CLASS}`}>
                        {copiedFromText(workout.copiedFrom)}
                      </span>
                    ) : null}
                  </span>
                  <span aria-hidden="true" className={CHEVRON_CLASS}>
                    ›
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground">{BUILDER_COPY.noWorkouts}</p>
      )}
      <Link
        href={newWorkoutPath(programPublicId)}
        className={cn(
          buttonVariants({ variant: workouts.length ? 'outline' : 'default' }),
          CTA_CLASS,
        )}
      >
        {BUILDER_COPY.newWorkout}
      </Link>
    </section>
  );
}
