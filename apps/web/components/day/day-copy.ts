import { localWeekday, ROW_REFUSAL, type DayPlan, type RowRefusal } from '@mat-plan/shared';

import { BUILDER_COPY, weekdayName } from '@/components/program-builder/builder-text';
import { CLOSED_DAY_NOTICE, VALUE_JOINER } from '@/lib/constants';
import { formatList } from '@/lib/i18n/plural';

import type { RowWriteKind, TypedProblem } from './row-values';

/**
 * The day screen's words (FAM-1 step 13), defined once so the components and their tests read the
 * same strings (AGENTS.md → constants).
 *
 * "Couldn't save. Try again." is the prototype's (plan D24). Copy the prototype does not have is
 * written for a kid on a gym floor: what happened and what to do, never the program builder's
 * vocabulary.
 */
export const DAY_COPY = {
  heading: 'Workouts',
  done: 'Done',
  doneMark: 'Done ✓',
  lastTime: 'Last time',
  logged: 'Logged',
  reload: 'Reload',
  /** The set table (13b): its column headers, and what an empty Previous says to a screen reader. */
  set: 'Set',
  previous: 'Previous',
  reps: 'Reps',
  noPrevious: 'none',
  addSet: '+ Add set',
  /** "+ Add set" for a screen reader, which hears several on one page: which item it adds to. */
  addSetTo: (name: string) => `Add set to ${name}`,
  /** Column headers for a time quantity: v12's `Sec` and `Min`; other units show their code. */
  secHeader: 'Sec',
  minHeader: 'Min',
  setAdded: (name: string) => `${name}: set added`,
  setLabel: (name: string, set: number) => `${name} set ${set}`,
  /** A row logged against a prescription the program has since changed (D7; v12's wording). */
  loggedAgainst: (text: string) => `Logged rows were against ${text}.`,
  superset: (letter: string) => `Superset ${letter}`,
  rest: (text: string) => `Rest ${text}`,
  /** A row whose prescription left the workout after it was logged (v12, `index.html:2432`). */
  removed: 'No longer in this workout. What was logged stays.',
  /** The whole screen turns read-only after the first `closed_day`. */
  closed: CLOSED_DAY_NOTICE,
  progress: (done: number, total: number) => `${done} of ${total}`,
  notSaved: (count: number) => `${count} not saved`,
  logLabel: (name: string) => `Log ${name}`,
  fieldLabel: (name: string, unit: string) => (unit ? `${name}, in ${unit}` : name),
  announce: {
    logged: (name: string) => `${name} logged`,
    unticked: (name: string) => `${name} un-checked`,
    failed: (name: string, message: string) => `${name}: ${message}`,
  },
} as const;

/** "Couldn't save. Try again.": a ✓ and a reorder say the same thing when the server refuses. */
const SAVE_FAILED = 'Couldn’t save. Try again.';
const STALE = 'This changed since the page loaded.';

/** The athlete the plan is for, by name (the plan names its own athlete in `athletes`). */
export function athleteNameOf(plan: DayPlan): string {
  return plan.athletes.find((a) => a.profilePublicId === plan.profilePublicId)?.name ?? '';
}

/**
 * The words of step 13d's parts: the program line, Program order, the athlete switcher and the
 * notices. v12's wording, except where the maintainer chose otherwise (2026-11-16): the switcher
 * shows first names, and "Programs ›" is not offered until the program pages exist.
 */
export const PROGRAM_COPY = {
  line: (names: readonly string[]) =>
    `${names.length === 1 ? 'Program' : 'Programs'}: ${names.join(VALUE_JOINER)}`,
  order: 'Program order',
  orderTitle: (athlete: string) => `${athlete}’s programs`,
  orderExplainer:
    'The day page lists these programs’ workouts in this order. Inside a program, workouts follow the order set in its week.',
  moveUp: (program: string) => `Move ${program} up`,
  moveDown: (program: string) => `Move ${program} down`,
  moved: (program: string, place: number, of: number) => `${program} moved to ${place} of ${of}`,
  orderFailed: SAVE_FAILED,
  /** A reorder refused because the athlete's programs changed elsewhere: the page re-reads them. */
  orderStale: `${STALE} Here are the programs now.`,
  done: DAY_COPY.done,
  switcher: 'Switch athlete',
  notYet: 'Not on a program yet. Bodyweight and practice log here.',
  notYetPutOn: (athlete: string) => `Put ${athlete} on a program to see their workouts.`,
  /** The Programs page's own heading, so the link and the page it opens cannot drift. */
  programs: BUILDER_COPY.programs,
  notThisDay: 'Not on a program on this day.',
  /** Every program the athlete is on rests this day. */
  restAll: (day: string) => `Rest day. Nothing is scheduled on ${weekdayName(localWeekday(day))}s.`,
  /** Some programs rest, on a day with two or more. */
  restSome: (programs: readonly string[]) => `Rest day on ${formatList(programs)}.`,
} as const;

/** What the field says when a typed value cannot be sent. The field takes focus. */
export const TYPED_PROBLEM_COPY: Record<TypedProblem, string> = {
  not_a_number: 'Numbers only.',
  out_of_range: 'That number won’t work. Check it.',
  missing: 'Enter a number, then ✓.',
};

/** A refusal as the row shows it. `reload`: the page is out of date, so offer a reload. */
export type RefusalCopy = { message: string; reload: boolean; focusField: boolean };

const UNTICK_FAILED = 'Still logged. Couldn’t un-check; try again.';

/**
 * Every refusal, for a ✓ (`tick`) and for an un-tick (`untick`). `closed_day` is here for
 * completeness; the screen shows it once, at the top, and turns read-only.
 */
export function refusalCopy(reason: RowRefusal, write: RowWriteKind): RefusalCopy {
  switch (reason) {
    case ROW_REFUSAL.retry:
    case ROW_REFUSAL.own_hidden:
      return {
        message: write === 'tick' ? SAVE_FAILED : UNTICK_FAILED,
        reload: false,
        focusField: false,
      };
    case ROW_REFUSAL.bad_value:
      return { message: TYPED_PROBLEM_COPY.out_of_range, reload: false, focusField: true };
    case ROW_REFUSAL.closed_day:
      return { message: DAY_COPY.closed, reload: false, focusField: false };
    case ROW_REFUSAL.not_scheduled:
      return {
        message: 'This workout isn’t scheduled today any more.',
        reload: true,
        focusField: false,
      };
    case ROW_REFUSAL.program_changed:
    case ROW_REFUSAL.not_found:
    case ROW_REFUSAL.slot_taken:
      return { message: STALE, reload: true, focusField: false };
  }
}
