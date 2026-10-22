import { NO_PROFILE_LOG, NO_PROFILE_SAVE } from '@/lib/constants';

/**
 * **The one source for "which Server Actions does this route expose, and what does each refuse with".**
 *
 * Two tests consume it and neither may re-type the list (AUTH-1 1b-bis):
 *
 * - `actions.test.ts` builds its unauth / wrong-household tuples from these keys, so a new action
 *   cannot be added without the boundary suites covering it. Before this module, `ALL_ACTIONS` was a
 *   hand-maintained array and `docs/features/write-path.md` invariant 1 admitted the hole in writing:
 *   _"A new action without it fails the unauth suite only if you add it to that suite: do."_
 * - `pages-are-gated.test.ts` compares these keys against the actions it finds on disk, so the list
 *   and the filesystem cannot drift. **The non-vacuity floor is `Object.keys(MUTATING_ACTIONS).length`,
 *   never a re-typed `7`** — a count written twice is the same defect one level up.
 *
 * It lives OUTSIDE `actions.ts` on purpose, on the `action-state.ts` precedent: a `'use server'` module
 * may only export async functions, and `use-server-exports.test.ts` exists to fail a non-async export
 * there. A plain const therefore belongs in a sibling.
 *
 * ⚠️ `as const satisfies` rather than the `Record<string, typeof NO_PROFILE_LOG>` the plan sketched:
 * `NO_PROFILE_LOG` and `NO_PROFILE_SAVE` are distinct string-literal types, so that annotation does not
 * compile. This keeps each value's exact type AND checks the shape.
 */
export const MUTATING_ACTIONS = {
  logBodyweightAction: NO_PROFILE_LOG,
  logCheckinsAction: NO_PROFILE_LOG,
  logStrengthSessionAction: NO_PROFILE_LOG,
  logLifeActivitiesAction: NO_PROFILE_LOG,
  editStrengthSetAction: NO_PROFILE_LOG,
  editBodyweightAction: NO_PROFILE_LOG,
  editRoutineAction: NO_PROFILE_SAVE,
} as const satisfies Record<string, string>;

export type MutatingActionName = keyof typeof MUTATING_ACTIONS;
