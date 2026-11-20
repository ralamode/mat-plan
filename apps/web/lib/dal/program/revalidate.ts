import 'server-only';

import { revalidatePath } from 'next/cache';

import { PROGRAMS_PATH } from '@/components/program-builder/routes';
import { APP_HOME_PATH, athletePath } from '@/lib/constants';

/**
 * What a program write revalidates, beside the DAL that owns the assignment (FAM-1 step 15c). Two
 * action modules call these after a success, never before: the builder's (`app/programs/actions.ts`)
 * and the day page's Program order (`app/p/[profileId]/row-actions.ts`). Moved here from the
 * builder's module unchanged, so both share one rule.
 */

/** The builder's pages: the list, each program and each workout editor live under it. */
export function refreshPrograms() {
  revalidatePath(PROGRAMS_PATH, 'layout');
}

/**
 * Who is on a program shows on the builder's pages, on Home's tiles (step 15 PR 3) and on each
 * athlete's day page: a Put on or a Take off changes all three, for every athlete it names, and so
 * does a Program order (15c): the program page and Home list an athlete's programs in their order.
 */
export function refreshAssignment(profilePublicIds: readonly string[]) {
  refreshPrograms();
  revalidatePath(APP_HOME_PATH);
  for (const id of profilePublicIds) revalidatePath(athletePath(id));
}
