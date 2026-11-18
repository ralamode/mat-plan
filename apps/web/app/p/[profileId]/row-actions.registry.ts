import { TRANSPORT_REFUSALS } from '@mat-plan/shared';

import { ACTION_SCOPE, type ActionRegistry } from './mutating-actions';

/**
 * The day page's row writes in the boundary matrices (FAM-1 step 12b). Each speaks the FAM-1
 * contract (`TRANSPORT_REFUSALS`: no session is `not_found`, the limiter is `retry`), and each is
 * profile-addressed: it resolves the athlete with `getProfileByPublicId`, which is what the matrix's
 * wrong-household rows drive (C7).
 */
export const ACTION_REGISTRY = {
  logRowAction: { refusal: TRANSPORT_REFUSALS, scope: ACTION_SCOPE.profile },
  retickRowAction: { refusal: TRANSPORT_REFUSALS, scope: ACTION_SCOPE.profile },
  untickRowAction: { refusal: TRANSPORT_REFUSALS, scope: ACTION_SCOPE.profile },
} as const satisfies ActionRegistry;
