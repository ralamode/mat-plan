import { ACTIVITY_TYPE_KEYS } from '@mat-plan/shared';

/**
 * V1-7 life activities. Deliberately NOT a registry (the activities are hard-coded; a
 * `checkin-fields.ts`-style derived source earns nothing for N=2). Two things single-sourced:
 *
 *  - `LIFE_ACTIVITIES`, the routine catalog's source (`wake`, `wrestling_practice`);
 *  - `LOGGABLE_LIFE_ACTIVITY_KEYS`, the action's TRUST-BOUNDARY set (never trust the body): practice
 *    only, typed in minutes since V1-24 3b-life-b.
 */
/**
 * The life activities + their labels — the single source the routine catalog maps over AND the
 * action's trust set derives from, so adding one renders a button and is accepted server-side without
 * re-hardcoding the pair in two places. (The action still needs a per-key item-building arm, since the
 * shapes are heterogeneous — wake=timing event, wrestling=duration metric — and that dispatch is
 * exhaustive so an un-armed key fails loudly.)
 */
export const LIFE_ACTIVITIES = [
  { key: ACTIVITY_TYPE_KEYS.wake, label: 'Wake' },
  { key: ACTIVITY_TYPE_KEYS.wrestling_practice, label: 'Wrestling practice' },
] as const;

/** Every life activity's key, derived (one source): the routine catalog reads it (`catalog.ts`). */
export const LIFE_ACTIVITY_KEYS: readonly string[] = LIFE_ACTIVITIES.map((a) => a.key);

/**
 * The life activities the day page can LOG (V1-24 3b-life-b B6): wrestling practice only, typed in
 * minutes (the one-tap `DEFAULT_PRACTICE_MINUTES = 90` is gone). A separate trust set, because
 * `LIFE_ACTIVITIES` is also the routine catalog's source, and taking Wake out of it would strip a
 * stored `life:wake` from routines (FAM-1 12f owns that, D28). Wake is not loggable: the tap time is
 * not the wake time.
 */
export const LOGGABLE_LIFE_ACTIVITY_KEYS = [ACTIVITY_TYPE_KEYS.wrestling_practice] as const;
