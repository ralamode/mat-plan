import { describe, expect, it } from 'vitest';

import { newWorkoutPath, programPath, PROGRAMS_PATH, workoutPath } from './routes';

/**
 * A contract test: it pins the paths, so a change here is a change step 7b's pages must follow
 * (`app/programs/**`). The literals belong on this side, once.
 */
describe('the program builder’s paths', () => {
  it('are the four pages 7b builds', () => {
    expect(PROGRAMS_PATH).toBe('/programs');
    expect(programPath('p')).toBe('/programs/p');
    expect(workoutPath('p', 'w')).toBe('/programs/p/workouts/w');
    expect(newWorkoutPath('p')).toBe('/programs/p/workouts/new');
  });
});
