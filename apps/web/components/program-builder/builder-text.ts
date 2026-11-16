import { PROGRAM_REFUSAL, WEEKDAYS, type ProgramRefusal, type ProgramView } from '@mat-plan/shared';

import { formatDayShort } from '@/lib/date';
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
  create: 'Create',
  creating: 'Creating…',
  cancel: 'Cancel',
  programName: 'Program name',
  programNamePlaceholder: 'e.g. Family program',
  severalPrograms: 'A person can be on several programs.',
  rename: 'Rename',
  save: 'Save',
  saving: 'Saving…',
  renamed: 'Program renamed',
  whosOnIt: 'Who’s on it',
  noOneOnIt: 'No one yet.',
  takeOff: 'Take off',
  workouts: 'Workouts',
  noWorkouts: 'No workouts yet.',
  newWorkout: '+ New workout',
  week: 'Week',
  weekIntro: 'Each day runs its workouts in this order. A day with none is a rest day.',
  restDay: 'Rest day',
} as const;

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

/** An athlete's line on the program page: "since Mon, Nov 9 · last day … · also on Stretching". */
export function athleteHint(athlete: ProgramView['athletes'][number], today: string): string {
  const parts = [`${athlete.since > today ? 'starts' : 'since'} ${formatDayShort(athlete.since)}`];
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
  return new Intl.DateTimeFormat('en-US', { weekday: style, timeZone: 'UTC' }).format(
    new Date(Date.UTC(2026, 10, 15 + weekday)),
  );
}

/** "6 items · Used Mon, Tue" or "… · Not on any day yet". */
export function workoutSummary(itemCount: number, usedOn: readonly number[]): string {
  const items = plural(itemCount, { one: '1 item', other: `${itemCount} items` });
  const days = usedOn.length
    ? `Used ${usedOn.map((k) => weekdayName(k, 'short')).join(', ')}`
    : 'Not on any day yet';
  return `${items} · ${days}`;
}

/** Where a copied workout came from: the program's name as it was on the day of the copy. */
export function copiedFromText(from: { programName: string; on: string }): string {
  return `Copied from ${from.programName} · ${formatDayShort(from.on)}`;
}
