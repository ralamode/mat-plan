import type { ProgramView } from '@mat-plan/shared';

import { NAME_WRAP_CLASS } from '@/lib/constants';

import { BUILDER_COPY, MONDAY_FIRST, weekdayName } from './builder-text';

const HEADING_ID = 'program-week';

/**
 * A program's week, read-only (FAM-1 step 8a: "the Week section's shell"). Step 10 makes it the
 * week editor (+ Add, ↑ ↓ ✕) in `program-builder/week-editor/`.
 *
 * Monday first. Each day is a heading (plan §5's rule) with its slots as a list, in the author's
 * order; a day with none says "Rest day" as text, never as an empty list. A label keeps its own
 * case and is shown in capitals by CSS, so a screen reader reads the word, not the letters.
 */
export function WeekShell({ program }: { program: ProgramView }) {
  const names = new Map(program.workouts.map((w) => [w.workoutPublicId, w.name]));
  return (
    <section aria-labelledby={HEADING_ID} className="flex flex-col gap-3">
      <h2 id={HEADING_ID} className="text-lg font-semibold">
        {BUILDER_COPY.week}
      </h2>
      <p className="text-muted-foreground text-sm">{BUILDER_COPY.weekIntro}</p>
      <div className="flex flex-col divide-y">
        {MONDAY_FIRST.map((day) => {
          const slots = program.week[day];
          return (
            <div key={day} className="flex flex-col gap-1 py-3">
              <h3 className="font-semibold">{weekdayName(day)}</h3>
              {slots.length ? (
                <ul className="flex flex-col gap-1">
                  {slots.map((slot) => (
                    <li key={slot.workoutPublicId} className={`text-sm ${NAME_WRAP_CLASS}`}>
                      {slot.label ? (
                        <>
                          <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                            {slot.label}
                          </span>
                          <span aria-hidden="true"> · </span>
                          <span className="sr-only">: </span>
                        </>
                      ) : null}
                      {names.get(slot.workoutPublicId)}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground text-sm">{BUILDER_COPY.restDay}</p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
