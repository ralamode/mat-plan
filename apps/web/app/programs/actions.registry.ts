import { TRANSPORT_REFUSALS } from '@mat-plan/shared';

import { ACTION_SCOPE, type ActionRegistry } from '@/app/p/[profileId]/mutating-actions';

/**
 * The program builder's actions in the boundary matrices (FAM-1 steps 7a-i and 7a-ii). Each speaks the FAM-1
 * contract (`TRANSPORT_REFUSALS`: no session is `not_found`, the limiter is `retry`), and each is
 * household-scoped: the ids it carries are the household's programs and workouts, never a profile.
 */
export const ACTION_REGISTRY = {
  createProgramAction: { refusal: TRANSPORT_REFUSALS, scope: ACTION_SCOPE.household },
  renameProgramAction: { refusal: TRANSPORT_REFUSALS, scope: ACTION_SCOPE.household },
  saveWorkoutAction: { refusal: TRANSPORT_REFUSALS, scope: ACTION_SCOPE.household },
  saveWeekAction: { refusal: TRANSPORT_REFUSALS, scope: ACTION_SCOPE.household },
  copyWorkoutAction: { refusal: TRANSPORT_REFUSALS, scope: ACTION_SCOPE.household },
  newItemAction: { refusal: TRANSPORT_REFUSALS, scope: ACTION_SCOPE.household },
} as const satisfies ActionRegistry;
