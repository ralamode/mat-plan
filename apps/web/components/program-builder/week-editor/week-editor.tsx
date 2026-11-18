'use client';

import {
  localWeekday,
  MONDAY_FIRST,
  PROGRAM_REFUSAL,
  slotLabelSchema,
  type ProgramActions,
  type ProgramResult,
  type ProgramView,
  type Weekday,
} from '@mat-plan/shared';
import { useRouter } from 'next/navigation';
import { Fragment, useEffect, useRef, useState, type RefObject } from 'react';
import { flushSync } from 'react-dom';

import { Button } from '@/components/ui/button';
import { FOCUS_TARGET_CLASS, NAME_WRAP_CLASS } from '@/lib/constants';
import { cn } from '@/lib/utils';

import {
  addedOnText,
  addOnLabel,
  BUILDER_COPY,
  dayFullText,
  dayIsFull,
  EDITOR_COPY,
  isStaleWeek,
  labelSetText,
  moveOnLabel,
  movedOnText,
  type MoveDirection,
  PENDING_CLASS,
  removedFromText,
  removedRowText,
  removeFromLabel,
  restoredText,
  undoLabel,
  WEEK_COPY,
  weekdayName,
  weekRefusal,
} from '../builder-text';
import type { StatusTone } from '../status-line';
import { focusField, holdUnderThumb, isSameTap } from '../use-attempt';
import { AddForm, addWorkoutId } from './add-form';
import { SlotLabelField } from './days-label-fields';
import {
  addToDays,
  insertSlot,
  moveSlot,
  removeSlot,
  setLabel,
  type Slot,
  type Week,
} from './week-draft';

const HEADING_ID = 'program-week';
/** A week's content, to tell the editor's own saves from another write's week. */
const weekKey = (week: Week) => JSON.stringify(MONDAY_FIRST.map((day) => week[day]));
const labelFieldId = (day: Weekday, workout: string) => `week-label-${day}-${workout}`;
const dayFullId = (day: Weekday) => `week-full-${day}`;

/** A slot's control, keyed by the day and the workout (a workout is on a day at most once). */
type Control = MoveDirection | 'remove' | 'text' | 'undo';
const controlKey = (day: Weekday, workout: string, control: Control) =>
  `${day}:${workout}:${control}`;

/**
 * A program's week, edited in place (FAM-1 step 10; plan §8 "Program page"; the prototype's Week
 * section). Each day: its workouts in order, each with ↑ ↓ ✕ and its label; "+ Add" opens a form
 * under the day. Its rules are the guide's invariant 17 (`docs/features/program-builder.md`).
 */
export function WeekEditor({
  program,
  saveWeek,
  onStatus,
  barRef,
}: {
  program: ProgramView;
  saveWeek: ProgramActions['saveWeek'];
  onStatus: (message: string, tone?: StatusTone) => void;
  /** The page's status bar: a moved control is kept clear of it. */
  barRef?: RefObject<HTMLElement | null>;
}) {
  const router = useRouter();
  /**
   * The editor's own week, and the page's week it was made on. It shows while a save is out, and
   * after, until the page's week changes: a week another write changed (10b's Copy, a refresh) is
   * what shows next, even one that arrived while the save was out.
   */
  const [overlay, setOverlay] = useState<{ week: Week; base: Week } | null>(null);
  const [saving, setSaving] = useState(false);
  const week = overlay && (saving || overlay.base === program.week) ? overlay.week : program.week;

  const [openDay, setOpenDay] = useState<Weekday | null>(null);
  // What Undo puts back: the slot, where it was. Not the week before it, which would undo a
  // change that arrived since.
  const [removed, setRemoved] = useState<{
    day: Weekday;
    index: number;
    slot: Slot;
    at: number;
  } | null>(null);
  const [editing, setEditing] = useState<{
    day: Weekday;
    workout: string;
    value: string;
    error: string | null;
  } | null>(null);
  const inFlight = useRef(false);
  const queued = useRef<Week | null>(null);
  const controls = useRef(new Map<string, HTMLElement>());
  const addButtons = useRef(new Map<Weekday, HTMLButtonElement>());
  // A tap on ✕ straight after Undo is the same tap: the restored ✕ sits where Undo was. (Two ✕ in
  // a row need no guard: the Undo row takes the removed slot's place.)
  const lastUndoAt = useRef<number | undefined>(undefined);
  // The slot whose Undo had focus, if a refused save takes its row away.
  const lastRemoved = useRef<{ day: Weekday; workout: string } | null>(null);
  // The page's latest week, for re-basing the editor's own week when its saves are all back.
  const pageWeek = useRef(program.week);
  useEffect(() => {
    pageWeek.current = program.week;
  });

  const names = new Map(program.workouts.map((w) => [w.workoutPublicId, w.name]));
  const nameOf = (workout: string) => names.get(workout) ?? '';
  const today = localWeekday(program.today) as Weekday;
  const control = (day: Weekday, workout: string, which: Control) =>
    controls.current.get(controlKey(day, workout, which));

  /** A save that throws (a dropped connection) is a `retry`, never a stuck queue. */
  async function attempt(days: Week): Promise<ProgramResult> {
    try {
      return await saveWeek({ programPublicId: program.programPublicId, days });
    } catch {
      return { ok: false, reason: PROGRAM_REFUSAL.retry };
    }
  }

  async function send(next: Week) {
    if (inFlight.current) {
      queued.current = next;
      return;
    }
    inFlight.current = true;
    setSaving(true);
    let toSend: Week | null = next;
    const sentWeeks = new Set<string>();
    while (toSend) {
      sentWeeks.add(weekKey(toSend));
      const result = await attempt(toSend);
      if (!result.ok) {
        // A change made on top of the refused week is dropped with it.
        queued.current = null;
        inFlight.current = false;
        flushSync(() => {
          setSaving(false);
          setOverlay(null);
          setRemoved(null);
        });
        // The focused Undo row went with the refusal: focus the slot it put back.
        const lost = lastRemoved.current;
        if (lost && (!document.activeElement || document.activeElement === document.body)) {
          control(lost.day, lost.workout, 'text')?.focus();
        }
        onStatus(weekRefusal(result.reason, toSend), 'alert');
        // The page's week is the stale one: fetch the latest, as the message says.
        if (isStaleWeek(result.reason)) router.refresh();
        return;
      }
      toSend = queued.current;
      queued.current = null;
    }
    inFlight.current = false;
    // Every save is back. A week the page brought meanwhile that is one of the editor's OWN saves
    // (an earlier save's refresh) does not replace the newer change: re-base on it. Any other week
    // (10b's Copy, another parent) is left to show.
    if (sentWeeks.has(weekKey(pageWeek.current))) {
      setOverlay((current) => current && { ...current, base: pageWeek.current });
    }
    setSaving(false);
  }

  /** Puts `next` on screen. Any change but a removal ends a pending Undo. */
  function show(next: Week, keepRemoved = false) {
    setOverlay({ week: next, base: program.week });
    if (!keepRemoved) setRemoved(null);
  }

  /** Says `message` and saves `next`, which is already on screen. */
  function commit(next: Week, message: string) {
    onStatus(message);
    void send(next);
  }

  function change(next: Week, message: string) {
    flushSync(() => show(next));
    commit(next, message);
  }

  function move(day: Weekday, index: number, direction: MoveDirection) {
    const slot = week[day][index]!;
    const at = direction === 'up' ? index === 0 : index === week[day].length - 1;
    if (at)
      return onStatus(direction === 'up' ? EDITOR_COPY.alreadyFirst : EDITOR_COPY.alreadyLast);
    const next = moveSlot(week, day, index, direction);
    holdUnderThumb(
      () => control(day, slot.workoutPublicId, direction),
      () => show(next),
      barRef?.current,
    );
    commit(next, movedOnText(nameOf(slot.workoutPublicId), direction, day));
  }

  function remove(day: Weekday, index: number, at: number) {
    if (isSameTap(lastUndoAt.current, at)) return;
    const slot = week[day][index]!;
    const next = removeSlot(week, day, index);
    lastRemoved.current = { day, workout: slot.workoutPublicId };
    flushSync(() => {
      setRemoved({ day, index, slot, at });
      show(next, true);
    });
    commit(next, removedFromText(nameOf(slot.workoutPublicId), day));
    control(day, slot.workoutPublicId, 'undo')?.focus();
  }

  function undo(at: number) {
    if (!removed) return;
    // The ✕ sat where Undo is: a double tap on ✕ is not an Undo.
    if (isSameTap(removed.at, at)) return;
    // Nor is a double tap on Undo a removal: the restored ✕ sits where Undo was.
    lastUndoAt.current = at;
    const { day, index, slot } = removed;
    change(insertSlot(week, day, index, slot), restoredText(nameOf(slot.workoutPublicId), day));
    control(day, slot.workoutPublicId, 'text')?.focus();
  }

  /** Opens a slot's label under it, focused in the same tap so a phone raises its keyboard. */
  function openLabel(day: Weekday, workout: string, label: string | null) {
    flushSync(() => setEditing({ day, workout, value: label ?? '', error: null }));
    const field = document.getElementById(labelFieldId(day, workout)) as HTMLInputElement | null;
    field?.focus();
    field?.select();
  }

  function openAdd(day: Weekday) {
    // A full day opens no form: the tap says why, and focus stays on "+ Add" (plan §Caps).
    if (dayIsFull(week[day].length)) return onStatus(dayFullText(day));
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
    // The endpoint's own rule, so a label it would refuse never costs the week.
    const parsed = slotLabelSchema.safeParse(value);
    if (!parsed.success) {
      flushSync(() => setEditing({ ...editing, error: WEEK_COPY.labelInvalid }));
      return focusField(document.getElementById(labelFieldId(day, workout)));
    }
    const index = week[day].findIndex((slot) => slot.workoutPublicId === workout);
    const label = parsed.data;
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
      <p className="text-muted-foreground text-sm">{WEEK_COPY.intro}</p>
      {program.workouts.length ? null : (
        <p className="text-muted-foreground text-sm">{WEEK_COPY.noWorkouts}</p>
      )}
      {/* Capped on a wide screen, so ↑ ↓ ✕ stay beside the name they act on. */}
      <div className="flex max-w-2xl flex-col divide-y">
        {MONDAY_FIRST.map((day) => {
          const slots = week[day];
          const pendingUndo = removed?.day === day ? removed : null;
          const full = dayIsFull(slots.length);
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
                    className={`min-w-11 ${PENDING_CLASS}`}
                    aria-label={addOnLabel(day)}
                    aria-disabled={full || undefined}
                    aria-describedby={full ? dayFullId(day) : undefined}
                    onClick={() => openAdd(day)}
                  >
                    {WEEK_COPY.add}
                  </Button>
                ) : null}
              </div>
              {/* Under the header row, never in it: in the row it is ~429px against 328px at 360. */}
              {full ? (
                <p id={dayFullId(day)} className="text-muted-foreground text-sm">
                  {dayFullText(day)}
                </p>
              ) : null}
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
                            name={nameOf(pendingUndo.slot.workoutPublicId)}
                            day={day}
                            undoRef={ref(controlKey(day, pendingUndo.slot.workoutPublicId, 'undo'))}
                            onUndo={undo}
                          />
                        ) : null}
                        <li className="flex flex-col gap-2">
                          <div className="flex items-center gap-2">
                            <button
                              ref={ref(controlKey(day, slot.workoutPublicId, 'text'))}
                              type="button"
                              aria-expanded={isEditing}
                              onClick={() => openLabel(day, slot.workoutPublicId, slot.label)}
                              className={cn(
                                'flex min-h-11 min-w-0 flex-1 flex-col justify-center rounded-sm text-left',
                                FOCUS_TARGET_CLASS,
                              )}
                            >
                              {/* Its name keeps the visible words; the action is said first. */}
                              <span className="sr-only">{WEEK_COPY.editLabel}: </span>
                              {/* The label, or where one goes: what says the text can be tapped. The
                                  pencil is hidden from the button's name. */}
                              {slot.label ? (
                                <span
                                  className={`text-muted-foreground text-xs font-semibold tracking-wide uppercase ${NAME_WRAP_CLASS}`}
                                >
                                  {slot.label}
                                  <span aria-hidden className="ml-1">
                                    ✎
                                  </span>
                                </span>
                              ) : (
                                <span className="text-muted-foreground text-xs">
                                  {WEEK_COPY.addLabel}
                                </span>
                              )}
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
                              id={labelFieldId(day, slot.workoutPublicId)}
                              value={editing.value}
                              error={editing.error}
                              onChange={(value) => setEditing({ ...editing, value, error: null })}
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
                      name={nameOf(pendingUndo.slot.workoutPublicId)}
                      day={day}
                      undoRef={ref(controlKey(day, pendingUndo.slot.workoutPublicId, 'undo'))}
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
  day,
  undoRef,
  onUndo,
}: {
  name: string;
  day: Weekday;
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
        aria-label={undoLabel(name, day)}
        // A held Enter on ✕ lands here: its repeats are not an Undo.
        onKeyDown={(event) => {
          if (event.repeat && event.key === 'Enter') event.preventDefault();
        }}
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
  error,
  onChange,
  onSave,
  onCancel,
}: {
  id: string;
  value: string;
  error: string | null;
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
      <SlotLabelField id={id} label={value} onLabel={onChange} error={error} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          {BUILDER_COPY.cancel}
        </Button>
        <Button type="button" onClick={onSave}>
          {BUILDER_COPY.save}
        </Button>
      </div>
    </div>
  );
}
