/**
 * The program builder's paths (FAM-1 lane B). The screens link with these, and step 7b builds its
 * pages at exactly these paths, so a link and its route have one source.
 *
 * Chosen at step 8a _(maintainer, 2026-11-15)_: the screens' props carry only data and actions
 * (plan §4), so the screens build their own links. Until 7b the routes do not exist, and on the
 * preview route these links 404; each preview state is reached by its fixture instead.
 *
 * Here, not in `lib/constants.ts` with the app's other paths, because a lane edits only its own
 * files (plan §6). `routes.test.ts` pins them, and `owed.test.ts` holds 7b to a page per path.
 */
export const PROGRAMS_PATH = '/programs';

export const programPath = (programPublicId: string) => `${PROGRAMS_PATH}/${programPublicId}`;

export const workoutPath = (programPublicId: string, workoutPublicId: string) =>
  `${programPath(programPublicId)}/workouts/${workoutPublicId}`;

export const newWorkoutPath = (programPublicId: string) =>
  `${programPath(programPublicId)}/workouts/new`;
