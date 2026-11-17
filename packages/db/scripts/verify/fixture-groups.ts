import { DAY_PLAN_FIXTURE_SOURCES } from '@mat-plan/shared/program/fixtures';

/**
 * The `before` fixtures whose only change is an archive, which 12a-i's proof applies directly
 * (`verify/day-plan.ts`, R1). Every other `before` fixture edits the program after logging and is
 * 12a-ii's replay ({@link REPLAY_FIXTURES}).
 */
export const ARCHIVE_ONLY_FIXTURES = [
  'archived-athlete-today',
  'archived-athlete-nothing-logged',
] as const satisfies readonly (keyof typeof DAY_PLAN_FIXTURE_SOURCES)[];

/** How many fixtures 12a-i deep-equals from a fixed world (`before === null`). */
export const FIXED_WORLD_FIXTURE_COUNT = 11;

type FixtureName = keyof typeof DAY_PLAN_FIXTURE_SOURCES;

/**
 * 12a-ii's fixtures: every source with a `before` that is not archive-only, **derived, never typed
 * out** (plan 12a § 12a-ii, Selection), so a fixture added with a `before` is replayed, or fails the
 * count, without an edit here.
 */
export const REPLAY_FIXTURES: readonly FixtureName[] = (
  Object.keys(DAY_PLAN_FIXTURE_SOURCES) as FixtureName[]
).filter(
  (name) =>
    DAY_PLAN_FIXTURE_SOURCES[name].before !== null &&
    !(ARCHIVE_ONLY_FIXTURES as readonly string[]).includes(name),
);

/** How many fixtures 12a-ii replays; the proof asserts it, so the filter cannot shrink silently. */
export const REPLAY_FIXTURE_COUNT = 4;
