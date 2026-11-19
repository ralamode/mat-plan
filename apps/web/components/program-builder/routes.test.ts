import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

/** The app directory, from this file. */
const APP = join(dirname(fileURLToPath(import.meta.url)), '../../app');

describe('7b: every path in routes.ts has its page.tsx or route.ts under app/programs/', () => {
  // Each path built with a sample id, and the segment file that must serve it: Next maps a uuid to
  // `[programId]`, `[workoutId]` or `[optionId]`, and the static `new` and `how-to` win over them.
  const ID = '019826b4-0000-7000-8000-0000000000a1';
  const served: [path: string, file: string][] = [
    [PROGRAMS_PATH, 'programs/page.tsx'],
    [programPath(ID), 'programs/[programId]/page.tsx'],
    [workoutPath(ID, ID), 'programs/[programId]/workouts/[workoutId]/page.tsx'],
    [newWorkoutPath(ID), 'programs/[programId]/workouts/new/page.tsx'],
    [howToPath(ID), 'programs/how-to/[optionId]/route.ts'],
  ];

  it.each(served)('%s is served by app/%s', (path, file) => {
    // The file's segments, with each dynamic one standing for the id, spell the path.
    const spelled = `/${dirname(file)}`.replace(/\[[^\]]+\]/g, ID);
    expect(spelled).toBe(path);
    expect(existsSync(join(APP, file)), file).toBe(true);
  });

  it('names every path routes.ts exports (non-vacuity)', async () => {
    const paths = Object.keys(await import('./routes'));
    expect(paths.sort()).toEqual(
      ['PROGRAMS_PATH', 'howToPath', 'newWorkoutPath', 'programPath', 'workoutPath'].sort(),
    );
    expect(served).toHaveLength(paths.length);
  });
});
