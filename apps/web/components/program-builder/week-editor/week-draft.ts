import type { ProgramView, Weekday } from '@mat-plan/shared';

import type { MoveDirection } from '../builder-text';

/** A week as the contract carries it: for each weekday (0 = Sunday), its slots in order. */
export type Week = ProgramView['week'];
export type Slot = Week[Weekday][number];

/**
 * The week editor's changes, as pure functions over a whole week (FAM-1 step 10). Each returns a
 * new week; the editor sends it whole with `saveWeek` (the contract's full-state shape).
 */

/** The days in `days` that already have `workoutPublicId`: a workout runs at most once a day. */
export function daysWith(week: Week, workoutPublicId: string): Set<Weekday> {
  const days = new Set<Weekday>();
  for (const [day, slots] of Object.entries(week)) {
    if (slots.some((slot) => slot.workoutPublicId === workoutPublicId))
      days.add(Number(day) as Weekday);
  }
  return days;
}

/**
 * Puts a workout on each chosen day that does not have it yet, at the end of that day's list, and
 * says which days took it and which were skipped (the plan's "skip message").
 */
export function addToDays(
  week: Week,
  slot: Slot,
  days: readonly Weekday[],
): { week: Week; added: Weekday[]; skipped: Weekday[] } {
  const have = daysWith(week, slot.workoutPublicId);
  const added = days.filter((day) => !have.has(day));
  const skipped = days.filter((day) => have.has(day));
  const next = { ...week };
  for (const day of added) next[day] = [...week[day], slot];
  return { week: next, added, skipped };
}

/** Moves the slot at `index` one place up or down within its day; the same week at an end. */
export function moveSlot(week: Week, day: Weekday, index: number, direction: MoveDirection): Week {
  const to = direction === 'up' ? index - 1 : index + 1;
  const slots = week[day];
  if (to < 0 || to >= slots.length) return week;
  const next = [...slots];
  [next[index], next[to]] = [next[to]!, next[index]!];
  return { ...week, [day]: next };
}

/**
 * Puts a slot back on its day at `index` (or at the end, if the day is shorter now): Undo, applied
 * to the week as it is NOW, so a change that arrived since is kept. The same week if the day has it.
 */
export function insertSlot(week: Week, day: Weekday, index: number, slot: Slot): Week {
  if (week[day].some((s) => s.workoutPublicId === slot.workoutPublicId)) return week;
  const next = [...week[day]];
  next.splice(Math.min(index, next.length), 0, slot);
  return { ...week, [day]: next };
}

/** Takes the slot at `index` off its day. */
export function removeSlot(week: Week, day: Weekday, index: number): Week {
  return { ...week, [day]: week[day].filter((_, i) => i !== index) };
}

/** Sets the label of the slot at `index`; blank is no label. */
export function setLabel(week: Week, day: Weekday, index: number, label: string | null): Week {
  return {
    ...week,
    [day]: week[day].map((slot, i) => (i === index ? { ...slot, label: label || null } : slot)),
  };
}
