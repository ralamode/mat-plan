import { NO_ATHLETE_ADD, NO_ATHLETE_SAVE } from '@/lib/constants';

import { ACTION_SCOPE, type ActionRegistry } from '@/app/p/[profileId]/mutating-actions';

/**
 * **The registry entries for `./profile-actions.ts`** — the athlete-management actions, and what each
 * refuses with. Moved here unchanged from the one `MUTATING_ACTIONS` literal at FAM-1 step 0b; the
 * rule for these files is in `app/p/[profileId]/mutating-actions.ts`.
 *
 * `./profile-actions.test.ts` drives every entry through the refusal matrices and fails if this
 * object and the module's exports ever differ.
 */
export const ACTION_REGISTRY = {
  /**
   * PROF-1 a-r, and **the first entry whose function lives outside `[profileId]/actions.ts`**. That
   * is the whole reason a-r was gated on WP-1: before it, the on-disk cross-check read
   * `[profileId]/actions.ts` alone, so this key would have failed the equality with 8 registry names
   * against 7 exports — and, worse, a module added without a key here would have faced no boundary
   * suite at all.
   *
   * `scope: 'profile'` because the body carries a `profileId`, so the wrong-household matrix can hand
   * it a foreign one. (a-1's `addAthleteAction` is the first `household` entry; it has no profile id
   * to make foreign.)
   */
  renameAthleteAction: { refusal: NO_ATHLETE_SAVE, scope: ACTION_SCOPE.profile },

  /**
   * PROF-1 b. `scope: 'profile'` for the same reason rename is: the body carries a `profileId`, so
   * the wrong-household matrix can hand it a foreign one and assert the answer is byte-identical to
   * the unauth refusal.
   *
   * 🔴 **`refusal: NO_ATHLETE_SAVE`, NOT `OWNER_ONLY_ATHLETE`.** The matrices drive the
   * **cross-household** and **unauth** cases, and both of those must answer `NO_ATHLETE_SAVE` —
   * `OWNER_ONLY_ATHLETE` is reachable only for an id **inside** the caller's own household, which no
   * matrix row constructs (ADR 0006:348 permits the distinction precisely because the caller can
   * already see that athlete). Putting the owner-only string here would make the byte-identical
   * suite assert the wrong answer and quietly widen what a foreign id reveals.
   */
  archiveAthleteAction: { refusal: NO_ATHLETE_SAVE, scope: ACTION_SCOPE.profile },
  /** Restore, same addressing. Any member may call it, so it has no owner-only answer at all. */
  restoreAthleteAction: { refusal: NO_ATHLETE_SAVE, scope: ACTION_SCOPE.profile },

  /**
   * 🔴 **The first HOUSEHOLD-addressed action** (PROF-1 a-1w), and the entry
   * `mutating-actions.test.ts`'s tripwire was waiting for.
   *
   * `scope: 'household'` because the body carries **no `profileId`** — there is nothing for the
   * wrong-household matrix to make foreign. What replaces that proof is twofold: `db:verify` drives
   * `createProfile`'s two scoped reads against a real two-household database (with mutation patch
   * `20` showing the proof can fail), and at this tier the household matrix drives a **scope miss**
   * instead, asserting the refusal is byte-identical to the unauthenticated one.
   *
   * `refusal: NO_ATHLETE_ADD`, not `NO_ATHLETE_SAVE` — nothing was being saved; a row was being
   * created, and "No athlete found to save." would be false.
   */
  addAthleteAction: { refusal: NO_ATHLETE_ADD, scope: ACTION_SCOPE.household },
} as const satisfies ActionRegistry;
