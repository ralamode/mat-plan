'use client';

import {
  newId,
  ROW_REFUSAL,
  type DayPlan,
  type RowRefusal,
  type RowResult,
  type RowValues,
} from '@mat-plan/shared';
import { useState, type RefObject } from 'react';

import { useDay } from './day-context';
import { DAY_COPY, refusalCopy, TYPED_PROBLEM_COPY } from './day-copy';
import { hasQuantityField, readTyped, sameValues, textOf, type DayItem } from './row-values';

/**
 * One row's ✓, un-tick and re-tick (FAM-1 step 13; plan D13, D20, D24). Step 13's single rows use
 * it; 13b's set rows reuse it per set.
 *
 * **What the row shows** is the page's data (`row.logged`) corrected by what this page visit did:
 * - a ✓ in flight shows as logged at once (optimistic, D24);
 * - a ✓ that succeeded shows its result until the page's data catches up;
 * - an un-tick shows the row empty, keeps the entry's `hiddenAt` token and the old number in the
 *   field, so ✓ with the field unchanged re-ticks the same entry (D20). A changed or emptied field
 *   is a new ✓ instead, because a re-tick restores the old numbers, not the typed ones.
 *
 * **One ✓ attempt, one `clientId`** (day-page.md invariant 5): a retry with the same numbers
 * reuses it; different numbers mint a new one, or the server would answer with the first attempt's
 * numbers (UX panel, step 13).
 *
 * **A rejected promise is a `retry`.** The contract's actions never throw for a refusal, but a
 * dropped connection rejects, and a row left ticked by it would claim a save that never happened.
 */

type Workout = DayPlan['workouts'][number];
type Row = DayItem['rows'][number];
type Logged = { entryPublicId: string; values: RowValues };
type Override =
  ({ kind: 'logged' } & Logged) | ({ kind: 'unticked'; hiddenAt: string | null } & Logged);
type RowError = { message: string; reload: boolean };

const RETRY: RowResult = { ok: false, reason: ROW_REFUSAL.retry };

async function settle(write: () => Promise<RowResult>): Promise<RowResult> {
  try {
    return await write();
  } catch {
    return RETRY;
  }
}

/** A workout's identity on the screen; its frozen name once the workout is purged. */
export function workoutKeyOf(workout: Workout): string {
  return workout.workoutPublicId ?? `name:${workout.name}`;
}

/** An item's identity in its workout: the prescription, or the item once that was removed. */
export function itemKeyOf(item: DayItem): string {
  return item.prescriptionPublicId ?? `item:${item.itemPublicId}`;
}

/** A row's identity on the screen: workout, prescription (or item), set. */
export function rowKeyOf(workout: Workout, item: DayItem, row: Row): string {
  return `${workoutKeyOf(workout)}/${itemKeyOf(item)}/${row.set}`;
}

/** `fieldRef` is the row's number field, which a refusal focuses; the caller owns it. */
export function useRow(
  workout: Workout,
  item: DayItem,
  row: Row,
  fieldRef: RefObject<HTMLInputElement | null>,
) {
  const day = useDay();
  const rowKey = rowKeyOf(workout, item, row);

  const [text, setText] = useState('');
  const [error, setError] = useState<RowError | null>(null);
  const [pending, setPending] = useState<
    { write: 'tick'; shown: RowValues } | { write: 'untick' } | null
  >(null);
  const [override, setOverride] = useState<Override | null>(null);
  const [attempt, setAttempt] = useState<{ clientId: string; values: RowValues } | null>(null);

  const fromPlan = row.logged;
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

  function fail(reason: RowRefusal, write: 'tick' | 'untick') {
    if (reason === ROW_REFUSAL.closed_day) {
      setError(null);
      day.closeDay();
      return;
    }
    const copy = refusalCopy(reason, write);
    setError({ message: copy.message, reload: copy.reload });
    if (write === 'tick') day.setRowFailed(rowKey, true);
    day.announce(DAY_COPY.announce.failed(item.name, copy.message));
    if (copy.focusField) fieldRef.current?.focus();
  }

  function succeed(next: Override | null, message: string) {
    setOverride(next);
    setError(null);
    day.setRowFailed(rowKey, false);
    day.announce(message);
  }

  async function log(values: RowValues, shown: RowValues) {
    const clientId = attempt && sameValues(attempt.values, values) ? attempt.clientId : newId();
    setAttempt({ clientId, values });
    if (!workout.workoutPublicId || !item.prescriptionPublicId) return;
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
      setText('');
      succeed(
        { kind: 'logged', entryPublicId: result.entryPublicId, values: result.values },
        DAY_COPY.announce.logged(item.name),
      );
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
      succeed(
        { kind: 'logged', entryPublicId: result.entryPublicId, values: result.values },
        DAY_COPY.announce.logged(item.name),
      );
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
      setText(textOf(item, result.values));
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
      // Re-tick when nothing new was typed: a Check, a removed prescription, or the same number.
      const read = hasField ? readTyped(item, text) : null;
      const same = !read || (read.ok && !read.empty && sameValues(read.values, unticked.values));
      if (same) return retick(unticked, unticked.hiddenAt);
    }
    if (!canLog) return;
    const read = readTyped(item, text);
    if (!read.ok) {
      setError({ message: TYPED_PROBLEM_COPY[read.problem], reload: false });
      fieldRef.current?.focus();
      return;
    }
    // The un-tick token stays until this ✓ succeeds, so a failed one can still be re-ticked.
    await log(read.values, read.shown);
  }

  return {
    rowKey,
    text,
    setText,
    error,
    logged,
    pending: pending !== null,
    canWrite,
    hasField,
    press,
    reload: day.reload,
  };
}
