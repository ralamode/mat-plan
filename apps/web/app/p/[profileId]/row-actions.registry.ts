import { TRANSPORT_REFUSALS } from '@mat-plan/shared';

import { ACTION_SCOPE, type ActionRegistry } from './mutating-actions';

/**
 * The day page's writes in the boundary matrices (FAM-1 steps 12b, 12d and 15c). Each speaks the
 * FAM-1 contract (`TRANSPORT_REFUSALS`: no session is `not_found`, the limiter is `retry`).
 *
 * - **The four row writes are profile-addressed**: each resolves the athlete with
 *   `getProfileByPublicId`, which is what the matrix's wrong-household rows drive (C7).
 * - **Program order (15c) is household-addressed**, as Put on and Take off are
 *   (`app/programs/actions.registry.ts`): its body carries an athlete id, but lane P's writer
 *   (`lockAthletes`) is the one check of that athlete, so the matrix drives a DAL scope miss, and the
 *   module's test hands it another household's athlete id (`write-path.md` invariant 13).
 */
export const ACTION_REGISTRY = {
  amendRowAction: { refusal: TRANSPORT_REFUSALS, scope: ACTION_SCOPE.profile },
  logRowAction: { refusal: TRANSPORT_REFUSALS, scope: ACTION_SCOPE.profile },
  reorderProgramsAction: { refusal: TRANSPORT_REFUSALS, scope: ACTION_SCOPE.household },
  retickRowAction: { refusal: TRANSPORT_REFUSALS, scope: ACTION_SCOPE.profile },
  untickRowAction: { refusal: TRANSPORT_REFUSALS, scope: ACTION_SCOPE.profile },
} as const satisfies ActionRegistry;
