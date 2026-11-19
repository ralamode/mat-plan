import type { ProgramActions } from '@mat-plan/shared';

import {
  copyWorkoutAction,
  createProgramAction,
  newItemAction,
  renameProgramAction,
  saveWeekAction,
  saveWorkoutAction,
} from './actions';

/**
 * The real `ProgramActions` (FAM-1 step 7a-ii): the object a page hands one lane-B screen, now
 * that all six required members exist. A route passes the real actions it has, never a mix
 * (`packages/shared/src/program/actions.ts`); `putOn` and `takeOff` arrive at step 15 and are left
 * out, so their controls stay hidden.
 *
 * ⚠️ **Not in `actions.ts`**: a `'use server'` module may export only async functions. A plain
 * module (no `'server-only'`, no `'use client'`), so 7b's pages can pass it to a client screen:
 * the members are Server Action references. Since 7b-i the program pages import it, and only a page
 * under `app/programs/` may (`test/program-tables-stay-dark.test.ts` pins that).
 */
export const PROGRAM_ACTIONS = {
  createProgram: createProgramAction,
  renameProgram: renameProgramAction,
  saveWorkout: saveWorkoutAction,
  saveWeek: saveWeekAction,
  copyWorkout: copyWorkoutAction,
  newItem: newItemAction,
} satisfies ProgramActions;
