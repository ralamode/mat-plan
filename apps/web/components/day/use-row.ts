'use client';

import {
  hasSetRows,
  newId,
  ROW_REFUSAL,
  type DayItem,
  type DayRow,
  type DayWorkout,
  type RowRefusal,
  type RowResult,
  type RowValues,
  type Unit,
} from '@mat-plan/shared';
import { useEffect, useState } from 'react';

import { useDay } from './day-context';
import { DAY_COPY, refusalCopy, TYPED_PROBLEM_COPY } from './day-copy';
import {
  EMPTY_TEXT,
  fieldsOf,
  readTyped,
  sameText,
  sameValues,
  textOf,
  type RowField,
  type RowText,
  type RowWriteKind,
} from './row-values';

/**
 * One row's writes: ✓, un-tick, re-tick and a Change's amend (FAM-1 steps 13, 13b and 13b-ii; plan
 * D13, D20, D24). The same hook serves a single row and each set of a set table; a Change's editing
 * is `use-change.ts`, which calls `amend` here.
 *
 * **What the row shows** is the page's data (`row.logged`) corrected by what this page visit did:
 * - a ✓ in flight shows as logged at once (optimistic, D24);
 * - a ✓ that succeeded shows its result until the page's data catches up;
 * - an un-tick shows the row empty, keeps the entry's `hiddenAt` token and the old number in the
 *   field, so ✓ with the field untouched re-ticks the same entry (D20). A changed or emptied field
 *   is a new ✓ instead, because a re-tick restores the old numbers, not the typed ones.
 *
 * **One ✓ attempt, one `clientId`** (day-page.md invariant 11): a retry with the same numbers
 * reuses it; different numbers mint a new one, or the server would answer with the first attempt's
 * numbers.
 *
 * **A rejected promise is a `retry`.** The contract's actions never throw for a refusal, but a
 * dropped connection rejects, and a row left ticked by it would claim a save that never happened.
 */

type Logged = { entryPublicId: string; values: RowValues };
/**
 * - `logged`: this visit's ✓ or re-tick, until the page's data shows the entry. A ✓ after an
 *   un-tick may answer with the SAME entry id (a writer may revive the hidden entry rather than add one),
 *   so data still showing that entry with the numbers it held before the ✓ (`planValues`) has not
 *   caught up, and the override holds.
 * - `amended`: this visit's Change (13b-ii). An amend keeps the entry's id, so the data showing the
 *   entry is not enough: the override holds until the data shows the amended numbers, or until the
 *   data moves on from what it held at the time (another phone changed the row since).
 * - `unticked`: this visit's un-tick, with the token a re-tick needs. `sawEmpty` records that the
 *   page's data has shown the set empty since: until then, data still showing the entry is data
 *   that has not caught up; after it, the entry shown again (possibly the same id: another phone's
 *   ✓, or this phone's ✓ whose answer was lost) is the truth, and the override ends.
 */
type Override =
  | ({ kind: 'logged'; planValues: RowValues | null } & Logged)
  | ({ kind: 'amended'; planValues: RowValues | null } & Logged)
  | ({ kind: 'unticked'; hiddenAt: string | null; sawEmpty: boolean } & Logged);
/**
 * A row's message.
 * - `counts`: a ✓ that did not save, which the workout counts as "not saved". A number the field
 *   refused before any write was never a save, so it does not count.
 * - `invalid`: the number is the problem, so the field is marked and takes focus; never for
 *   "Couldn't save".
 */
type RowError = {
  message: string;
  reload: boolean;
  counts: boolean;
  invalid: boolean;
  /** The field a refused number is in, so that field is the one marked and focused. */
  field?: RowField;
  /** The write that failed: a Change's message is cleared when its edit is abandoned. */
  write?: RowWriteKind;
};

const RETRY: RowResult = { ok: false, reason: ROW_REFUSAL.retry };

async function settle(write: () => Promise<RowResult>): Promise<RowResult> {
  try {
    return await write();
  } catch {
    return RETRY;
  }
}

/**
 * Whether a row can be written (`canWrite`: ✓, un-tick, re-tick) and logged anew (`canLog`: a new
 * entry needs both ids, so a row whose prescription was removed can only be ticked back). One rule,
 * read by every row and by the set table's "+ Add set".
 */
export function rowAccess(readOnly: boolean, workout: DayWorkout, item: DayItem) {
  const canWrite = !readOnly && workout.scheduled;
  const canLog = canWrite && workout.workoutPublicId !== null && item.prescriptionPublicId !== null;
  return { canWrite, canLog };
}

/**
 * The row's name in sentences and labels: the item, and the set where it is one of several, so a
 * screen reader hears which set was logged.
 */
export function rowName(item: DayItem, row: DayRow): string {
  return hasSetRows(item.trackingType) ? DAY_COPY.setLabel(item.name, row.set) : item.name;
}

/**
 * A workout's identity on the screen. Once the workout is purged it has no id, so its place in the
 * day and its frozen name stand in (two purged workouts may share a name).
 */
export function workoutKeyOf(workout: DayWorkout, index: number): string {
  return workout.workoutPublicId ?? `purged:${index}:${workout.name}`;
}

/** An item's identity in its workout: the prescription, or the item once that was removed. */
export function itemKeyOf(item: DayItem): string {
  return item.prescriptionPublicId ?? `item:${item.itemPublicId}`;
}

/** A row's identity on the screen: workout, prescription (or item), set. */
export function rowKeyOf(workoutKey: string, item: DayItem, row: DayRow): string {
  return `${workoutKey}/${itemKeyOf(item)}/${row.set}`;
}

/** Whether a row key belongs to a workout: the one place that reads the key's format back. */
export function rowIsIn(workoutKey: string, rowKey: string): boolean {
  return rowKey.startsWith(`${workoutKey}/`);
}

export function useRow(workout: DayWorkout, workoutKey: string, item: DayItem, row: DayRow) {
  const day = useDay();
  const rowKey = rowKeyOf(workoutKey, item, row);

  const [text, setTextState] = useState<RowText>(EMPTY_TEXT);
  /**
   * The unit an un-tick filled the quantity field in. 🔴 If the item's unit changes after that, the
   * number is cleared: the field is in the item's unit, and `27.5` filled from lb must never go out
   * as 27.5 kg (a load in the wrong unit is an injury risk).
   */
  const [filledUnit, setFilledUnit] = useState<Unit | null>(null);
  if (filledUnit !== null && filledUnit !== item.unit) {
    setFilledUnit(null);
    setTextState((was) => ({ ...was, quantity: '' }));
  }
  const [error, setError] = useState<RowError | null>(null);
  const [pending, setPending] = useState<
    { write: 'tick'; shown: RowValues } | { write: 'untick' } | { write: 'amend' } | null
  >(null);
  const [override, setOverride] = useState<Override | null>(null);
  const [attempt, setAttempt] = useState<{ clientId: string; values: RowValues } | null>(null);

  const fromPlan = row.logged;
  // When the page's data changes this row (a reload, another phone), an old message no longer
  // describes it.
  const [seenEntry, setSeenEntry] = useState(fromPlan?.entryPublicId ?? null);
  if ((fromPlan?.entryPublicId ?? null) !== seenEntry) {
    setSeenEntry(fromPlan?.entryPublicId ?? null);
    setError(null);
  }
  // Once the page's data shows the entry this visit logged, the data is the truth again.
  if (
    override?.kind === 'logged' &&
    fromPlan?.entryPublicId === override.entryPublicId &&
    (sameValues(fromPlan.values, override.values) ||
      override.planValues === null ||
      !sameValues(fromPlan.values, override.planValues))
  ) {
    setOverride(null);
  }
  // A Change holds until the data shows its numbers, or the data has moved on without them (the
  // entry went, or another phone changed it). Data that has not caught up with this visit's ✓ yet
  // (`planValues` null, nothing in the data) keeps it.
  if (override?.kind === 'amended') {
    const caughtUp =
      fromPlan?.entryPublicId === override.entryPublicId &&
      sameValues(fromPlan.values, override.values);
    const movedOn = fromPlan
      ? fromPlan.entryPublicId !== override.entryPublicId ||
        (override.planValues !== null && !sameValues(fromPlan.values, override.planValues))
      : override.planValues !== null;
    if (caughtUp || movedOn) setOverride(null);
  }
  if (override?.kind === 'unticked') {
    if (!fromPlan && !override.sawEmpty) setOverride({ ...override, sawEmpty: true });
    // Logged again after the data caught up with the un-tick, or another entry: the data is right.
    if (fromPlan && (override.sawEmpty || fromPlan.entryPublicId !== override.entryPublicId)) {
      setOverride(null);
    }
  }
  const unticked =
    override?.kind === 'unticked' &&
    (!fromPlan || fromPlan.entryPublicId === override.entryPublicId)
      ? override
      : null;
  // This visit's own ✓ wins over data that has not caught up with it yet.
  const settled: Logged | null = unticked
    ? null
    : override?.kind === 'logged' || override?.kind === 'amended'
      ? override
      : fromPlan;
  const logged: RowValues | null =
    pending?.write === 'tick'
      ? pending.shown
      : pending?.write === 'untick'
        ? null
        : (settled?.values ?? null);
  /** The entry a Change edits: only once it is stored, so never during a ✓ or an un-tick. */
  const entry: Logged | null =
    pending?.write === 'tick' || pending?.write === 'untick' ? null : settled;

  const { canWrite, canLog } = rowAccess(day.readOnly, workout, item);
  const hasField = canLog && fieldsOf(item).length > 0;
  /** A read-only day shows no message: there is nothing left to retry. */
  const shownError = canWrite ? error : null;
  const notSaved = shownError?.counts === true;

  // The workout's "N not saved" counts this row while its ✓ has failed, and stops when the row
  // succeeds, is reloaded, goes read-only or leaves the page.
  const { setRowFailed } = day;
  useEffect(() => {
    if (!notSaved) return;
    setRowFailed(rowKey, true);
    return () => setRowFailed(rowKey, false);
  }, [notSaved, rowKey, setRowFailed]);

  /** Typing over a refused number clears the refusal: the field is being fixed. */
  function setText(field: RowField, next: string) {
    setTextState((was) => ({ ...was, [field]: next }));
    // A number typed now is in the item's unit as it is now.
    if (field === 'quantity') setFilledUnit(null);
    if (error?.invalid) setError(null);
  }

  function showError(next: RowError) {
    setError(next);
    day.announce(DAY_COPY.announce.failed(rowName(item, row), next.message));
  }

  /**
   * A Change (13b-ii): sends the row's new numbers for the stored entry and answers with the result,
   * so `use-change.ts` says what happened. `closed_day` turns the page read-only here, as for a ✓.
   */
  async function amend(values: RowValues): Promise<RowResult> {
    const target = entry;
    const write = day.actions.amendRow;
    if (!target || !write || pending) return RETRY;
    setPending({ write: 'amend' });
    const result = await settle(() =>
      write({ profilePublicId: day.profilePublicId, entryPublicId: target.entryPublicId, values }),
    );
    setPending(null);
    if (result.ok) {
      setOverride(storedFrom(result, 'amended'));
      setError(null);
    } else if (result.reason === ROW_REFUSAL.closed_day) {
      closeDay();
    }
    return result;
  }

  /** A `closed_day` from any write: the page turns read-only, and the row's message goes. */
  function closeDay() {
    setError(null);
    day.closeDay();
  }

  function fail(reason: RowRefusal, write: RowWriteKind) {
    if (reason === ROW_REFUSAL.closed_day) return closeDay();
    const copy = refusalCopy(reason, write);
    showError({
      message: copy.message,
      reload: copy.reload,
      counts: write === 'tick',
      invalid: copy.focusField,
    });
  }

  function succeed(next: Override, message: string) {
    setOverride(next);
    setError(null);
    day.announce(message);
  }

  /** What a write stored, held until the page's data shows it (`logged`, or `amended`). */
  function storedFrom(
    result: RowResult & { ok: true },
    kind: 'logged' | 'amended' = 'logged',
  ): Override {
    return {
      kind,
      entryPublicId: result.entryPublicId,
      values: result.values,
      planValues: fromPlan?.values ?? null,
    };
  }

  async function log(values: RowValues, shown: RowValues) {
    if (!workout.workoutPublicId || !item.prescriptionPublicId) return;
    const clientId = attempt && sameValues(attempt.values, values) ? attempt.clientId : newId();
    setAttempt({ clientId, values });
    setPending({ write: 'tick', shown });
    const result = await settle(() =>
      day.actions.logRow({
        clientId,
        profilePublicId: day.profilePublicId,
        day: day.day,
        workoutPublicId: workout.workoutPublicId!,
        prescriptionPublicId: item.prescriptionPublicId!,
        set: row.set,
        values,
      }),
    );
    setPending(null);
    if (result.ok) {
      setAttempt(null);
      setTextState(EMPTY_TEXT);
      succeed(storedFrom(result), DAY_COPY.announce.logged(rowName(item, row)));
      return;
    }
    // A `clientId` refused as `own_hidden` is not sent again: the next try mints a new one.
    if (result.reason === ROW_REFUSAL.own_hidden) setAttempt(null);
    fail(result.reason, 'tick');
  }

  async function retick(token: Override & { kind: 'unticked' }, hiddenAt: string) {
    setPending({ write: 'tick', shown: token.values });
    const result = await settle(() =>
      day.actions.retickRow({
        profilePublicId: day.profilePublicId,
        day: day.day,
        entryPublicId: token.entryPublicId,
        hiddenAt,
      }),
    );
    setPending(null);
    if (result.ok) {
      setTextState(EMPTY_TEXT);
      succeed(storedFrom(result), DAY_COPY.announce.logged(rowName(item, row)));
      return;
    }
    // The token is gone (a reload would show the row empty): log it as a new ✓ instead.
    if (result.reason === ROW_REFUSAL.not_found && canLog) {
      await log(token.values, token.values);
      return;
    }
    fail(result.reason, 'tick');
  }

  async function untick(entry: Logged) {
    setPending({ write: 'untick' });
    const result = await settle(() =>
      day.actions.untickRow({
        profilePublicId: day.profilePublicId,
        day: day.day,
        entryPublicId: entry.entryPublicId,
      }),
    );
    setPending(null);
    if (result.ok) {
      const kept = textOf(item, result.values);
      setTextState(kept);
      setFilledUnit(kept.quantity === '' ? null : item.unit);
      setAttempt(null);
      succeed(
        {
          kind: 'unticked',
          entryPublicId: result.entryPublicId,
          values: result.values,
          hiddenAt: result.hiddenAt ?? null,
          sawEmpty: false,
        },
        DAY_COPY.announce.unticked(rowName(item, row)),
      );
      return;
    }
    fail(result.reason, 'untick');
  }

  async function press() {
    if (pending || !canWrite) return;
    if (settled) return untick(settled);

    if (unticked?.hiddenAt) {
      // Re-tick when nothing new was typed: no field (a Check, a removed prescription), the field
      // untouched since the un-tick, or the same number typed again in the same unit.
      const kept = textOf(item, unticked.values);
      const untouched = !hasField || sameText(text, kept);
      const read = hasField ? readTyped(item, text) : null;
      const same = read?.ok && !read.empty && sameValues(read.values, unticked.values);
      if (untouched || same) return retick(unticked, unticked.hiddenAt);
    }
    if (!canLog) return;
    const read = readTyped(item, text);
    if (!read.ok) {
      showError({
        message: TYPED_PROBLEM_COPY[read.problem],
        reload: false,
        counts: false,
        invalid: true,
        field: read.field,
      });
      return;
    }
    // The un-tick token stays until this ✓ succeeds, so a failed one can still be re-ticked.
    await log(read.values, read.shown);
  }

  return {
    text,
    setText,
    error: shownError,
    logged,
    /** An un-ticked row with no field (a Check, a removed prescription) still shows what it held. */
    kept: !hasField && !logged && unticked ? unticked.values : null,
    pending: pending !== null,
    /** The stored entry, for Change; `null` while a ✓ or un-tick is in flight. */
    entry,
    amend,
    /** A message from a Change (13b-ii), shown in the row's message slot. */
    showError,
    clearError: () => setError(null),
    canWrite,
    hasField,
    press,
    /** Reload clears this row's message: the page's data is about to say what is true. */
    reload: () => {
      setError(null);
      day.reload();
    },
  };
}
