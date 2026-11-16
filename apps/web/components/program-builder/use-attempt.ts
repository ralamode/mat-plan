'use client';

import { useEffect, useRef } from 'react';

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

/** A refused field: focused, and scrolled to the middle, because a phone's keyboard covers the bottom. */
export function focusField(field: HTMLElement | null | undefined) {
  field?.focus();
  field?.scrollIntoView?.({ block: 'center' });
}
