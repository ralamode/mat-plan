import { ROW_REFUSAL, type RowRefusal } from '@mat-plan/shared';

import type { TypedProblem } from './row-values';

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
  /** A set-type item before 13b gives it rows: how many of its sets are logged. */
  setsLogged: (count: number) => `${count} logged`,
  /** A row whose prescription left the workout after it was logged (v12, `index.html:2432`). */
  removed: 'No longer in this workout. What was logged stays.',
  /** The whole screen turns read-only after the first `closed_day`. */
  closed: 'Only today and yesterday can be changed.',
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

/** What the field says when a typed value cannot be sent. The field takes focus. */
export const TYPED_PROBLEM_COPY: Record<TypedProblem, string> = {
  not_a_number: 'Numbers only.',
  out_of_range: 'That number won’t work. Check it.',
  missing: 'Enter a number, then ✓.',
};

/** A refusal as the row shows it. `reload`: the page is out of date, so offer a reload. */
export type RefusalCopy = { message: string; reload: boolean; focusField: boolean };

const SAVE_FAILED = 'Couldn’t save. Try again.';
const UNTICK_FAILED = 'Still logged. Couldn’t un-check; try again.';
const STALE = 'This changed since the page loaded.';

/**
 * Every refusal, for a ✓ (`tick`) and for an un-tick (`untick`). `closed_day` is here for
 * completeness; the screen shows it once, at the top, and turns read-only.
 */
export function refusalCopy(reason: RowRefusal, write: 'tick' | 'untick'): RefusalCopy {
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
