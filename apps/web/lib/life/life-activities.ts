import { ACTIVITY_TYPE_KEYS } from '@mat-plan/shared';

/**
 * V1-7 life activities — logged one-tap on the Today view. Deliberately NOT a registry (the two
 * activities are heterogeneous and hard-coded; a `checkin-fields.ts`-style derived source earns
 * nothing for N=2). Just the two things the feature needs single-sourced:
 *
 *  - the TRUST-BOUNDARY set the action validates a submitted `activityKey` against (never trust
 *    the body) — `wake` (a `timing` event) + `wrestling_practice` (a one-tap duration);
 *  - the default practice duration for the one-tap log.
 */
/**
 * The life activities + their one-tap button labels — the single source the UI maps over AND the
 * action's trust set derives from, so adding one renders a button and is accepted server-side without
 * re-hardcoding the pair in two places. (The action still needs a per-key item-building arm, since the
 * shapes are heterogeneous — wake=timing event, wrestling=duration metric — and that dispatch is
 * exhaustive so an un-armed key fails loudly.)
 */
export const LIFE_ACTIVITIES = [
  { key: ACTIVITY_TYPE_KEYS.wake, label: 'Wake' },
  { key: ACTIVITY_TYPE_KEYS.wrestling_practice, label: 'Wrestling practice' },
] as const;

/** The trust-boundary set the action validates a submitted `activityKey` against (derived — one source). */
export const LIFE_ACTIVITY_KEYS: readonly string[] = LIFE_ACTIVITIES.map((a) => a.key);

/**
 * Default wrestling-practice duration (minutes) for a one-tap log. The club runs ~90-minute
 * sessions; variable durations / other clubs are why a minutes-override is a deferred refinement.
 * Named once (a one-line change if it moves).
 */
export const DEFAULT_PRACTICE_MINUTES = 90;
