'use client';

import { slotLabelSchema, type ProgramView, type Weekday } from '@mat-plan/shared';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { INPUT_CLASS } from '@/lib/constants';

import { addOnLabel, alreadyOnText, BUILDER_COPY, PENDING_CLASS, WEEK_COPY } from '../builder-text';
import { FieldLabel } from '../field-label';
import { focusField } from '../use-attempt';
import { DaysLabelFields } from './days-label-fields';
import { daysWith, type Slot, type Week } from './week-draft';

/** The workout select's id on a day: the editor focuses it in the tap that opens the form. */
const addFormId = (day: Weekday) => `week-add-${day}`;
export const addWorkoutId = (day: Weekday) => `${addFormId(day)}-workout`;

/**
 * "+ Add" on a day, opened under it (FAM-1 step 10; the prototype's inline form): a workout, an
 * optional label, the days it goes on.
 *
 * - **The workout has no default** unless exactly one workout is not on this day yet: the first in
 *   the list is usually on every day already (Daily Five), and Add would then do nothing.
 * - Workouts already on this day say so in the list.
 * - Add is inactive until a workout is chosen; with no day left to take it, it says so here.
 */
export function AddForm({
  day,
  workouts,
  week,
  onAdd,
  onCancel,
}: {
  day: Weekday;
  workouts: ProgramView['workouts'];
  week: Week;
  onAdd: (slot: Slot, days: Weekday[]) => void;
  onCancel: () => void;
}) {
  const onThisDay = new Set(week[day].map((slot) => slot.workoutPublicId));
  const free = workouts.filter((w) => !onThisDay.has(w.workoutPublicId));
  const [workout, setWorkout] = useState(free.length === 1 ? free[0]!.workoutPublicId : '');
  const [label, setLabel] = useState('');
  const [days, setDays] = useState<Set<Weekday>>(() => new Set([day]));
  const [error, setError] = useState<string | null>(null);
  const [workoutError, setWorkoutError] = useState<string | null>(null);
  const [labelError, setLabelError] = useState<string | null>(null);
  const hasIt = workout ? daysWith(week, workout) : new Set<Weekday>();
  // Every ticked day, the "has it" ones included: they are skipped and the message says so.
  const ticked = [...new Set([...days, ...hasIt])];
  const fresh = ticked.filter((d) => !hasIt.has(d));
  const prefix = addFormId(day);
  const workoutErrorId = `${addWorkoutId(day)}-error`;

  return (
    <form
      className="flex flex-col gap-3 rounded-lg border p-3"
      aria-label={addOnLabel(day)}
      onSubmit={(event) => {
        event.preventDefault();
        if (!workout) {
          setWorkoutError(WEEK_COPY.chooseWorkout);
          return focusField(document.getElementById(addWorkoutId(day)));
        }
        // The endpoint's own rule, so a label it would refuse never costs the week.
        const parsed = slotLabelSchema.safeParse(label);
        if (!parsed.success) {
          setLabelError(WEEK_COPY.labelInvalid);
          return focusField(document.getElementById(`${prefix}-label`));
        }
        if (!fresh.length) return setError(WEEK_COPY.pickADay);
        onAdd({ workoutPublicId: workout, label: parsed.data }, ticked);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onCancel();
        }
      }}
    >
      <div className="flex flex-col gap-1">
        <FieldLabel htmlFor={addWorkoutId(day)}>{WEEK_COPY.workout}</FieldLabel>
        <select
          id={addWorkoutId(day)}
          value={workout}
          onChange={(event) => {
            setWorkout(event.target.value);
            setError(null);
            setWorkoutError(null);
          }}
          aria-invalid={workoutError ? true : undefined}
          aria-describedby={workoutError ? workoutErrorId : undefined}
          className={`${INPUT_CLASS} w-full min-w-0`}
        >
          <option value="" disabled>
            {WEEK_COPY.chooseWorkout}
          </option>
          {workouts.map((w) => (
            <option key={w.workoutPublicId} value={w.workoutPublicId}>
              {onThisDay.has(w.workoutPublicId) ? alreadyOnText(w.name, day) : w.name}
            </option>
          ))}
        </select>
        {workoutError ? (
          <p id={workoutErrorId} className="text-destructive text-sm">
            {workoutError}
          </p>
        ) : null}
      </div>
      <DaysLabelFields
        idPrefix={prefix}
        label={label}
        onLabel={(next) => {
          setLabel(next);
          setLabelError(null);
        }}
        labelError={labelError}
        days={days}
        onDays={(next) => {
          setDays(next);
          setError(null);
        }}
        hasIt={hasIt}
        daysError={error}
      />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          {BUILDER_COPY.cancel}
        </Button>
        <Button type="submit" className={PENDING_CLASS} aria-disabled={!workout || undefined}>
          {WEEK_COPY.addButton}
        </Button>
      </div>
    </form>
  );
}
