import type { RoutineItem } from '@mat-plan/shared';

/**
 * Pure transforms for the coach routine builder (V1-18 PR 2). The client `<RoutineEditor>` holds the
 * in-routine activities as an ordered list of `RoutineItem`s (`{ key, conditional? }`); these compute the
 * next array immutably (never mutate the argument). Extracted + colocated-tested per the
 * `strength-form-supersets` idiom, since the async client form itself is only reachable via Playwright.
 *
 * The opaque `conditional` marker is PRESERVED through every transform — it's the V1-10 down-payment
 * (`resolveRoutine`/the seed carry it), so silently stripping it on an unrelated edit would defeat it.
 * Reorders are adjacent swaps, so the whole item (marker included) rides along untouched.
 */

/** Toggle a catalog key in/out of the routine. Absent → APPEND `{ key }` at the end (the coach then
 *  reorders with ▲▼); present → remove it. Never introduces a duplicate (append only when absent). */
export function toggle(order: readonly RoutineItem[], key: string): RoutineItem[] {
  return order.some((item) => item.key === key)
    ? order.filter((item) => item.key !== key)
    : [...order, { key }];
}

/** Move the item at `index` one step earlier. No-op (returns a copy) at the top or out of range. */
export function moveUp(order: readonly RoutineItem[], index: number): RoutineItem[] {
  const next = [...order];
  if (index <= 0 || index >= next.length) return next;
  [next[index - 1], next[index]] = [next[index]!, next[index - 1]!];
  return next;
}

/** Move the item at `index` one step later. No-op (returns a copy) at the bottom or out of range. */
export function moveDown(order: readonly RoutineItem[], index: number): RoutineItem[] {
  const next = [...order];
  if (index < 0 || index >= next.length - 1) return next;
  [next[index], next[index + 1]] = [next[index + 1]!, next[index]!];
  return next;
}
