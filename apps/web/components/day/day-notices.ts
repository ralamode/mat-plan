import { ON_PROGRAM, type DayPlan } from '@mat-plan/shared';

import { PROGRAM_COPY } from './day-copy';

/*
 * The day screen's notices, as pure functions of the plan. No directive: a server component (the
 * "not on a program" notice, the page at 12c) may call them, which an export of the `'use client'`
 * `day-screen.tsx` could not.
 */

/**
 * Whether the day shows only what was logged: neither writable (today and yesterday, for an athlete
 * who is not archived) nor a look-ahead day: an older day, and an archived athlete's today or
 * yesterday.
 * The rest line and the "No workouts logged" line read this one test, so a day is never both.
 */
export function showsOnlyLogged(plan: DayPlan): boolean {
  return !plan.writable && !plan.future;
}

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
