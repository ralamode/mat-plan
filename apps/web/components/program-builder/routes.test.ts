import { describe, expect, it } from 'vitest';

import { howToPath, newWorkoutPath, programPath, PROGRAMS_PATH, workoutPath } from './routes';

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

  it('and the How to read, its id encoded (the Route Handler at app/programs/how-to/[optionId])', () => {
    expect(howToPath('o')).toBe('/programs/how-to/o');
    expect(howToPath('a/b?c')).toBe('/programs/how-to/a%2Fb%3Fc');
  });
});
