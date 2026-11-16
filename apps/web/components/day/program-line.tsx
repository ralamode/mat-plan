import { ON_PROGRAM, type DayActions, type DayPlan } from '@mat-plan/shared';

import { NAME_WRAP_CLASS } from '@/lib/constants';
import { cn } from '@/lib/utils';

import { PROGRAM_COPY } from './day-copy';
import { ProgramOrderButton } from './program-order-dialog';

/**
 * The programs of the viewed day, and Program order (FAM-1 step 13d; plan D8).
 *
 * **Placed by the page**, above Bodyweight, where v12 has it (maintainer, 2026-11-16). No
 * `'use client'`: the sentence renders on the server, and only the button and its dialog are client
 * code, loaded only where they can show.
 *
 * One sentence ("Programs: Family program, Stretching") rather than a row of chips, so two long
 * names wrap as prose; the program pages are lane B's and not wired, so the names are not links.
 *
 * **Program order shows as v12 shows it** (maintainer, 2026-11-16), with four conditions: the viewed
 * day has two or more programs; the athlete is on two or more now (off one of them since, the dialog
 * would list one program with nothing to move); the day is writable; and the route supplies
 * `reorderPrograms` (plan §6: an undefined action hides its control; production gets it at 15c).
 */
export function ProgramLine({ plan, actions }: { plan: DayPlan; actions: DayActions }) {
  if (plan.onProgram !== ON_PROGRAM.yes || plan.programs.length === 0) return null;
  const reorder = actions.reorderPrograms;
  const canOrder = plan.writable && plan.programs.length >= 2 && plan.currentPrograms.length >= 2;

  return (
    <div className="flex flex-col items-start gap-1">
      <p className={cn('text-muted-foreground text-sm', NAME_WRAP_CLASS)}>
        {PROGRAM_COPY.line(plan.programs.map((p) => p.name))}
      </p>
      {canOrder && reorder ? <ProgramOrderButton plan={plan} reorder={reorder} /> : null}
    </div>
  );
}
