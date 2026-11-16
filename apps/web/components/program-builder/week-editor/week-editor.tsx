'use client';

import {
  localWeekday,
  MONDAY_FIRST,
  SLOT_LABEL_MAX,
  type ProgramActions,
  type ProgramView,
  type Weekday,
} from '@mat-plan/shared';
import { Fragment, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

import { Button } from '@/components/ui/button';
import { FOCUS_TARGET_CLASS, NAME_WRAP_CLASS } from '@/lib/constants';
import { cn } from '@/lib/utils';

import {
  addedOnText,
  addOnLabel,
  BUILDER_COPY,
  EDITOR_COPY,
  labelSetText,
  moveOnLabel,
  movedOnText,
  PENDING_CLASS,
  removedFromText,
  removedRowText,
  removeFromLabel,
  restoredText,
  WEEK_COPY,
  weekdayName,
  weekRefusal,
} from '../builder-text';
import { NameField } from '../name-field';
import type { StatusTone } from '../status-line';
import { DOUBLE_TAP_MS } from '../use-attempt';
import { AddForm, addWorkoutId } from './add-form';
import { addToDays, moveSlot, removeSlot, setLabel, type Week } from './week-draft';

const HEADING_ID = 'program-week';

/** A slot's control, keyed by the day and the workout (a workout is on a day at most once). */
type Control = 'up' | 'down' | 'remove' | 'text' | 'undo';
const controlKey = (day: Weekday, workout: string, control: Control) =>
  `${day}:${workout}:${control}`;

/**
 * A program's week, edited in place (FAM-1 step 10; plan §8 "Program page"; the prototype's Week
 * section). Each day: its workouts in order, each with ↑ ↓ ✕ and its label; "+ Add" opens a form
 * under the day.
 *
 * - **Every change saves at once** (no Save on this page), sending the whole week (`saveWeek`).
 *   The change shows at once; one save is in flight at a time, and a change made meanwhile is sent
 *   when it returns (only the newest week matters on a full-state contract). A refused save puts
 *   the week back as the server last had it and says why.
 * - **It renders the page's week**, holding its own copy only while a save is in flight: a week
 *   another write changed (10b's Copy, another parent) is what shows next. **The last change wins**
 *   _(maintainer, 2026-11-16)_: there is no version check, and a refusal that can only mean a
 *   stale page (`once_per_day`, `not_found`) says "This week changed. Reload".
 * - **Remove leaves "… removed · Undo" in its place** until the next change _(maintainer,
 *   2026-11-16)_: a removal reaches every athlete at once and this page has no Cancel. Nothing
 *   slides under the thumb.
 * - **A slot's label is edited by tapping its text** _(maintainer, 2026-11-16)_.
 * - Messages go to the page's status bar, which stays in view (`program-screen.tsx`).
 */
export function WeekEditor({
  program,
  saveWeek,
  onStatus,
}: {
  program: ProgramView;
  saveWeek: ProgramActions['saveWeek'];
  onStatus: (message: string, tone?: StatusTone) => void;
}) {
  const [overlay, setOverlay] = useState<Week | null>(null);
  const [saving, setSaving] = useState(false);
  // A new week from the page replaces the editor's own copy, unless a save is still out.
  const [seen, setSeen] = useState(program.week);
  if (program.week !== seen) {
    setSeen(program.week);
    if (!saving) setOverlay(null);
  }
  const week = overlay ?? program.week;

  const [openDay, setOpenDay] = useState<Weekday | null>(null);
  const [removed, setRemoved] = useState<{
    day: Weekday;
    index: number;
    workout: string;
    before: Week;
    at: number;
  } | null>(null);
  const [editing, setEditing] = useState<{ day: Weekday; workout: string; value: string } | null>(
    null,
  );
  const inFlight = useRef(false);
  const queued = useRef<Week | null>(null);
  const controls = useRef(new Map<string, HTMLElement>());
  const addButtons = useRef(new Map<Weekday, HTMLButtonElement>());
  const lastRemoveAt = useRef(0);

  const names = new Map(program.workouts.map((w) => [w.workoutPublicId, w.name]));
  const nameOf = (workout: string) => names.get(workout) ?? '';
  const today = localWeekday(program.today) as Weekday;
  const control = (day: Weekday, workout: string, which: Control) =>
    controls.current.get(controlKey(day, workout, which));

  async function send(next: Week) {
    if (inFlight.current) {
      queued.current = next;
      return;
    }
    inFlight.current = true;
    setSaving(true);
    let toSend: Week | null = next;
    while (toSend) {
      const result = await saveWeek({ programPublicId: program.programPublicId, days: toSend });
      if (!result.ok) {
        queued.current = null;
        inFlight.current = false;
        setSaving(false);
        setOverlay(null);
        setRemoved(null);
        onStatus(weekRefusal(result.reason), 'alert');
        return;
      }
      toSend = queued.current;
      queued.current = null;
    }
    inFlight.current = false;
    setSaving(false);
  }

  /** Shows `next` at once, says `message`, and saves it. Any other change ends a pending Undo. */
  function change(next: Week, message: string, keepRemoved = false) {
    flushSync(() => {
      setOverlay(next);
      if (!keepRemoved) setRemoved(null);
    });
    onStatus(message);
    void send(next);
  }

  function move(day: Weekday, index: number, direction: 'up' | 'down') {
    const slot = week[day][index]!;
    const at = direction === 'up' ? index === 0 : index === week[day].length - 1;
    if (at)
      return onStatus(direction === 'up' ? EDITOR_COPY.alreadyFirst : EDITOR_COPY.alreadyLast);
    // The same button, held where the thumb is, so a second tap moves it again.
    const before = control(day, slot.workoutPublicId, direction)?.getBoundingClientRect().top ?? 0;
    change(
      moveSlot(week, day, index, direction),
      movedOnText(nameOf(slot.workoutPublicId), direction, day),
    );
    const button = control(day, slot.workoutPublicId, direction);
    button?.focus({ preventScroll: true });
    const after = button?.getBoundingClientRect().top ?? before;
    if (after !== before) window.scrollBy(0, after - before);
  }

  function remove(day: Weekday, index: number, at: number) {
    if (lastRemoveAt.current && at - lastRemoveAt.current < DOUBLE_TAP_MS) return;
    lastRemoveAt.current = at;
    const slot = week[day][index]!;
    const before = week;
    flushSync(() => setRemoved({ day, index, workout: slot.workoutPublicId, before, at }));
    change(removeSlot(week, day, index), removedFromText(nameOf(slot.workoutPublicId), day), true);
    control(day, slot.workoutPublicId, 'undo')?.focus();
  }

  function undo(at: number) {
    if (!removed) return;
    // The ✕ sat where Undo is: a double tap on ✕ is not an Undo.
    if (at - removed.at < DOUBLE_TAP_MS) return;
    const { day, workout, before } = removed;
    change(before, restoredText(nameOf(workout), day));
    control(day, workout, 'remove')?.focus();
  }

  function openAdd(day: Weekday) {
    flushSync(() => setOpenDay(day));
    document.getElementById(addWorkoutId(day))?.focus();
  }

  function closeAdd(day: Weekday) {
    flushSync(() => setOpenDay(null));
    addButtons.current.get(day)?.focus();
  }

  function saveLabel() {
    if (!editing) return;
    const { day, workout, value } = editing;
    const index = week[day].findIndex((slot) => slot.workoutPublicId === workout);
    const label = value.trim() || null;
    flushSync(() => setEditing(null));
    if (index >= 0 && week[day][index]!.label !== label) {
      change(setLabel(week, day, index, label), labelSetText(nameOf(workout), day, label));
    }
    control(day, workout, 'text')?.focus();
  }

  function cancelLabel() {
    if (!editing) return;
    const { day, workout } = editing;
    flushSync(() => setEditing(null));
    control(day, workout, 'text')?.focus();
  }

  const ref = (key: string) => (node: HTMLElement | null) => {
    if (node) controls.current.set(key, node);
    else controls.current.delete(key);
  };

  return (
    <section aria-labelledby={HEADING_ID} className="flex flex-col gap-3">
      <h2 id={HEADING_ID} className="text-lg font-semibold">
        {BUILDER_COPY.week}
      </h2>
      <p className="text-muted-foreground text-sm">
        {WEEK_COPY.intro} {WEEK_COPY.savesAsYouGo}
      </p>
      {program.workouts.length ? null : (
        <p className="text-muted-foreground text-sm">{WEEK_COPY.noWorkouts}</p>
      )}
      <div className="flex flex-col divide-y">
        {MONDAY_FIRST.map((day) => {
          const slots = week[day];
          const pendingUndo = removed?.day === day ? removed : null;
          return (
            <div key={day} className="flex flex-col gap-2 py-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-semibold">
                  {weekdayName(day)}
                  {day === today ? (
                    <span className="text-muted-foreground font-normal"> · {WEEK_COPY.today}</span>
                  ) : null}
                </h3>
                {program.workouts.length && openDay !== day ? (
                  <Button
                    ref={(node) => {
                      if (node) addButtons.current.set(day, node);
                      else addButtons.current.delete(day);
                    }}
                    type="button"
                    variant="ghost"
                    className="min-w-11"
                    aria-label={addOnLabel(day)}
                    onClick={() => openAdd(day)}
                  >
                    {WEEK_COPY.add}
                  </Button>
                ) : null}
              </div>
              {slots.length || pendingUndo ? (
                <ul className="flex flex-col gap-1">
                  {slots.map((slot, index) => {
                    const name = nameOf(slot.workoutPublicId);
                    const isEditing =
                      editing?.day === day && editing.workout === slot.workoutPublicId;
                    return (
                      <Fragment key={slot.workoutPublicId}>
                        {/* A slot removed from this place leaves its Undo row here. */}
                        {pendingUndo?.index === index ? (
                          <UndoRow
                            name={nameOf(pendingUndo.workout)}
                            undoRef={ref(controlKey(day, pendingUndo.workout, 'undo'))}
                            onUndo={undo}
                          />
                        ) : null}
                        <li className="flex flex-col gap-2">
                          <div className="flex items-center gap-2">
                            <button
                              ref={ref(controlKey(day, slot.workoutPublicId, 'text'))}
                              type="button"
                              aria-expanded={isEditing}
                              onClick={() =>
                                setEditing({
                                  day,
                                  workout: slot.workoutPublicId,
                                  value: slot.label ?? '',
                                })
                              }
                              className={cn(
                                'flex min-h-11 min-w-0 flex-1 flex-col justify-center rounded-sm text-left',
                                FOCUS_TARGET_CLASS,
                              )}
                            >
                              {/* Its name keeps the visible words; the action is said first. */}
                              <span className="sr-only">{WEEK_COPY.editLabel}: </span>
                              {slot.label ? (
                                <span
                                  className={`text-muted-foreground text-xs font-semibold tracking-wide uppercase ${NAME_WRAP_CLASS}`}
                                >
                                  {slot.label}
                                </span>
                              ) : null}
                              <span className={`text-sm ${NAME_WRAP_CLASS}`}>{name}</span>
                            </button>
                            {(['up', 'down'] as const).map((direction) => (
                              <Button
                                key={direction}
                                ref={ref(controlKey(day, slot.workoutPublicId, direction))}
                                type="button"
                                variant="ghost"
                                className={`min-w-11 ${PENDING_CLASS}`}
                                aria-label={moveOnLabel(direction, name, day)}
                                aria-disabled={
                                  (direction === 'up' ? index === 0 : index === slots.length - 1) ||
                                  undefined
                                }
                                onClick={() => move(day, index, direction)}
                              >
                                <span aria-hidden>{direction === 'up' ? '↑' : '↓'}</span>
                              </Button>
                            ))}
                            <Button
                              ref={ref(controlKey(day, slot.workoutPublicId, 'remove'))}
                              type="button"
                              variant="ghost"
                              // Set apart from ↓, so a missed ↓ is not a removal.
                              className="text-destructive ml-3 min-w-11"
                              aria-label={removeFromLabel(name, day)}
                              onKeyDown={(event) => {
                                if (event.repeat && event.key === 'Enter') event.preventDefault();
                              }}
                              onClick={(event) => remove(day, index, event.timeStamp)}
                            >
                              <span aria-hidden>✕</span>
                            </Button>
                          </div>
                          {isEditing ? (
                            <LabelEditor
                              id={`week-label-${day}-${slot.workoutPublicId}`}
                              value={editing.value}
                              onChange={(value) => setEditing({ ...editing, value })}
                              onSave={saveLabel}
                              onCancel={cancelLabel}
                            />
                          ) : null}
                        </li>
                      </Fragment>
                    );
                  })}
                  {pendingUndo && pendingUndo.index >= slots.length ? (
                    <UndoRow
                      name={nameOf(pendingUndo.workout)}
                      undoRef={ref(controlKey(day, pendingUndo.workout, 'undo'))}
                      onUndo={undo}
                    />
                  ) : null}
                </ul>
              ) : (
                <p className="text-muted-foreground text-sm">{BUILDER_COPY.restDay}</p>
              )}
              {openDay === day ? (
                <AddForm
                  day={day}
                  workouts={program.workouts}
                  week={week}
                  onCancel={() => closeAdd(day)}
                  onAdd={(slot, days) => {
                    const result = addToDays(week, slot, days);
                    flushSync(() => setOpenDay(null));
                    change(
                      result.week,
                      addedOnText(nameOf(slot.workoutPublicId), result.added, result.skipped),
                    );
                    addButtons.current.get(day)?.focus();
                  }}
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** "Heavy A removed · Undo", where the slot was, until the next change. */
function UndoRow({
  name,
  undoRef,
  onUndo,
}: {
  name: string;
  undoRef: (node: HTMLElement | null) => void;
  onUndo: (at: number) => void;
}) {
  return (
    <li className="bg-muted flex min-h-11 items-center gap-2 rounded-lg px-3">
      <span className={`min-w-0 flex-1 text-sm ${NAME_WRAP_CLASS}`}>{removedRowText(name)}</span>
      <Button
        ref={undoRef}
        type="button"
        variant="outline"
        onClick={(event) => onUndo(event.timeStamp)}
      >
        {WEEK_COPY.undo}
      </Button>
    </li>
  );
}

/** A slot's label, edited under it: Save, Cancel, and Escape. */
function LabelEditor({
  id,
  value,
  onChange,
  onSave,
  onCancel,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="flex flex-col gap-2 rounded-lg border p-3"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onCancel();
        }
        if (event.key === 'Enter' && (event.target as HTMLElement).tagName === 'INPUT') {
          event.preventDefault();
          onSave();
        }
      }}
    >
      <NameField
        id={id}
        label={WEEK_COPY.label}
        hint={WEEK_COPY.labelHint}
        value={value}
        max={SLOT_LABEL_MAX}
        placeholder="e.g. Morning"
        onChange={onChange}
        error={null}
        optional
      />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          {BUILDER_COPY.cancel}
        </Button>
        <Button type="button" onClick={onSave}>
          {WEEK_COPY.save}
        </Button>
      </div>
    </div>
  );
}
