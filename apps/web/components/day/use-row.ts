'use client';

import {
  newId,
  ROW_REFUSAL,
  type RowRefusal,
  type RowResult,
  type RowValues,
} from '@mat-plan/shared';
import { useEffect, useState } from 'react';

import { useDay } from './day-context';
import { DAY_COPY, refusalCopy, TYPED_PROBLEM_COPY } from './day-copy';
import {
  hasQuantityField,
  readTyped,
  sameValues,
  textOf,
  type DayItem,
  type DayRow,
  type DayWorkout,
  type RowWriteKind,
} from './row-values';

/**
 * One row's ✓, un-tick and re-tick (FAM-1 step 13; plan D13, D20, D24).
 *
 * **The write state machine is what 13b reuses per set.** The field's text and `readTyped` are a
 * single row's (one number); 13b's set rows, which read reps and a load, will pass their own
 * reader, so that part moves out of this hook then.
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
type Override =
  ({ kind: 'logged' } & Logged) | ({ kind: 'unticked'; hiddenAt: string | null } & Logged);
/**
 * A row's message.
 * - `counts`: a ✓ that did not save, which the workout counts as "not saved". A number the field
 *   refused before any write was never a save, so it does not count.
 * - `invalid`: the number is the problem, so the field is marked and takes focus; never for
 *   "Couldn't save".
 */
type RowError = { message: string; reload: boolean; counts: boolean; invalid: boolean };

const RETRY: RowResult = { ok: false, reason: ROW_REFUSAL.retry };

async function settle(write: () => Promise<RowResult>): Promise<RowResult> {
  try {
    return await write();
  } catch {
    return RETRY;
  }
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

  const [text, setTextState] = useState('');
  const [error, setError] = useState<RowError | null>(null);
  const [pending, setPending] = useState<
    { write: 'tick'; shown: RowValues } | { write: 'untick' } | null
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
  if (override?.kind === 'logged' && fromPlan?.entryPublicId === override.entryPublicId) {
    setOverride(null);
  }
  const unticked =
    override?.kind === 'unticked' &&
    (!fromPlan || fromPlan.entryPublicId === override.entryPublicId)
      ? override
      : null;
  // This visit's own ✓ wins over data that has not caught up with it yet.
  const settled: Logged | null = unticked
    ? null
    : override?.kind === 'logged'
      ? override
      : fromPlan;
  const logged: RowValues | null =
    pending?.write === 'tick'
      ? pending.shown
      : pending?.write === 'untick'
        ? null
        : (settled?.values ?? null);

  const canWrite = !day.readOnly && workout.scheduled;
  /** A new entry needs both ids; a row whose prescription was removed can only be ticked back. */
  const canLog = canWrite && workout.workoutPublicId !== null && item.prescriptionPublicId !== null;
  const hasField = canLog && hasQuantityField(item);
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
  function setText(next: string) {
    setTextState(next);
    if (error?.invalid) setError(null);
  }

  function showError(next: RowError) {
    setError(next);
    day.announce(DAY_COPY.announce.failed(item.name, next.message));
  }

  function fail(reason: RowRefusal, write: RowWriteKind) {
    if (reason === ROW_REFUSAL.closed_day) {
      setError(null);
      day.closeDay();
      return;
    }
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

  function loggedFrom(result: RowResult & { ok: true }): Override {
    return { kind: 'logged', entryPublicId: result.entryPublicId, values: result.values };
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
      setTextState('');
      succeed(loggedFrom(result), DAY_COPY.announce.logged(item.name));
      return;
    }
    // A `clientId` held by a hidden entry answers `own_hidden` forever: the next try is a new one.
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
      setTextState('');
      succeed(loggedFrom(result), DAY_COPY.announce.logged(item.name));
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
      setTextState(textOf(item, result.values));
      setAttempt(null);
      succeed(
        {
          kind: 'unticked',
          entryPublicId: result.entryPublicId,
          values: result.values,
          hiddenAt: result.hiddenAt ?? null,
        },
        DAY_COPY.announce.unticked(item.name),
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
      const untouched = !hasField || text === textOf(item, unticked.values);
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
