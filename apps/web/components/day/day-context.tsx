'use client';

import type { DayActions } from '@mat-plan/shared';
import { createContext, useContext } from 'react';

/**
 * What every row of one day shares (FAM-1 step 13): who and when, the actions, whether the day can
 * be written, and the screen's one live region and failure count.
 *
 * Provided by `DayScreen` under a key of athlete and day, so nothing a row holds (typed text, a
 * failure, an un-tick token) survives into another day: the page moves between days with `?d=` and
 * the same workout has the same ids every week (UX panel, step 13).
 */
export type DayContextValue = {
  profilePublicId: string;
  day: string;
  actions: DayActions;
  /** The day cannot be written: not writable, or a write already answered `closed_day`. */
  readOnly: boolean;
  /** Says a sentence in the screen's live region. */
  announce(message: string): void;
  /** A row reports a failed save, or that it has none any more, so its workout can count them. */
  setRowFailed(rowKey: string, failed: boolean): void;
  /** A row reports a write in flight, or none any more, so the page can warn before it is left. */
  setRowPending(rowKey: string, pending: boolean): void;
  /**
   * A row reports work not yet saved that is not a write in flight (a Change typed over, an added
   * set not ticked), or none any more, so its workout does not offer "Collapse" over it (12c-iii).
   */
  setRowBusy(rowKey: string, busy: boolean): void;
  /** The first `closed_day` turns the whole screen read-only. */
  closeDay(): void;
  /** Re-reads the page's data, keeping every row's typed text. */
  reload(): void;
};

export const DayContext = createContext<DayContextValue | null>(null);

export function useDay(): DayContextValue {
  const value = useContext(DayContext);
  if (!value) throw new Error('useDay: a day row rendered outside DayScreen');
  return value;
}
