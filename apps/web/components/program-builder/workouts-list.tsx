'use client';

import type { ProgramActions, ProgramView } from '@mat-plan/shared';
import { useRef, useState } from 'react';

import { Button, buttonVariants } from '@/components/ui/button';
import { CTA_CLASS, FOCUS_TARGET_CLASS, NAME_WRAP_CLASS } from '@/lib/constants';
import { cn } from '@/lib/utils';

import {
  BUILDER_COPY,
  COPY_COPY,
  copiedFromText,
  copyToLabel,
  PENDING_CLASS,
  programFullText,
  programIsFull,
  workoutSummary,
} from './builder-text';
import { CopyWorkout } from './copy-dialog';
import { GroupList, GroupRowLink } from './group-list';
import { newWorkoutPath, workoutPath } from './routes';
import { BuilderLink } from './route-link';

/** The section's heading: where focus lands on the program page after a workout's Save. */
export const WORKOUTS_HEADING_ID = 'program-workouts';
const FULL_ID = 'program-workouts-full';

/**
 * A program's workouts, each a link to its editor (FAM-1 step 8a; the prototype's "Workouts").
 *
 * Each `<li>` is a row whose link takes the remaining width, and "Copy to…" (step 10b) sits beside
 * it, one dialog for every row. A copy names where it came from, frozen at the copy.
 * "+ New workout" is the section's main action while there are none, as in the prototype. At
 * `MAX_PROGRAM_WORKOUTS` it stops before the work (7b-i, plan §Caps): an `aria-disabled` button with
 * the reason visible under it, which a tap also says, in place of a link to an editor that could
 * only refuse the save.
 */
export function WorkoutsList({
  program,
  copyWorkout,
  putOnWired = false,
  onStatus = () => {},
}: {
  program: ProgramView;
  /** "Copy to…" on each row: shown only when the route supplies it. */
  copyWorkout?: ProgramActions['copyWorkout'];
  putOnWired?: boolean;
  onStatus?: (message: string) => void;
}) {
  const { programPublicId, workouts } = program;
  const [copying, setCopying] = useState<ProgramView['workouts'][number] | null>(null);
  const copyFrom = useRef<HTMLElement | null>(null);
  return (
    <section aria-labelledby={WORKOUTS_HEADING_ID} className="flex flex-col gap-3">
      <h2
        id={WORKOUTS_HEADING_ID}
        tabIndex={-1}
        className={`rounded-sm text-lg font-semibold ${FOCUS_TARGET_CLASS}`}
      >
        {BUILDER_COPY.workouts}
      </h2>
      {workouts.length ? (
        <GroupList>
          {workouts.map((workout) => (
            <li key={workout.workoutPublicId} className="flex items-stretch">
              <GroupRowLink
                href={workoutPath(programPublicId, workout.workoutPublicId)}
                title={workout.name}
                className="min-w-0 flex-1"
              >
                <WorkoutLines workout={workout} />
              </GroupRowLink>
              {copyWorkout ? (
                <Button
                  type="button"
                  variant="ghost"
                  // The row's full height, its ring inside the list's clipped corners.
                  className="h-auto shrink-0 self-stretch rounded-none border-l focus-visible:ring-inset"
                  aria-label={copyToLabel(workout.name)}
                  aria-haspopup="dialog"
                  onClick={(event) => {
                    copyFrom.current = event.currentTarget;
                    setCopying(workout);
                  }}
                >
                  {COPY_COPY.open}
                </Button>
              ) : null}
            </li>
          ))}
        </GroupList>
      ) : (
        <p className="text-muted-foreground">{BUILDER_COPY.noWorkouts}</p>
      )}
      {programIsFull(workouts.length) ? (
        <>
          <Button
            type="button"
            variant="outline"
            className={cn(CTA_CLASS, PENDING_CLASS)}
            aria-disabled
            aria-describedby={FULL_ID}
            onClick={() => onStatus(programFullText)}
          >
            {BUILDER_COPY.newWorkout}
          </Button>
          <p id={FULL_ID} className="text-muted-foreground text-sm">
            {programFullText}
          </p>
        </>
      ) : (
        <BuilderLink
          href={newWorkoutPath(programPublicId)}
          className={cn(
            buttonVariants({ variant: workouts.length ? 'outline' : 'default' }),
            CTA_CLASS,
          )}
        >
          {BUILDER_COPY.newWorkout}
        </BuilderLink>
      )}
      {copyWorkout ? (
        <CopyWorkout
          program={program}
          copyWorkout={copyWorkout}
          putOnWired={putOnWired}
          onStatus={onStatus}
          workout={copying}
          returnFocusTo={copyFrom}
          onClose={() => setCopying(null)}
        />
      ) : null}
    </section>
  );
}

/** A workout's lines under its name: its summary, and where a copy came from. */
function WorkoutLines({ workout }: { workout: ProgramView['workouts'][number] }) {
  return (
    <>
      <span className="text-muted-foreground text-sm">
        {workoutSummary(workout.itemCount, workout.usedOn)}
      </span>
      {workout.copiedFrom ? (
        <span className={`text-muted-foreground text-sm italic ${NAME_WRAP_CLASS}`}>
          {copiedFromText(workout.copiedFrom)}
        </span>
      ) : null}
    </>
  );
}
