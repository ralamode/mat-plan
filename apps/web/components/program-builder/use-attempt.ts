'use client';

import { useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';

/**
 * One write's attempt, so an answer that arrives for an older one is dropped (FAM-1 lane B: the
 * name forms and the workout editor's Save).
 *
 * `begin()` starts an attempt and returns its number; `isCurrent(n)` says whether that attempt is
 * still the one the screen is waiting on; `cancel()` drops whatever is in flight (Cancel, Escape, a
 * fresh open). Leaving the screen cancels too, so an answer after that never navigates.
 *
 * ⚠️ Dropping the answer does not cancel the write: it may still land (guide invariant 11).
 */
export function useAttempt() {
  const attempt = useRef(0);
  useEffect(
    () => () => {
      attempt.current += 1;
    },
    [],
  );
  return {
    begin: () => ++attempt.current,
    isCurrent: (n: number) => n === attempt.current,
    cancel: () => {
      attempt.current += 1;
    },
  };
}

/**
 * How soon after a tap a second one is taken as the same tap (FAM-1 lane B): the next card's Remove
 * slides up under the thumb, the link control flips to its opposite in place, and the item picker's
 * Add sits where the form's Create was.
 */
export const DOUBLE_TAP_MS = 500;

/** Whether a tap at `at` is the same tap as one at `last` (`event.timeStamp`s; none yet is never). */
export const isSameTap = (last: number | undefined, at: number) =>
  last !== undefined && at - last < DOUBLE_TAP_MS;

/**
 * Applies a change that moves the tapped control, and keeps that control focused and where the thumb
 * is, so a second tap lands on it again. Never under `bar` (a save or status bar pinned to the
 * bottom), which is about to say what the tap did.
 */
export function holdUnderThumb(
  get: () => HTMLElement | undefined,
  apply: () => void,
  bar?: HTMLElement | null,
) {
  const before = get()?.getBoundingClientRect().top ?? 0;
  flushSync(apply);
  const button = get();
  button?.focus({ preventScroll: true });
  const after = button?.getBoundingClientRect().top ?? before;
  if (after !== before) window.scrollBy(0, after - before);
  const barTop = bar?.getBoundingClientRect().top;
  const bottom = button?.getBoundingClientRect().bottom;
  if (barTop !== undefined && bottom !== undefined && bottom > barTop) {
    window.scrollBy(0, bottom - barTop + 8);
  }
}

/** A refused field: focused, and scrolled to the middle, because a phone's keyboard covers the bottom. */
export function focusField(field: HTMLElement | null | undefined) {
  field?.focus();
  field?.scrollIntoView?.({ block: 'center' });
}
