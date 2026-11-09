import { keyBySelf } from '@mat-plan/shared';

import { NO_ATHLETE_SAVE, NO_PROFILE_LOG, NO_PROFILE_SAVE } from '@/lib/constants';

/**
 * **The one source for "which Server Actions does this app expose, and what does each refuse with".**
 *
 * Two tests consume it and neither may re-type the list (AUTH-1 1b-bis; generalized at WP-1):
 *
 * - `actions.test.ts` builds its refusal tuples from these keys, so a new action cannot be added
 *   without the boundary suites covering it, **and** compares them against the actions it finds on
 *   disk across **every** Server Action module. ⚠️ Before WP-1 that comparison read `actions.ts`
 *   alone, so a second module's actions entered no matrix at all.
 * - `pages-need-a-session.test.ts` pins the set of **modules** and proves each exported action makes
 *   the boundary call. **The non-vacuity floor is `Object.keys(MUTATING_ACTIONS).length`, never a
 *   re-typed `7`** — a count written twice is the same defect one level up.
 *
 * It lives OUTSIDE `actions.ts` on purpose, on the `action-state.ts` precedent: a `'use server'`
 * module may only export async functions, and `use-server-exports.test.ts` exists to fail a non-async
 * export there. A plain const therefore belongs in a sibling.
 */

/**
 * How an action is **ADDRESSED** — which id its body carries.
 *
 * 🔴 **This is NOT `HouseholdScope`.** That word already means the authorization capability in this
 * repo (`packages/db/src/scope.ts`; `docs/features/write-path.md` invariant 2). This field says
 * nothing about who may do what — it says which refusal matrices can drive the action:
 *
 * - `profile` — the body carries a `profileId`, so the wrong-household matrix can hand it a foreign
 *   one and assert the refusal.
 * - `household` — there is no `profileId` to make foreign (adding an athlete, renaming a movement),
 *   so that matrix structurally cannot cover it and a household matrix drives a DAL scope miss
 *   instead.
 *
 * Four sibling plans already write `scope:` for this, so the name stays; this docblock is the
 * disambiguation.
 */
export const ACTION_SCOPES = ['profile', 'household'] as const;
export type ActionScope = (typeof ACTION_SCOPES)[number];
export const ACTION_SCOPE = keyBySelf(ACTION_SCOPES);

/**
 * An action the refusal matrices drive.
 *
 * 🔴 **`excluded?: never` is what makes the union EXCLUSIVE, and it was missing.** WP-1 claimed in
 * five places — this file, `write-path.md`, the changelog, the commit and the PR — that "an entry
 * cannot carry both `scope` and `excluded`, it is a type error". **It was not.** TypeScript's
 * excess-property check on a non-discriminated union only requires each property to exist in *some*
 * member, so `{ refusal, scope, excluded }` compiled (probed: `tsc --strict`, exit 0). The mapped
 * filter then classified it as excluded, so it got no binding and no matrix — the dangerous
 * direction — leaving only the runtime `excludedActionNames()` pin to catch it, which is the shape
 * the claim said it had replaced. The plan's own Risks row said "prose and review, not a type"
 * before a later round claimed otherwise.
 */
export type MatrixEntry = {
  readonly refusal: string;
  readonly scope: ActionScope;
  readonly excluded?: never;
};

/**
 * An action deliberately outside the matrices, with the reason and the file that covers it instead.
 *
 * 🔴 **Exclusion is a MEMBER OF THIS UNION, not a second list, and that is load-bearing.** An entry
 * cannot carry both `scope` and `excluded`, so **"a household-addressed action may never be
 * excluded" is a type error rather than a rule in prose** — the shape WP-1's panel chose over a
 * parallel `OUTSIDE_THE_MATRIX` map. It also keeps one identity per action (the bare export name),
 * so the on-disk cross-check stays plain equality with nothing to subtract.
 *
 * ⚠️ **Empty, and pinned empty by `actions.test.ts`** — the `ALLOWLIST` idiom
 * (`pages-need-a-session.test.ts`). Its only ever candidate was the access gate's own action, which
 * `AUTH-1` 1d deleted. Every future entry is therefore an edit to a pinned assertion, read by a
 * human, rather than a line that slips in.
 */
export type ExcludedEntry = {
  readonly excluded: { readonly reason: string; readonly provenBy: string };
  /** See `MatrixEntry.excluded` — these two are what make the union exclusive. */
  readonly scope?: never;
  readonly refusal?: never;
};

export const MUTATING_ACTIONS = {
  logBodyweightAction: { refusal: NO_PROFILE_LOG, scope: ACTION_SCOPE.profile },
  logCheckinsAction: { refusal: NO_PROFILE_LOG, scope: ACTION_SCOPE.profile },
  logStrengthSessionAction: { refusal: NO_PROFILE_LOG, scope: ACTION_SCOPE.profile },
  logLifeActivitiesAction: { refusal: NO_PROFILE_LOG, scope: ACTION_SCOPE.profile },
  editStrengthSetAction: { refusal: NO_PROFILE_LOG, scope: ACTION_SCOPE.profile },
  editBodyweightAction: { refusal: NO_PROFILE_LOG, scope: ACTION_SCOPE.profile },
  editRoutineAction: { refusal: NO_PROFILE_SAVE, scope: ACTION_SCOPE.profile },
  /**
   * PROF-1 a-r, and **the first entry whose function lives in a different module**
   * (`app/p/profile-actions.ts`). That is the whole reason a-r was gated on WP-1: before it, the
   * on-disk cross-check read `[profileId]/actions.ts` alone, so this key would have failed the
   * equality with 8 registry names against 7 exports — and, worse, a module added without a key here
   * would have faced no boundary suite at all.
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
} as const satisfies Record<string, MatrixEntry | ExcludedEntry>;

/** Every action this app exposes, in or out of the matrices. */
export type MutatingActionName = keyof typeof MUTATING_ACTIONS;

/**
 * The actions the matrices drive — `MutatingActionName` minus the excluded ones, as a mapped-type
 * filter. `ACTION_BINDINGS` is keyed by this, so an excluded action cannot be given a binding and a
 * matrix action cannot be left without one.
 */
export type MatrixActionName = {
  [K in MutatingActionName]: (typeof MUTATING_ACTIONS)[K] extends ExcludedEntry ? never : K;
}[MutatingActionName];

/** The entry for a matrix action, narrowed past the union. */
export const matrixEntry = (name: MatrixActionName): MatrixEntry =>
  MUTATING_ACTIONS[name] as MatrixEntry;

/** Action names outside the matrices — pinned empty; see `ExcludedEntry`. */
export const excludedActionNames = (): string[] =>
  Object.entries(MUTATING_ACTIONS)
    .filter(([, v]) => 'excluded' in v)
    .map(([k]) => k);
