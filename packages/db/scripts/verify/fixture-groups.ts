import type { DAY_PLAN_FIXTURE_SOURCES } from '@mat-plan/shared/program/fixtures';

/**
 * The `before` fixtures whose only change is an archive, which 12a-i's proof applies directly
 * (`verify/day-plan.ts`, R1). Every other `before` fixture edits the program after logging, so it
 * waits for 12a-ii's replay. ONE list: the proof iterates it and `owed.test.ts` skips exactly it, so
 * a fixture cannot stop being owed without being proved.
 */
export const ARCHIVE_ONLY_FIXTURES = [
  'archived-athlete-today',
  'archived-athlete-nothing-logged',
] as const satisfies readonly (keyof typeof DAY_PLAN_FIXTURE_SOURCES)[];

/** How many fixtures 12a-i deep-equals from a fixed world (`before === null`). */
export const FIXED_WORLD_FIXTURE_COUNT = 11;
