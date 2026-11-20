import { TRANSPORT_REFUSALS } from '@mat-plan/shared';

import { NO_PROFILE_LOG, NO_PROFILE_SAVE } from '@/lib/constants';

import { ACTION_SCOPE, type ActionRegistry } from './mutating-actions';

/**
 * **The registry entries for `./actions.ts`** — the five per-athlete day actions, and what each
 * refuses with. Moved here from the one `MUTATING_ACTIONS` literal at FAM-1 step 0b; FAM-1 12f PR 3
 * removed the three the old forms called (check-ins, a strength session, a set edit). The rule for
 * these files is in `./mutating-actions.ts`.
 *
 * `./actions.test.ts` drives every entry through the refusal matrices and fails if this object and
 * the module's exports ever differ. Every one is `scope: 'profile'`: the body carries a `profileId`,
 * so the wrong-household matrix can hand it a foreign one.
 */
export const ACTION_REGISTRY = {
  logBodyweightAction: { refusal: NO_PROFILE_LOG, scope: ACTION_SCOPE.profile },
  logLifeActivitiesAction: { refusal: NO_PROFILE_LOG, scope: ACTION_SCOPE.profile },
  editBodyweightAction: { refusal: NO_PROFILE_LOG, scope: ACTION_SCOPE.profile },
  // V1-24 3b-life: the first action in this module that speaks the FAM-1 contract (typed input and result).
  editPracticeAction: { refusal: TRANSPORT_REFUSALS, scope: ACTION_SCOPE.profile },
  editRoutineAction: { refusal: NO_PROFILE_SAVE, scope: ACTION_SCOPE.profile },
} as const satisfies ActionRegistry;
