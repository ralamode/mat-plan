import type { ProgramActions } from '@mat-plan/shared';

import {
  copyWorkoutAction,
  createProgramAction,
  newItemAction,
  putOnAction,
  renameProgramAction,
  saveWeekAction,
  saveWorkoutAction,
  takeOffAction,
} from './actions';

/**
 * The real `ProgramActions` (FAM-1 steps 7a-ii and 15): the object a page hands one lane-B screen,
 * the six required members and, since step 15, `putOn` and `takeOff`, which light the Put-on dialog
 * and Take off. A route passes the real actions it has, never a mix
 * (`packages/shared/src/program/actions.ts`).
 *
 * ⚠️ **Not in `actions.ts`**: a `'use server'` module may export only async functions. A plain
 * module (no `'server-only'`, no `'use client'`), so 7b's pages can pass it to a client screen:
 * the members are Server Action references. Since 7b-i the program pages import it, and only a page
 * under `app/programs/` may (`test/program-imports.test.ts` pins that).
 */
export const PROGRAM_ACTIONS = {
  createProgram: createProgramAction,
  renameProgram: renameProgramAction,
  saveWorkout: saveWorkoutAction,
  saveWeek: saveWeekAction,
  copyWorkout: copyWorkoutAction,
  newItem: newItemAction,
  putOn: putOnAction,
  takeOff: takeOffAction,
} satisfies ProgramActions;
