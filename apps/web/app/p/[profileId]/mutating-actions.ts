import { keyBySelf, type TRANSPORT_REFUSALS } from '@mat-plan/shared';

/**
 * **The contract for "which Server Actions does this app expose, and what does each refuse with":
 * the entry types, and the rule for where the entries live.**
 *
 * 🔴 **The entries are NOT in this file any more (FAM-1 step 0b). Each Server Action module carries
 * its own, in a sibling.** Until then one literal here (`MUTATING_ACTIONS`) and two in
 * `actions.test.ts` (`ACTION_BINDINGS`, `VALID_BODY`) were extended by every new action, so two
 * lanes adding actions edited the same three literals, and this file is owned by
 * `docs/features/write-path.md`, so each of those PRs also owed that guide. Now:
 *
 * ## Adding a Server Action module: three files, side by side
 *
 * For a module `x-actions.ts` (any directory under `apps/web`):
 *
 * 1. **`x-actions.ts`** — the `'use server'` module. Only `export async function`s; each opens with
 *    `await enterMutation(refusal)` and returns its refusal.
 *    **An action that speaks the FAM-1 contract** (a typed input, a `ProgramResult` or a
 *    `RowResult`) opens the same way with `await enterMutation(TRANSPORT_REFUSALS)`, or
 *    `enterMutation(TRANSPORT_REFUSALS, ROW_WRITE_RATE_LIMIT)` for a row write, and its registry
 *    entry carries `refusal: TRANSPORT_REFUSALS` (see `MatrixEntry`).
 * 2. **`x-actions.registry.ts`** — `export const ACTION_REGISTRY = { … } as const satisfies
 *    ActionRegistry`, one entry per exported action. Not in the module itself, on the
 *    `action-state.ts` precedent: a `'use server'` module may only export async functions, and
 *    `use-server-exports.test.ts` fails a non-async export there.
 * 3. **`x-actions.test.ts`** — the module's own test. It declares the `vi.mock`s, a binding and a
 *    valid body per action, and calls `describeActionMatrices` (`@/test/action-matrix`), which runs
 *    every refusal matrix over this module's registry. The per-action behaviour goes in the same
 *    file.
 *
 * Nothing shared composes these by hand. `@/test/action-registry` finds each module's registry by
 * its name and merges them into `MUTATING_ACTIONS`, and three guards make a missing piece red:
 *
 * - a module with no registry beside it, or no test beside it that calls `describeActionMatrices`,
 *   fails `actions.test.ts` → "the registry matches every Server Action module on disk";
 * - an exported action missing from its module's registry fails that module's own matrix, and the
 *   same describe;
 * - a registry entry without a binding or a valid body is a **type** error at the
 *   `describeActionMatrices` call (`ActionBindings`, pinned in `test/action-matrix.test.ts`).
 *
 * ⚠️ **Pinned lists are still edited by hand, on purpose**, because each exists to be read by a
 * person: the list of Server Action modules in `app/pages-need-a-session.test.ts` (every module);
 * and in `mutating-actions.test.ts`, the household-addressed actions and the actions that enter with
 * `ROW_WRITE_RATE_LIMIT`. Each is one entry per line, sorted, so two PRs adding one each merge.
 *
 * 🔴 **A HOUSEHOLD-addressed action that carries an id owes a foreign-id proof of its own.** The
 * matrix gives a household action exactly one lever, its `scopeMiss` thunk, and that drives "no
 * household resolved". It does not drive "this id belongs to another household". `addAthleteAction`
 * carries no id, so for it the scope miss is the whole question. An action such as "rename this
 * program" or "save this workout", addressed by a program id rather than a `profileId`, is
 * `scope: 'household'` and passes every matrix row while its DAL could still accept a foreign id.
 * Its module's test adds a row that hands it another household's id and asserts the same refusal
 * bytes and no write, and the writer's refusal is proved in `db:verify` against two households
 * (`docs/features/write-path.md` invariants 2 and 13).
 *
 * Two existing modules follow this: `./actions.ts` and `app/p/profile-actions.ts`.
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
 *
 * 🔴 **`refusal` is what the action hands `enterMutation`, and it says which envelope the action
 * speaks (FAM-1 contract change C7).**
 *
 * - A **string** (a const from `@/lib/constants`): a form action, `(state, formData) =>
 *   ActionState`. The matrices expect `{ ok: false, error: <that string> }` for every not-found
 *   class of refusal and `RATE_LIMITED` for the limit.
 * - **`TRANSPORT_REFUSALS`** (`@mat-plan/shared`): an action that speaks the FAM-1 contract,
 *   `(input) => ProgramResult | RowResult`. The matrices expect `{ ok: false, reason: 'not_found' }`
 *   and `{ ok: false, reason: 'retry' }`.
 *
 * One field, so an entry cannot say one thing here and pass `enterMutation` another: the unauth row
 * is red for an action whose registry and whose call disagree.
 */
export type MatrixEntry = {
  readonly refusal: string | typeof TRANSPORT_REFUSALS;
  readonly scope: ActionScope;
  readonly excluded?: never;
};

/** Whether a matrix entry is an action that speaks the FAM-1 contract (see `MatrixEntry`). */
export const speaksContract = (
  entry: MatrixEntry,
): entry is MatrixEntry & { refusal: typeof TRANSPORT_REFUSALS } =>
  typeof entry.refusal !== 'string';

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

/**
 * One Server Action module's entries, keyed by the bare export name. Every `*.registry.ts` declares
 * its `ACTION_REGISTRY` with `as const satisfies ActionRegistry`: `as const` keeps each entry's
 * `scope` a literal, which is what lets `BindingFor` require `scopeMiss` of a household action.
 *
 * It is also the type of the merged registry (`MUTATING_ACTIONS` in `@/test/action-registry`), which
 * is every module's entries in one object.
 */
export type ActionRegistry = Readonly<Record<string, MatrixEntry | ExcludedEntry>>;

/**
 * The actions of a registry that the matrices drive: its keys minus the excluded ones, as a
 * mapped-type filter. A module's bindings and valid bodies are keyed by this, so an excluded action
 * cannot be given a binding and a matrix action cannot be left without one.
 */
export type MatrixActionName<R extends ActionRegistry> = {
  [K in keyof R & string]: R[K] extends ExcludedEntry ? never : K;
}[keyof R & string];

/** The entry for a matrix action, narrowed past the union. */
export const matrixEntry = <R extends ActionRegistry>(
  registry: R,
  name: MatrixActionName<R>,
): MatrixEntry => registry[name] as MatrixEntry;

/** Action names outside the matrices — pinned empty; see `ExcludedEntry`. */
export const excludedActionNames = (registry: ActionRegistry): string[] =>
  Object.entries(registry)
    .filter(([, v]) => 'excluded' in v)
    .map(([k]) => k);
