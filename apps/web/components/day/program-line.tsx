import { ON_PROGRAM, programsByStay, type DayActions, type DayPlan } from '@mat-plan/shared';
import Link from 'next/link';
import { Fragment } from 'react';

import { NAME_WRAP_CLASS, QUIET_LINK_CLASS, VALUE_JOINER } from '@/lib/constants';
import { cn } from '@/lib/utils';

import { PROGRAM_COPY } from './day-copy';
import { ProgramOrderButton } from './program-order-dialog';

type DayProgram = DayPlan['programs'][number];

/**
 * The programs of the viewed day, and Program order (FAM-1 step 13d; plan D8; 15c, D47 and D49).
 *
 * **Placed by the page**, above Bodyweight, where v12 has it (maintainer, 2026-11-16). No
 * `'use client'`: the sentence renders on the server, and only the button and its dialog are client
 * code, loaded only where they can show.
 *
 * One sentence ("Programs: Family program, Stretching") rather than a row of chips, so two long
 * names wrap as prose. **Given `programHrefFor`, each name is a link to its program's page** (D49,
 * maintainer, 2026-11-19); without it the names are text, as on the preview.
 *
 * **Program order** needs four things: the viewed day has two or more programs; the day is writable;
 * the route supplies `reorderPrograms` (plan §6: an undefined action hides its control); and two or
 * more programs **stay** past today (D47: one ending today is listed but cannot move, so with one
 * staying there is nothing to order). The button's client half is mounted whenever the first three
 * hold, and is told `canOrder`: it hides the button without the fourth, but **keeps an open dialog
 * mounted**, so a re-read that leaves one staying never takes the dialog, its message and focus away
 * from someone using it (15c plan, UX-B1).
 */
export function ProgramLine({
  plan,
  actions,
  programHrefFor,
}: {
  plan: DayPlan;
  actions: DayActions;
  programHrefFor?: (program: DayProgram) => string;
}) {
  if (plan.onProgram !== ON_PROGRAM.yes || plan.programs.length === 0) return null;
  const reorder = actions.reorderPrograms;
  const shows = plan.writable && plan.programs.length >= 2;
  const canOrder = shows && programsByStay(plan.currentPrograms).staying.length >= 2;

  return (
    <div className="flex flex-col items-start gap-1">
      <p className={cn('text-muted-foreground text-sm', NAME_WRAP_CLASS)}>
        {programHrefFor ? (
          <>
            {PROGRAM_COPY.lineLabel(plan.programs.length)}{' '}
            {plan.programs.map((program, index) => (
              <Fragment key={program.programPublicId}>
                {index > 0 ? VALUE_JOINER : null}
                <Link href={programHrefFor(program)} className={QUIET_LINK_CLASS}>
                  {program.name}
                </Link>
              </Fragment>
            ))}
          </>
        ) : (
          PROGRAM_COPY.line(plan.programs.map((p) => p.name))
        )}
      </p>
      {shows && reorder ? (
        <ProgramOrderButton plan={plan} reorder={reorder} canOrder={canOrder} />
      ) : null}
    </div>
  );
}
