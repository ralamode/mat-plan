import { ON_PROGRAM, type DayPlan } from '@mat-plan/shared';
import Link from 'next/link';

import { NAME_WRAP_CLASS, NOTICE_CLASS, QUIET_LINK_CLASS } from '@/lib/constants';
import { cn } from '@/lib/utils';

import { athleteNameOf, PROGRAM_COPY } from './day-copy';

/**
 * Why there are no workouts (FAM-1 step 13d; plan D17): "Not on a program yet" for an athlete who
 * has never been on one, "Not on a program on this day" for one who is on a program now but was not
 * on this day. Nothing when they are on one.
 *
 * **Placed by the page**, above Bodyweight, where v12 has it (maintainer, 2026-11-16).
 *
 * `programsHref` is the Programs list. **The page passes it only for a live athlete on today or a
 * later day** (`offersProgramsLink`, FAM-1 15): nobody can be put on a program for a past day, and an
 * archived athlete cannot be put on one, so there the notice neither links nor asks.
 */
export function NotOnAProgram({ plan, programsHref }: { plan: DayPlan; programsHref?: string }) {
  if (plan.onProgram === ON_PROGRAM.yes) return null;
  if (plan.onProgram === ON_PROGRAM['not-this-day']) {
    return <p className={NOTICE_CLASS}>{PROGRAM_COPY.notThisDay}</p>;
  }
  const athlete = athleteNameOf(plan);
  return (
    <p className={cn(NOTICE_CLASS, NAME_WRAP_CLASS)}>
      {PROGRAM_COPY.notYet}
      {/* Only where it is true: a closed day, an archived athlete and a future day log nothing
          (maintainer, 2026-11-17). */}
      {plan.writable ? ` ${PROGRAM_COPY.notYetLogHere}` : null}
      {programsHref && athlete ? (
        <>
          {' '}
          {PROGRAM_COPY.notYetPutOn(athlete)}{' '}
          <Link href={programsHref} className={QUIET_LINK_CLASS}>
            {PROGRAM_COPY.programs}
          </Link>
        </>
      ) : null}
    </p>
  );
}
