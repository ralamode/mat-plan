import { describe, expect, it } from 'vitest';

import { WORKOUT_NAME_MAX } from '../programming';

import { COPY_NAME_SUFFIX, copyName, workoutNameSchema } from './pieces';

/**
 * The default name of a copy in its own program, and the Copy dialog's prefill (FAM-1 contract
 * change C15). The prototype's rule: the name and " (copy)", cut so the whole fits the limit.
 */
describe('copyName: a copy’s default name', () => {
  it('adds the suffix to a name that has room', () => {
    expect(copyName('Heavy A')).toBe('Heavy A (copy)');
    expect(COPY_NAME_SUFFIX).toBe(' (copy)');
  });

  it('cuts a long name so the copy’s still fits, as the prototype does', () => {
    const longest = 'x'.repeat(WORKOUT_NAME_MAX);
    const copied = copyName(longest);
    expect(copied).toHaveLength(WORKOUT_NAME_MAX);
    expect(copied.endsWith(COPY_NAME_SUFFIX)).toBe(true);
    expect(copied.startsWith('x'.repeat(WORKOUT_NAME_MAX - COPY_NAME_SUFFIX.length))).toBe(true);
  });

  it('is always a name the workout-name schema takes, for any name it takes', () => {
    for (const name of [
      'A',
      'Heavy A',
      'Stretch, 10 min',
      'y'.repeat(WORKOUT_NAME_MAX),
      '💪 day',
    ]) {
      expect(workoutNameSchema.safeParse(name).success, name).toBe(true);
      expect(workoutNameSchema.safeParse(copyName(name)).success, name).toBe(true);
    }
  });

  it('a copy of a copy is cut the same way, never past the limit', () => {
    let name = 'Conditioning circuit';
    for (let i = 0; i < 4; i += 1) {
      name = copyName(name);
      expect(name.length).toBeLessThanOrEqual(WORKOUT_NAME_MAX);
    }
    expect(name.endsWith(COPY_NAME_SUFFIX)).toBe(true);
  });
});
