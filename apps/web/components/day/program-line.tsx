import { ON_PROGRAM, programsByStay, type DayActions, type DayPlan } from '@mat-plan/shared';
import Link from 'next/link';

import { NAME_WRAP_CLASS, PROGRAM_NAME_LINK_CLASS } from '@/lib/constants';
import { cn } from '@/lib/utils';

import { PROGRAM_COPY } from './day-copy';
import { ProgramOrderButton } from './program-order-button';

/**
 * The programs of the viewed day, and Program order (FAM-1 step 13d; plan D8; 15c, D47 and D49).
 *
 * **Placed by the page**, above Bodyweight, where v12 has it (maintainer, 2026-11-16). No
 * `'use client'`: the sentence renders on the server, and only the button and its dialog are client
 * code.
 *
 * **Given `programHrefFor`, each name is a link to its program's page** (D49, maintainer,
 * 2026-11-19), laid out as the prototype has it: a muted "Programs:" label, then each name as
 * "Name ›" with no commas, the "›" hidden from a screen reader so a link's name is the program's
 * alone (`PROGRAM_NAME_LINK_CLASS` has why it is not underlined). The names are a list (`ul`, not
 * labelled: the label is beside it), in one wrapping row with the label, so a wrapped name comes
 * back under the label: 10px apart, 4px between rows. A short name moves to the next row whole, and
 * a long one wraps inside its link.
 * Without it the names are one line of text ("Programs: Family program, Stretching").
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
      {named && programHrefFor ? (
        // One wrapping row, as the prototype's: the label is its first item and the names flow
        // after it, a wrapped name coming back under the label. Inline flow rather than
        // `display: contents` on the list, which has dropped a list's role in some browsers; the
        // margins are the prototype's gaps (10px across, 4px between rows).
        <div className="-my-0.5 text-sm">
          <span className="text-muted-foreground my-0.5 mr-2.5 inline-flex min-h-11 items-center align-top">
            {PROGRAM_COPY.lineLabel(plan.programs.length)}
          </span>
          {/* `role="list"`: Safari drops list semantics from a list styled without markers. */}
          <ul role="list" className="inline">
            {plan.programs.map((program) => (
              <li
                key={program.programPublicId}
                className="my-0.5 mr-2.5 inline-flex max-w-full align-top last:mr-0"
              >
                <Link
                  href={programHrefFor(program.programPublicId)}
                  className={PROGRAM_NAME_LINK_CLASS}
                >
                  {program.name}
                  {/* The link lays out as flex items, so the gap is a margin, not a space. */}
                  <span aria-hidden="true" className="ml-1">
                    ›
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : named ? (
        <p className={cn('text-muted-foreground text-sm', NAME_WRAP_CLASS)}>
          {PROGRAM_COPY.line(plan.programs.map((p) => p.name))}
        </p>
      ) : null}
      {reorder ? <ProgramOrderButton plan={plan} reorder={reorder} canOrder={canOrder} /> : null}
    </div>
  );
}
