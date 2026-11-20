import { TRANSPORT_REFUSALS } from '@mat-plan/shared';

import { ACTION_SCOPE, type ActionRegistry } from './mutating-actions';

/**
 * **The registry entries for `./clear-day-actions.ts`** (V1-9b B1-2): what each refuses with. The
 * rule for these files is in `./mutating-actions.ts`. `./clear-day-actions.test.ts` drives every
 * entry through the refusal matrices and fails if this object and the module's exports differ.
 * `scope: 'profile'`: the input names the athlete. Both take the default limiter: a clear is one
 * write, not a row's.
 */
export const ACTION_REGISTRY = {
  clearDayAction: { refusal: TRANSPORT_REFUSALS, scope: ACTION_SCOPE.profile },
  restoreClearAction: { refusal: TRANSPORT_REFUSALS, scope: ACTION_SCOPE.profile },
} as const satisfies ActionRegistry;
