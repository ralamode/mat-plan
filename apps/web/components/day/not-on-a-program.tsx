import { ON_PROGRAM, type DayPlan } from '@mat-plan/shared';
import Link from 'next/link';

import { NAME_WRAP_CLASS, QUIET_LINK_CLASS } from '@/lib/constants';
import { cn } from '@/lib/utils';

import { NOTICE_CLASS, PROGRAM_COPY } from './day-copy';

/**
 * Why there are no workouts (FAM-1 step 13d; plan D17): "Not on a program yet" for an athlete who
 * has never been on one, "Not on a program on this day" for one who is on a program now but was not
 * on this day. Nothing when they are on one.
 *
 * **Placed by the page**, above Bodyweight, where v12 has it (maintainer, 2026-11-16).
 *
 * `programsHref` is the Programs list. **Until it exists, the notice offers no link and does not ask
 * anyone to put the athlete on a program** (UX panel, 13d): from 12c to step 15 every athlete sees
 * this daily, and a sentence pointing at a page that is not there reads as broken.
 */
export function NotOnAProgram({ plan, programsHref }: { plan: DayPlan; programsHref?: string }) {
  if (plan.onProgram === ON_PROGRAM.yes) return null;
  if (plan.onProgram === ON_PROGRAM['not-this-day']) {
    return <p className={NOTICE_CLASS}>{PROGRAM_COPY.notThisDay}</p>;
  }
  const athlete = plan.athletes.find((a) => a.profilePublicId === plan.profilePublicId)?.name;
  return (
    <p className={cn(NOTICE_CLASS, NAME_WRAP_CLASS)}>
      {PROGRAM_COPY.notYet}
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
