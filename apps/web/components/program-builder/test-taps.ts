import { fireEvent } from '@testing-library/react';

/**
 * A click at a given `event.timeStamp` (tests only). The double-tap guards (`DOUBLE_TAP_MS`) compare
 * the taps' own timestamps, so a test that waited in real time between two taps passed or failed
 * by how loaded the machine was: under three suites at once, "straight after" took more than 500ms.
 * Taps at stated times make "the same tap" and "a new tap" exact, and need no sleep.
 *
 * Keep the times well above `performance.now()` in a test run (a `fireEvent.click` tap's own), so a
 * stated tap never reads as earlier than a real one on the same control.
 */
export function tapAt(element: Element, timeStamp: number) {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'timeStamp', { value: timeStamp });
  fireEvent(element, event);
}

/** A clock for a run of taps, each a second apart: no two are the same tap. */
export function tapClock(start = 1e9) {
  let now = start;
  return {
    /** A tap a full second after the last. */
    tap: (element: Element) => tapAt(element, (now += 1000)),
    /** A second tap 100ms after the last: within `DOUBLE_TAP_MS`, so the same tap. */
    again: (element: Element) => tapAt(element, now + 100),
  };
}
