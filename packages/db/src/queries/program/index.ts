/**
 * Lane P's reads (FAM-1 plan §5): what `packages/db/src/index.ts` publishes to the app. **Named
 * exports only**, so a later step adds its read here, in the lane's own file, with no further turn on
 * the package's barrel.
 */
export {
  programIdsIn,
  programIn,
  programWorkoutIds,
  workoutIn,
  workoutInHousehold,
} from './exists';
export { readWorkoutDraft } from './workout';
export { readWeek } from './week';
export { movementOptions, type MovementOption } from './movement-options';
export { readProgramList, readProgramsByAthlete, type AthleteProgram } from './program-list';
export { readProgramView } from './program-view';
