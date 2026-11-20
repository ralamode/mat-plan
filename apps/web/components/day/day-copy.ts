import { localWeekday, ROW_REFUSAL, type DayPlan, type RowRefusal } from '@mat-plan/shared';

import { BUILDER_COPY, weekdayName } from '@/components/program-builder/builder-text';
import { UNDO_LABEL, VALUE_JOINER } from '@/lib/constants';
import { onDayText } from '@/lib/date';
import { formatList, plural } from '@/lib/i18n/plural';

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
  /**
   * H9 (12d-ii): a ✓ refused on an un-ticked row whose load was logged in another unit, after
   * something was typed over it. 🔴 **It asks for no conversion** (plan U1.2): it names what was
   * logged, in words, and the way back (maintainer, orchestrator's chat, 2026-11-19, replacing
   * #644's "This now logs in kg: enter it in kg, then ✓."). `was` is the held value in words
   * ("27.5 pounds"); `to` the item's unit as a word (`''` for a plain count).
   */
  retypeLoad: (was: string, to: string) =>
    `Logged as ${was} before the workout changed to ${to || 'a plain number'}. Clear what you typed and tap ✓ to put it back.`,
  /**
   * 12d-iii (D44, Form 1; the logged line is the UX panel's, approved by the maintainer, 2026-11-18):
   * the line on a row whose quantity was logged in another unit than the item's now. 🔴 **No
   * conversion is ever asked for** (plan U1.2): the load stays as logged, and only whoever edited the
   * unit can fix it. `from` and `to` are the units as words (`pounds`; `''` for a plain count);
   * `noun` names what to fix ("load", "distance", "number").
   *
   * `unticked`: the row was un-ticked this visit, so it says what it held (`was`, "27.5 pounds"),
   * and offers the ✓ only while the ✓ really puts it back (nothing typed over it).
   */
  otherUnit: (
    from: string,
    to: string,
    { noun, unticked }: { noun: string; unticked: { was: string; canPutBack: boolean } | null },
  ) => {
    const changed = `before the workout changed to ${to || 'a plain number'}.`;
    if (unticked) {
      const said = `Logged as ${unticked.was} ${changed}`;
      return unticked.canPutBack ? `${said} Tap ✓ to put it back.` : said;
    }
    return `Logged ${from ? `in ${from}` : 'as a plain number'} ${changed} Ask whoever changed it to fix the ${noun}.`;
  },
  /** What the other-unit line asks to have fixed, by the row's type (12d-iii). */
  otherUnitNoun: { load: 'load', distance: 'distance', number: 'number' },
  done: 'Done',
  doneMark: 'Done ✓',
  lastTime: 'Last time',
  logged: 'Logged',
  reload: 'Reload',
  /** The set table (13b): its column headers, and what an empty Previous says to a screen reader. */
  set: 'Set',
  previous: 'Previous',
  reps: 'Reps',
  /** A number of reps in a sentence: `8 reps`, `1 rep`. */
  repsCount: (count: number) => plural(count, { one: '1 rep', other: `${count} reps` }),
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
  /**
   * The whole screen turns read-only after the first `closed_day`. It says only what happened: the
   * day closed under the page, or the athlete was archived mid-session, and the page's own notice,
   * which the reload brings, gives the reason (maintainer, 2026-11-17; UX panel, 12c). The page's
   * `CLOSED_DAY_NOTICE` ("only today and yesterday") would be false for an archived athlete.
   */
  closed: 'Not saved. This day can’t be logged any more.',
  progress: (done: number, total: number) => `${done} of ${total}`,
  notSaved: (count: number) => `${count} not saved`,
  logLabel: (name: string) => `Log ${name}`,
  fieldLabel: (name: string, unit: string) => (unit ? `${name}, in ${unit}` : name),
  /**
   * Change (13b-ii): the line under a logged row. Every number is printed with its unit or "reps", so
   * the line says which field it means. The maintainer's guards (2026-11-16): Undo returns the number
   * from before the first Change this visit, and a ✕ (cancel) stands in for Escape on a phone.
   */
  change: {
    changed: (from: string, to: string) => `Changed ${from} → ${to}`,
    changedBack: (to: string) => `Changed back to ${to}`,
    notSaved: (was: string) => `Not saved. Was ${was}.`,
    failed: (still: string) => `Couldn’t save. Still ${still}.`,
    undoFailed: (still: string) => `Couldn’t undo. Still ${still}.`,
    kept: {
      missing: (kept: string) => `Kept ${kept}: enter a number to change it.`,
      not_a_number: (kept: string) => `Kept ${kept}: numbers only.`,
      out_of_range: (kept: string, typed: string) => `Kept ${kept}. ${typed} won’t work.`,
    },
    undo: UNDO_LABEL,
    /** A failed save, still typed: send it again. */
    retry: 'Try again',
    /** The ✓'s description while a logged number is being changed: the ✓ saves it. */
    tickSaves: 'The ✓ saves the change.',
  },
  announce: {
    logged: (name: string) => `${name} logged`,
    changed: (name: string, from: string, to: string) => `${name} changed from ${from} to ${to}`,
    changedBack: (name: string, to: string) => `${name} changed back to ${to}`,
    cancelled: (name: string) => `${name}: change cancelled`,
    unticked: (name: string) => `${name} un-checked`,
    failed: (name: string, message: string) => `${name}: ${message}`,
  },
} as const;

/** "Couldn't save. Try again.": a ✓ and a reorder say the same thing when the server refuses. */
const SAVE_FAILED = 'Couldn’t save. Try again.';
const STALE = 'This changed since the page loaded.';
const NOT_FOUND_COPY = 'Not saved. Reload the page.';

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
    `${PROGRAM_COPY.lineLabel(names.length)} ${names.join(VALUE_JOINER)}`,
  /** The line's label alone, for the line whose names are links (15c, D49). */
  lineLabel: (count: number) => `${count === 1 ? 'Program' : 'Programs'}:`,
  order: 'Program order',
  orderTitle: (athlete: string) => `${athlete}’s programs`,
  orderExplainer:
    'The day page lists these programs’ workouts in this order. Inside a program, workouts follow the order set in its week. A program added later goes where it sits in the Programs list.',
  /**
   * The note above the programs that end today (15c, D47; the prototype's words): listed last, no
   * arrows, not counted in "N of M".
   */
  endingNote: (count: number) =>
    count > 1
      ? 'These come off after today, so they are listed last and can’t be moved.'
      : 'This one comes off after today, so it is listed last and can’t be moved.',
  moveUp: (program: string) => `Move ${program} up`,
  moveDown: (program: string) => `Move ${program} down`,
  moved: (program: string, place: number, of: number) => `${program} moved to ${place} of ${of}`,
  orderFailed: SAVE_FAILED,
  /** A reorder refused because the athlete's programs changed elsewhere: the page re-reads them. */
  orderStale: `${STALE} Here are the programs now.`,
  /**
   * The dialog's only body text once nothing stays to order (15c follow-up; maintainer, 2026-11-20):
   * a re-read while it is open took the athlete off every program (`orderEmpty`) or left only
   * programs ending today (`orderAllEnding`). It replaces the explainer and the lists, and wins over
   * `orderStale`.
   */
  orderEmpty: (athlete: string) =>
    `${athlete} isn’t on a program now, so there’s nothing to order.`,
  orderAllEnding: (athlete: string) =>
    `${athlete}’s programs all come off after today, so there’s nothing to order.`,
  /**
   * ⚠️ **Awaiting the maintainer's approval** (15c follow-up). Under Program order when its dialog's
   * code could not be loaded (a dropped connection on the gym floor): the button stays, and a tap
   * tries again. No existing line fits: `orderFailed` says a save failed, and nothing was saved.
   */
  orderOpenFailed: 'Couldn’t open. Try again.',
  done: DAY_COPY.done,
  switcher: 'Switch athlete',
  /**
   * No CURRENT program (`never`): "yet" was false for an athlete taken off their last program, and
   * no fourth state is added for one word (D46; maintainer, 2026-11-19). The key keeps its name.
   */
  notYet: 'Not on a program.',
  /** `notYet`'s second sentence, only on a day that can be logged (maintainer, 2026-11-17). */
  notYetLogHere: 'Bodyweight and practice log here.',
  notYetPutOn: (athlete: string) => `Put ${athlete} on a program to see their workouts.`,
  /** The Programs page's own heading, so the link and the page it opens cannot drift. */
  programs: BUILDER_COPY.programs,
  notThisDay: 'Not on a program on this day.',
  /**
   * Today, for an athlete whose program starts tomorrow (`startsTomorrow`; D46, maintainer,
   * 2026-11-19): after a parent chooses Tomorrow, "not on a program on this day" read as a failure.
   */
  startsTomorrow: 'Starts on a program tomorrow.',
  /**
   * A future day (look-ahead), placed by the page in place of the read-only notice: v12's words
   * (`index.html:2605`; maintainer, 2026-11-17). A day that has not happened is not a missed one.
   */
  comingUp: (athlete: string, day: string) =>
    `Coming up. This is what ${athlete} has on ${weekdayName(localWeekday(day))}s. You can log it on the day.`,
  /** Every program the athlete is on rests this day. */
  restAll: (day: string) => `Rest day. Nothing is scheduled on ${weekdayName(localWeekday(day))}s.`,
  /** Some programs rest, on a day with two or more. */
  restSome: (programs: readonly string[]) => `Rest day on ${formatList(programs)}.`,
  /**
   * The rest lines' twin (`showsOnlyLogged`), on a day that shows only what was logged and has no
   * workouts (maintainer, 2026-11-17). "Workouts", because Bodyweight and Life sit above it with
   * their own "Nothing logged." and may hold a weigh-in or a practice. The day as the page's date
   * line writes it (`onDayText`): a weekday alone is ambiguous months back.
   */
  nothingLogged: (day: string, today: string) => `No workouts logged ${onDayText(day, today)}.`,
} as const;

/** What the field says when a typed value cannot be sent. The field takes focus. */
export const TYPED_PROBLEM_COPY: Record<TypedProblem, string> = {
  not_a_number: 'Numbers only.',
  out_of_range: 'That number won’t work. Check it.',
  missing: 'Enter a number, then ✓.',
  // H9 (12d-ii): the load was logged in another unit, so it is never filled from the plan. The row
  // says it with both units when it can (`DAY_COPY.retypeLoad`); this is the fallback.
  other_unit: 'This was logged in another unit. Enter it again in this one, then ✓.',
};

/**
 * A refusal as the row shows it. `reload`: the page is out of date, so offer a reload. No refusal
 * marks the field: the screen checks every number by the writer's own rule before sending it, so
 * a refused write is never the typed number's fault (UX panel, 12b).
 */
export type RefusalCopy = { message: string; reload: boolean };

const UNTICK_FAILED = 'Still logged. Couldn’t un-check; try again.';
/** A write that can be tried again, by kind; a Change's own line says what is still stored. */
const RETRY_COPY: Record<RowWriteKind, string> = {
  tick: SAVE_FAILED,
  untick: UNTICK_FAILED,
  amend: SAVE_FAILED,
};

/**
 * Every refusal, for a ✓ (`tick`), an un-tick (`untick`) and a Change (`amend`). `closed_day` is here for
 * completeness; the screen shows it once, at the top, and turns read-only.
 */
export function refusalCopy(reason: RowRefusal, write: RowWriteKind): RefusalCopy {
  switch (reason) {
    case ROW_REFUSAL.retry:
    case ROW_REFUSAL.own_hidden:
      return { message: RETRY_COPY[write], reload: false };
    case ROW_REFUSAL.bad_value:
      // A ✓ and a Change are both checked before they are sent, by the writer's own rule
      // (`fillRowValues`, C10), so a refused one means the item changed under the page (its unit,
      // its type): a reload, not the number. Asking for a new number would fail every time, and a
      // Check row has no field to fix (UX panel, 12b).
      return { message: STALE, reload: true };
    case ROW_REFUSAL.closed_day:
      return { message: DAY_COPY.closed, reload: false };
    case ROW_REFUSAL.not_scheduled:
      return {
        message:
          'This workout isn’t scheduled on this day any more. Numbers not saved here will be cleared.',
        reload: true,
      };
    case ROW_REFUSAL.not_found:
      // True for every cause, a lapsed session among them (`noSession` answers `not_found`), where
      // "this changed" blamed the program (maintainer, 2026-11-17; UX panel, 12c).
      return { message: NOT_FOUND_COPY, reload: true };
    case ROW_REFUSAL.program_changed:
    case ROW_REFUSAL.slot_taken:
      return { message: STALE, reload: true };
  }
}
