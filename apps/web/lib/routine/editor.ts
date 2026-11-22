import type { RoutineItem } from '@mat-plan/shared';

/**
 * Pure transforms for the coach routine builder (V1-18 PR 2). The client `<RoutineEditor>` holds the
 * in-routine activities as an ordered list of `RoutineItem`s (`{ key, conditional? }`); these compute the
 * next array immutably (never mutate the argument). Extracted and colocated-tested, since the async
 * client form itself is only reachable via Playwright. The day page's program-order dialog and the
 * program builder import them too, so this module must not come to depend on the routine catalog.
 *
 * The opaque `conditional` marker is PRESERVED through every transform — it's the V1-10 down-payment
 * (`resolveRoutine`/the seed carry it), so silently stripping it on an unrelated edit would defeat it.
 * Reorders are adjacent swaps, so the whole item (marker included) rides along untouched.
 */

/** Toggle an item in/out of the routine, matched by `key`. Absent → APPEND `item` at the end (the coach
 *  then reorders with ▲▼); present → remove it. Never introduces a duplicate (append only when absent).
 *  Takes the whole `item` (not a bare key) so a re-add can carry the ORIGINAL `conditional` marker: the
 *  caller resolves the item to add from the kid's initial order, so removing then re-adding a seeded
 *  day-conditional activity doesn't silently strip the marker (the V1-10 down-payment). */
export function toggle(order: readonly RoutineItem[], item: RoutineItem): RoutineItem[] {
  return order.some((i) => i.key === item.key)
    ? order.filter((i) => i.key !== item.key)
    : [...order, item];
}

/**
 * Move the item at `index` one step earlier. No-op (returns a copy) at the top or out of range.
 *
 * Generic over the element (FAM-1 step 0b), with `moveDown`: a reorder is an adjacent swap whatever
 * the list holds, so the program builder imports these two for its workout items rather than writing
 * a second pair. The routine editor's calls infer `T = RoutineItem` and are unchanged.
 */
export function moveUp<T>(order: readonly T[], index: number): T[] {
  const next = [...order];
  if (index <= 0 || index >= next.length) return next;
  [next[index - 1], next[index]] = [next[index]!, next[index - 1]!];
  return next;
}

/** Move the item at `index` one step later. No-op (returns a copy) at the bottom or out of range. */
export function moveDown<T>(order: readonly T[], index: number): T[] {
  const next = [...order];
  if (index < 0 || index >= next.length - 1) return next;
  [next[index], next[index + 1]] = [next[index + 1]!, next[index]!];
  return next;
}
