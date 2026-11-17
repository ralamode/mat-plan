import { ACTIVITY_TYPE_KEYS } from '@mat-plan/shared';

/**
 * V1-7 life activities: the routine catalog's source (`wake`, `wrestling_practice`) and their labels.
 * Deliberately NOT a registry (the activities are hard-coded; a `checkin-fields.ts`-style derived source
 * earns nothing for N=2).
 *
 * ⚠️ **This is not what the day page can LOG.** Since V1-24 3b-life-b only wrestling practice is
 * loggable, in typed minutes, and the trust boundary is `logPracticeSchema`'s `activityKey` literal
 * (`packages/shared/src/practice-shapes.ts`). Wake stays HERE because the routine catalog derives from
 * this list, and taking it out would strip a stored `life:wake` from routines (FAM-1 12f owns that,
 * D28); the day page does not show it, and the action refuses it.
 */
export const LIFE_ACTIVITIES = [
  { key: ACTIVITY_TYPE_KEYS.wake, label: 'Wake' },
  { key: ACTIVITY_TYPE_KEYS.wrestling_practice, label: 'Wrestling practice' },
] as const;

/** Every life activity's key, derived (one source): the routine catalog reads it (`catalog.ts`). */
export const LIFE_ACTIVITY_KEYS: readonly string[] = LIFE_ACTIVITIES.map((a) => a.key);
