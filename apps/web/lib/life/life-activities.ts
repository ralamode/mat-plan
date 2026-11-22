import { ACTIVITY_TYPE_KEYS } from '@mat-plan/shared';

/**
 * V1-7 life activities: the routine catalog's Life source and their labels. Since FAM-1 12f PR 5 (D28)
 * it holds Wrestling practice alone: Wake left, so the routine catalog no longer offers it and a stored
 * `life:wake` is dropped at read. The `wake` activity type itself stays known (`catalog-activity-types.ts`),
 * so an old Wake entry still exports as a clock time.
 *
 * The trust boundary for what the day page can LOG is `logPracticeSchema`'s `activityKey` literal
 * (`packages/shared/src/practice-shapes.ts`), not this list.
 */
export const LIFE_ACTIVITIES = [
  { key: ACTIVITY_TYPE_KEYS.wrestling_practice, label: 'Wrestling practice' },
] as const;

/** Every life activity's key, derived (one source): the routine catalog reads it (`catalog.ts`). */
export const LIFE_ACTIVITY_KEYS: readonly string[] = LIFE_ACTIVITIES.map((a) => a.key);
