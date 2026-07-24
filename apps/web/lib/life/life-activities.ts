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
export const LIFE_ACTIVITY_KEYS = [
  ACTIVITY_TYPE_KEYS.wake,
  ACTIVITY_TYPE_KEYS.wrestling_practice,
] as const;

/**
 * Default wrestling-practice duration (minutes) for a one-tap log. The club runs ~90-minute
 * sessions; variable durations / other clubs are why a minutes-override is a deferred refinement.
 * Named once (a one-line change if it moves).
 */
export const DEFAULT_PRACTICE_MINUTES = 90;
