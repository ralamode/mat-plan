import {
  PROGRAM_REFUSAL,
  WEEKDAYS,
  type ProgramRefusal,
  type ProgramView,
  type TrackingType,
} from '@mat-plan/shared';

import { formatDayShort } from '@/lib/date';
import { APP_LOCALE } from '@/lib/i18n/locale';
import { formatList, plural } from '@/lib/i18n/plural';

/**
 * The program builder's words, and the small rules that pick between them (FAM-1 lane B). Pure, so
 * each sentence is tested without rendering a screen. The wording is the accepted prototype's
 * (`docs/prototypes/beta-0/index.html`: `vPrograms`, `vProgram`, `usedBy`, `usedOn`, `provText`).
 */
export const BUILDER_COPY = {
  programs: 'Programs',
  home: '← Home',
  backToPrograms: '← Programs',
  noPrograms: 'No programs yet.',
  noOneYet: 'No one yet',
  createProgram: '+ Create a program',
  createProgramForm: 'Create a program',
  create: 'Create',
  creating: 'Creating…',
  cancel: 'Cancel',
  programName: 'Program name',
  programNamePlaceholder: 'e.g. Family program',
  severalPrograms: 'A person can be on several programs.',
  rename: 'Rename',
  save: 'Save',
  renamed: 'Program renamed',
  whosOnIt: 'Who’s on it',
  noOneOnIt: 'No one yet.',
  takeOff: 'Take off',
  takingOff: 'Taking off…',
  workouts: 'Workouts',
  noWorkouts: 'No workouts yet.',
  newWorkout: '+ New workout',
  week: 'Week',
  weekIntro: 'Each day runs its workouts in this order. A day with none is a rest day.',
  restDay: 'Rest day',
} as const;

/**
 * A pending button: `aria-disabled` (a disabled one drops focus to <body>), which `Button` does
 * not style, so it is dimmed here.
 */
export const PENDING_CLASS = 'aria-disabled:opacity-60';

/** What a refused name write says, under the field. */
export function nameRefusal(reason: ProgramRefusal): string {
  switch (reason) {
    case PROGRAM_REFUSAL.name_taken:
      return 'A program with this name already exists.';
    case PROGRAM_REFUSAL.invalid:
      return 'Give the program a name.';
    case PROGRAM_REFUSAL.not_found:
      return 'This program no longer exists.';
    default:
      return 'Couldn’t save. Try again.';
  }
}

/**
 * The line under a program's name. **Everyone on `athletes` counts**, an athlete whose last day is
 * today included: they are on it through today, so an edit now still changes their day.
 */
export function usedByText(athletes: readonly string[]): string {
  if (athletes.length === 0) return 'No one is on this yet. Changes affect no one.';
  const who =
    athletes.length === 1 ? athletes[0] : athletes.length === 2 ? 'both' : `all ${athletes.length}`;
  return `Used by ${formatList(athletes)}. Changes apply to ${who}.`;
}

/**
 * Whether an athlete has started on the program by `today`. One rule for the "since" or "starts"
 * wording and for what Take off does (someone who had not started simply leaves).
 */
export function hasStarted(athlete: { since: string }, today: string): boolean {
  return athlete.since <= today;
}

/**
 * Accessible names that name their subject, so a screen reader's list of buttons tells them
 * apart. The visible word is a prefix of each (WCAG 2.5.3, as `changeLabel` in `lib/constants`).
 */
export const renameLabel = (program: string) => `${BUILDER_COPY.rename} ${program}`;
export const takeOffLabel = (athlete: string) => `${BUILDER_COPY.takeOff} ${athlete}`;
export const takingOffLabel = (athlete: string) => `${BUILDER_COPY.takingOff} ${athlete}`;

/** An athlete's line on the program page: "since Mon, Nov 9 · last day … · also on Stretching". */
export function athleteHint(athlete: ProgramView['athletes'][number], today: string): string {
  const parts = [
    `${hasStarted(athlete, today) ? 'since' : 'starts'} ${formatDayShort(athlete.since)}`,
  ];
  if (athlete.lastDay) parts.push(`last day ${formatDayShort(athlete.lastDay)}`);
  if (athlete.alsoOn.length) parts.push(`also on ${formatList(athlete.alsoOn)}`);
  return parts.join(' · ');
}

/** What Take off says once it worked. Someone who had not started yet simply never starts. */
export function takenOffText(athlete: string, program: string, started: boolean): string {
  return started
    ? `${athlete} comes off ${program} after today. Days already logged keep what they had.`
    : `${athlete} won’t start ${program}.`;
}

export function takeOffFailedText(athlete: string): string {
  return `Couldn’t take ${athlete} off. Try again.`;
}

/**
 * The week in the order the builder shows it: Monday first (`ProgramView.workouts[].usedOn` is
 * listed the same way). ⚠️ The preview's fake keeps its own copy (`app/design/program/fakes.ts`); a
 * shared one belongs in the contract, which this lane does not edit.
 */
export const MONDAY_FIRST = [...WEEKDAYS.slice(1), WEEKDAYS[0]];

/** A weekday's name, from a fixed week that starts on a Sunday (2026-11-15). */
export function weekdayName(weekday: number, style: 'long' | 'short' = 'long'): string {
  return new Intl.DateTimeFormat(APP_LOCALE, { weekday: style, timeZone: 'UTC' }).format(
    new Date(Date.UTC(2026, 10, 15 + weekday)),
  );
}

/** "6 items · Used Mon, Tue" or "… · Not on any day yet". */
export function workoutSummary(itemCount: number, usedOn: readonly number[]): string {
  const items = plural(itemCount, { one: '1 item', other: `${itemCount} items` });
  const days = usedOn.length
    ? `Used ${formatList(
        usedOn.map((k) => weekdayName(k, 'short')),
        APP_LOCALE,
        'unit',
      )}`
    : 'Not on any day yet';
  return `${items} · ${days}`;
}

/** Where a copied workout came from: the program's name as it was on the day of the copy. */
export function copiedFromText(from: { programName: string; on: string }): string {
  return `Copied from ${from.programName} · ${formatDayShort(from.on)}`;
}

/** The workout editor's words (FAM-1 step 8; the prototype's `vWorkout`). */
export const EDITOR_COPY = {
  backToProgram: '← Program',
  editWorkout: 'Edit workout',
  newWorkout: 'New workout',
  workoutName: 'Name',
  workoutNamePlaceholder: 'e.g. Heavy A',
  description: 'Description',
  items: 'Items',
  noItems: 'No items yet.',
  checkHint: 'Checked off in one tap.',
  sets: 'Sets',
  reps: 'Reps',
  unit: 'Unit',
  instructions: 'Instructions',
  instructionsPlaceholder: 'Shown with the item, every time',
  rest: 'Then rest:',
  up: 'Up',
  down: 'Down',
  remove: 'Remove',
  save: 'Save workout',
  cancel: 'Cancel',
  discardQuestion: 'Discard your changes to this workout?',
  discard: 'Discard',
  keepEditing: 'Keep editing',
  alreadyFirst: 'Already first.',
  alreadyLast: 'Already last.',
  nameTaken: 'A workout with this name is already in this program.',
} as const;

/** What a card's quantity field is called, by the item's type. */
export const QUANTITY_LABELS: Record<TrackingType, string | null> = {
  check: null,
  reps: null,
  weight_reps: 'Weight',
  time_sets: 'Seconds',
  distance: 'Distance',
  duration: 'Minutes',
  count: 'Target',
};

/** Names that tell a card's buttons apart; the visible word comes first (WCAG 2.5.3). */
export const moveLabel = (direction: 'up' | 'down', item: string) =>
  `${direction === 'up' ? EDITOR_COPY.up : EDITOR_COPY.down}: ${item}`;
export const removeLabel = (item: string) => `${EDITOR_COPY.remove} ${item}`;

/** A superset's letter, read out: "A1" is "Superset A, item 1". */
export function supersetSpoken(label: string): string {
  return `Superset ${label[0]}, item ${label.slice(1)}`;
}

export function movedText(item: string, direction: 'up' | 'down', ended: number): string {
  const moved = `${item} moved ${direction}.`;
  return ended
    ? `${moved} ${plural(ended, { one: 'A superset ended', other: `${ended} supersets ended` })}, and its rest with it.`
    : moved;
}

export function removedText(item: string, ended: number): string {
  const removed = `${item} removed. Cancel undoes all changes.`;
  return ended ? `${removed} Its superset ended, and its rest with it.` : removed;
}

/** A unit changed under a typed number: say what the number now means. */
export function unitChangedText(item: string, value: string, from: string, to: string): string {
  return `${item}: now ${value} ${to} (was ${value} ${from}).`;
}

export function fieldsToFixText(count: number): string {
  return plural(count, {
    one: 'One field to fix before saving.',
    other: `${count} fields to fix before saving.`,
  });
}

/** What a refused Save says in the save bar. `name_taken` is said under the name instead. */
export function saveRefusal(reason: ProgramRefusal): string {
  switch (reason) {
    case PROGRAM_REFUSAL.name_taken:
      return EDITOR_COPY.nameTaken;
    case PROGRAM_REFUSAL.invalid:
      return 'Couldn’t save: part of this workout wasn’t accepted. Check it and try again.';
    case PROGRAM_REFUSAL.not_found:
      return 'This workout no longer exists.';
    default:
      return 'Couldn’t save. Try again.';
  }
}
