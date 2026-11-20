import { ON_PROGRAM, programsByStay, type DayActions, type DayPlan } from '@mat-plan/shared';
import Link from 'next/link';
import { Fragment } from 'react';

import { NAME_WRAP_CLASS, QUIET_LINK_CLASS, VALUE_JOINER } from '@/lib/constants';
import { cn } from '@/lib/utils';

import { PROGRAM_COPY } from './day-copy';
import { ProgramOrderButton } from './program-order-dialog';

/**
 * The programs of the viewed day, and Program order (FAM-1 step 13d; plan D8; 15c, D47 and D49).
 *
 * **Placed by the page**, above Bodyweight, where v12 has it (maintainer, 2026-11-16). No
 * `'use client'`: the sentence renders on the server, and only the button and its dialog are client
 * code.
 *
 * One sentence ("Programs: Family program, Stretching") rather than a row of chips. **Given
 * `programHrefFor`, each name is a link to its program's page**, with the prototype's "›" hidden
 * from a screen reader (D49, maintainer, 2026-11-19); a linked name moves to the next line whole.
 * Without it the names are text, as on the preview.
 *
 * **Program order shows** when the viewed day has two or more programs, the day is writable, the
 * route supplies `reorderPrograms` (plan §6: an undefined action hides its control), and two or more
 * programs **stay** past today (D47: one ending today is listed but cannot move). The button's client
 * half is mounted whenever the route supplies the action, and is told `canOrder`: it hides the
 * button when any condition fails, but **an open dialog is never unmounted by a re-read**, whatever
 * the re-read changed (the day's programs, its writability, the athlete coming off a program), so its
 * message and focus stay with the person using it (15c plan, UX-B1).
 */
export function ProgramLine({
  plan,
  actions,
  programHrefFor,
}: {
  plan: DayPlan;
  actions: DayActions;
  /** A program's page, by its id (`programPath`). Given it, the names are links (15c PR 3). */
  programHrefFor?: (programPublicId: string) => string;
}) {
  const reorder = actions.reorderPrograms;
  const named = plan.onProgram === ON_PROGRAM.yes && plan.programs.length > 0;
  const canOrder =
    named &&
    plan.writable &&
    plan.programs.length >= 2 &&
    programsByStay(plan.currentPrograms).staying.length >= 2;
  if (!named && !reorder) return null;

  return (
    <div className="flex flex-col items-start gap-1 empty:hidden">
      {named ? (
        <p className={cn('text-muted-foreground text-sm', NAME_WRAP_CLASS)}>
          {programHrefFor ? (
            <>
              {PROGRAM_COPY.lineLabel(plan.programs.length)}{' '}
              {plan.programs.map((program, index) => (
                <Fragment key={program.programPublicId}>
                  {index > 0 ? VALUE_JOINER : null}
                  <Link
                    href={programHrefFor(program.programPublicId)}
                    className={cn(QUIET_LINK_CLASS, NAME_WRAP_CLASS)}
                  >
                    {program.name}
                    <span aria-hidden="true"> ›</span>
                  </Link>
                </Fragment>
              ))}
            </>
          ) : (
            PROGRAM_COPY.line(plan.programs.map((p) => p.name))
          )}
        </p>
      ) : null}
      {reorder ? <ProgramOrderButton plan={plan} reorder={reorder} canOrder={canOrder} /> : null}
    </div>
  );
}
