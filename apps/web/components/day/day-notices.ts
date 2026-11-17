import { ON_PROGRAM, showsOnlyLogged, type DayPlan } from '@mat-plan/shared';

import { PROGRAM_COPY } from './day-copy';

/*
 * The day screen's notices, as pure functions of the plan. No directive: a server component (the
 * "not on a program" notice, the page at 12c) may call them, which an export of the `'use client'`
 * `day-screen.tsx` could not.
 *
 * "Shows only what was logged" is the contract's `showsOnlyLogged` (C23): an older day, and an
 * archived athlete's today or yesterday. The resolver, the fixtures and these notices read that one
 * test, so the rest line and the "No workouts logged" line can never both show.
 */

/**
 * The rest-day line (FAM-1 step 13d), worded as v12 has it (maintainer, 2026-11-16): when every
 * program the athlete is on rests, "Rest day. Nothing is scheduled on Sundays."; when some rest on a
 * day with two or more, "Rest day on Family program."
 *
 * 🔴 **Never on a day that shows only what was logged** (`showsOnlyLogged`: an older day, and an
 * archived athlete's today or yesterday). Such a day lists only workouts with a logged row
 * (`dayPlanSchema`), so there a program with no workout means *skipped*, not rest, and calling it
 * a rest day would mislead a parent reading back (UX panel, 13d); it says "No workouts logged"
 * instead. A workout that left the week is not a scheduled one, so it does not make its program
 * "not resting". The all-rest line is v12's notice box, since it is then the only thing in the
 * section.
 */
export function restNotice(plan: DayPlan): { text: string; allRest: boolean } | null {
  if (plan.onProgram !== ON_PROGRAM.yes || showsOnlyLogged(plan)) return null;
  const resting = plan.programs.filter(
    (program) =>
      !plan.workouts.some((w) => w.scheduled && w.programPublicId === program.programPublicId),
  );
  if (resting.length === 0) return null;
  if (resting.length === plan.programs.length) {
    // v12 says it only on an empty day: a logged workout that left the week is something to see.
    return plan.workouts.length === 0
      ? { text: PROGRAM_COPY.restAll(plan.day), allRest: true }
      : null;
  }
  return plan.programs.length >= 2
    ? { text: PROGRAM_COPY.restSome(resting.map((p) => p.name)), allRest: false }
    : null;
}

/**
 * The "No workouts logged" line (maintainer, 2026-11-17): on a day that shows only what was logged,
 * for an athlete on a program, with no workouts. The rest line's twin, so never shown with it.
 */
export function nothingLoggedNotice(plan: DayPlan): string | null {
  return plan.onProgram === ON_PROGRAM.yes && showsOnlyLogged(plan) && plan.workouts.length === 0
    ? PROGRAM_COPY.nothingLogged(plan.day, plan.today)
    : null;
}

/**
 * What the day page shows around the screen (FAM-1 12c; maintainer, 2026-11-17), as a pure
 * function so it is tested here rather than only in the async page, which Vitest cannot render.
 *
 * - `notice`: the ONE state notice, above the program line: archived, else coming up on a future
 *   day, else the closed-day sentence. A future day whose programs all rest shows none: the screen's
 *   rest line ("Rest day. Nothing is scheduled on Sundays.") is the whole story, and "You can log it
 *   on the day" would be false (12c review).
 * - `sections`: Bodyweight and Life, not on a future day (nothing has happened there).
 * - `screen`: `DayScreen`, not for an athlete on no program with no rows (an empty landmark).
 */
export function dayPageView(
  plan: DayPlan,
  page: { future: boolean; showClosedNotice: boolean; archived: boolean },
): { notice: 'archived' | 'comingUp' | 'closed' | null; sections: boolean; screen: boolean } {
  const notice = page.archived
    ? 'archived'
    : page.future
      ? restNotice(plan)?.allRest
        ? null
        : 'comingUp'
      : page.showClosedNotice
        ? 'closed'
        : null;
  return {
    notice,
    sections: !page.future,
    screen: plan.onProgram === ON_PROGRAM.yes || plan.workouts.length > 0,
  };
}

/**
 * Look-ahead goes forward only while the athlete is on a program (plan §9): a future day they are
 * not on one renders today instead, as every future day did before 12c.
 */
export function lookAheadFallsBack(plan: DayPlan): boolean {
  return plan.future && plan.onProgram !== ON_PROGRAM.yes;
}
