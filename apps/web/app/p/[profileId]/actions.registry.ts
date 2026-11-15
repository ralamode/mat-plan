import { NO_PROFILE_LOG, NO_PROFILE_SAVE } from '@/lib/constants';

import { ACTION_SCOPE, type ActionRegistry } from './mutating-actions';

/**
 * **The registry entries for `./actions.ts`** — the seven per-athlete day actions, and what each
 * refuses with. Moved here unchanged from the one `MUTATING_ACTIONS` literal at FAM-1 step 0b; the
 * rule for these files is in `./mutating-actions.ts`.
 *
 * `./actions.test.ts` drives every entry through the refusal matrices and fails if this object and
 * the module's exports ever differ. Every one is `scope: 'profile'`: the body carries a `profileId`,
 * so the wrong-household matrix can hand it a foreign one.
 */
export const ACTION_REGISTRY = {
  logBodyweightAction: { refusal: NO_PROFILE_LOG, scope: ACTION_SCOPE.profile },
  logCheckinsAction: { refusal: NO_PROFILE_LOG, scope: ACTION_SCOPE.profile },
  logStrengthSessionAction: { refusal: NO_PROFILE_LOG, scope: ACTION_SCOPE.profile },
  logLifeActivitiesAction: { refusal: NO_PROFILE_LOG, scope: ACTION_SCOPE.profile },
  editStrengthSetAction: { refusal: NO_PROFILE_LOG, scope: ACTION_SCOPE.profile },
  editBodyweightAction: { refusal: NO_PROFILE_LOG, scope: ACTION_SCOPE.profile },
  editRoutineAction: { refusal: NO_PROFILE_SAVE, scope: ACTION_SCOPE.profile },
} as const satisfies ActionRegistry;
