import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { TRANSPORT_REFUSALS } from '@mat-plan/shared';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { INITIAL_ACTION_STATE, type ActionState } from '@/app/p/[profileId]/action-state';
import {
  ACTION_SCOPE,
  matrixEntry,
  speaksContract,
  type ActionRegistry,
  type ActionScope,
  type MatrixActionName,
} from '@/app/p/[profileId]/mutating-actions';
import { RATE_LIMITED } from '@/lib/constants';
import { getProfileByPublicId } from '@/lib/dal/profiles';
import { sessionUserOrNull } from '@/lib/dal/session';
import {
  checkMutationLimit,
  MUTATION_RATE_LIMIT,
  type MutationLimitPolicy,
} from '@/lib/rate-limit';

import { loadActionRegistry, registryFileFor } from './action-registry';
import { code, exportedActionNames, USE_SERVER_RE, WEB_DIR } from './source-scan';

/**
 * **The refusal matrices every Server Action module runs over its own registry** (FAM-1 step 0b).
 *
 * These are the suites that lived in `app/p/[profileId]/actions.test.ts` and ran over one merged
 * table: unauth, rate-limited, wrong household, the household scope miss, and the byte-identical
 * refusals. They moved here as one function so that each module's own test calls it with that
 * module's registry, bindings and valid bodies. Nothing about what they assert changed; what changed
 * is that a new module no longer edits a table two other lanes are editing.
 *
 * 🔴 **Why per module rather than one composed table.** `vi.mock` is per test file. A module's
 * bindings name the MOCKED DAL functions its actions call, so the bindings and the mocks have to be
 * in the same file, and two modules that mock the same DAL module differently (`@/lib/dal/profiles`
 * is mocked by both today) cannot share one. One composed table therefore meant one shared file
 * holding every module's mocks, which is the literal the sharding exists to remove.
 *
 * ## What the calling test file must provide
 *
 * `vi.mock` for the five boundaries this suite drives, because a refusal is only reachable through
 * them (the first `it` below fails by name if one is not a mock):
 *
 * | Module                | What the suite needs from the mock                                   |
 * | --------------------- | -------------------------------------------------------------------- |
 * | `next/cache`          | `revalidatePath`                                                     |
 * | `next/navigation`     | `redirect` that THROWS, as Next's does, plus `RedirectType`          |
 * | `@/lib/dal/session`   | `sessionUserOrNull` answering `{ userId: principal }` by default     |
 * | `@/lib/rate-limit`    | a PARTIAL mock: the real module with `checkMutationLimit` replaced    |
 * | `@/lib/dal/profiles`  | `getProfileByPublicId` answering a profile by default                |
 *
 * plus a mock of each DAL function its own actions call. `app/p/profile-actions.test.ts` is the
 * shortest complete example.
 *
 * ⚠️ **What narrowed, stated plainly.** Each refusal asserts that none of the writers THIS module's
 * bindings declare ran. Over the merged table it was every writer any module declared. The half that
 * went was unreachable: an action can only call what its own module imports, and a writer the
 * module's test does not mock throws on first touch (vitest refuses an export a mock factory does
 * not define).
 */

export type ActionFn = (s: ActionState, f: FormData) => Promise<ActionState>;

/**
 * What an action that speaks the FAM-1 contract resolves to, as far as the matrices read it: every
 * `ProgramResult` and `RowResult` is one of these (`@mat-plan/shared` → `program/actions.ts`).
 */
export type ContractResult = { ok: true } | { ok: false; reason: string };

/**
 * An action that speaks the FAM-1 contract (contract change C7): one typed input, a typed result,
 * no `FormData` and no previous state. `never` is the parameter every such function accepts being
 * read as (parameters are contravariant), so `logRow(input: RowWrite)` and
 * `saveWeek(draft: WeekDraft)` are both one of these, and a form action, which takes two
 * parameters, is not.
 */
export type ContractActionFn = (input: never) => Promise<ContractResult>;

/** Either envelope, for the rows that only compare what came back. */
type AnyResult = ActionState | ContractResult;

/**
 * ⚠️ `Writer` is deliberately loose, not `Mock`. These are the REAL DAL imports — `vi.mock` replaces
 * them at runtime but their static types stay the originals, so annotating `Mock` does not compile.
 * `(...a: never[]) => unknown` accepts any of them contravariantly while keeping the part that
 * matters: a **non-empty tuple**, so a binding cannot claim an action writes nothing.
 */
export type Writer = (...a: never[]) => unknown;

/**
 * What a matrix row needs to drive one action.
 *
 * 🔴 **`scopeMiss` is required for a HOUSEHOLD-addressed action and meaningless for a
 * profile-addressed one** — which is why this is a discriminated union rather than two optional
 * fields. A profile action is made to miss by mocking `getProfileByPublicId` to `null`, the one lever
 * that works for every one of them. A household action has **no `profileId` to make foreign**, so the
 * suite has to reach into its DAL function instead, and only the action's own author knows which one.
 *
 * WP-1's plan accepted both this and `succeeded` (R1, R7) and shipped neither, saying so: *"the suite
 * is still owed, by `PROF-1` a-1."* Until then the only matrix rows reaching a household action would
 * have been unauth and rate-limit — no wrong-owner proof at all, which AGENTS.md calls mandatory.
 */
type BindingBase<Fn = ActionFn, Result = ActionState> = {
  readonly fn: Fn;
  readonly writers: readonly [Writer, ...Writer[]];
  /**
   * Assert what a SUCCESSFUL call did, beyond `result.ok`. Optional; when absent the suite asserts
   * `ok` itself (see the happy row) —
   * `addAthleteAction` needs it because its success is a `redirect`, which throws and therefore
   * returns no envelope to inspect.
   */
  readonly succeeded?: (result: Result) => void;
  /**
   * The rate-limit policy this action enters with, when it is not the default (FAM-1 D23). Absent
   * means `MUTATION_RATE_LIMIT`, and the limiter row asserts exactly that, so an action that passes
   * a looser policy to `enterMutation` without saying so here is red. No action declares one yet.
   */
  readonly limit?: MutationLimitPolicy;
};

/**
 * 🔴 **Keyed on the ACTION'S OWN SCOPE, so the compiler enforces what the guide claims.** The first
 * version was a plain union (`{ scopeMiss?: never } | { scopeMiss: () => void }`), which TypeScript
 * satisfies with the first arm for **any** entry — so a household action could omit `scopeMiss`
 * while `write-path.md` invariant 13 said it was required. A review lens caught the gap between the
 * type and the sentence. A registry is `as const`, so each name's `scope` is known at the type level
 * and the requirement can actually be expressed.
 *
 * ⚠️ Generic over the module's registry since FAM-1 step 0b. `test/action-matrix.test.ts` pins that
 * the requirement survived the move: a household entry without `scopeMiss`, and a registry entry
 * with no binding at all, are still compile errors.
 */
export type BindingFor<R extends ActionRegistry, N extends MatrixActionName<R>> = ShapeBinding<
  R[N]
> &
  (R[N] extends { scope: typeof ACTION_SCOPE.household }
    ? { readonly scopeMiss: () => void }
    : { readonly scopeMiss?: never });

/**
 * The half of a binding that depends on which envelope the action speaks (contract change C7): a
 * registry entry whose `refusal` is a string is a form action; one whose `refusal` is
 * `TRANSPORT_REFUSALS` speaks the FAM-1 contract, so its `fn` takes one typed input and its
 * `succeeded` reads a contract result. The registry is `as const`, so this is decided per name at
 * the type level: binding a form action to a contract entry, or the reverse, does not compile
 * (pinned in `test/action-matrix.test.ts`).
 */
type ShapeBinding<Entry> = Entry extends { refusal: string }
  ? BindingBase
  : BindingBase<ContractActionFn, ContractResult>;

/**
 * AUTH-1 1b-bis: the NAMES and the refusal copy come from the registry, so this table cannot
 * silently fall behind the module on disk. Because it is keyed by `MatrixActionName`, **forgetting
 * an entry is a TYPE error**, not a quietly thinner suite — and an action marked `excluded` in the
 * registry cannot be given one. The on-disk cross-check closes the remaining direction.
 *
 * 🔴 **ONE table per action, not three (WP-1).** `ACTION_FNS`, the hand-written `ALL_WRITERS` array
 * and the `VALID_BODY` map were three structures keyed by the same names, so a new action had three
 * places to be forgotten and `updateProfileRoutine` was asserted by hand beside the array it was
 * missing from. `writers` is a **non-empty tuple at the type level**, so a binding cannot claim an
 * action writes nothing.
 */
export type ActionBindings<R extends ActionRegistry> = {
  readonly [N in MatrixActionName<R>]: BindingFor<R, N>;
};

/**
 * A body that reaches each action's ownership check, keyed by name.
 *
 * ⚠️ Each one has to be a body that would otherwise SUCCEED. An action that zod-rejects first never
 * reaches the ownership check, so its refusal row would prove nothing while looking identical in the
 * report. Keyed by `MatrixActionName` since FAM-1 step 0b, so a missing body is a type error; it was
 * a `Record<string, …>` read with `!`.
 *
 * A form action's body is its `FormData`. An action that speaks the FAM-1 contract takes its typed
 * input, so its body is that object. ⚠️ The type cannot tie the object to the action's own
 * parameter (the two tables are separate), so the proof that it is the right one is the row that
 * requires it to succeed.
 */
export type ValidBodies<R extends ActionRegistry> = {
  readonly [N in MatrixActionName<R>]: R[N] extends { refusal: string }
    ? () => FormData
    : () => object;
};

/** A binding with its scope- and shape-dependent halves widened, for iterating by string. */
type AnyBinding = BindingBase<ActionFn | ContractActionFn, never> & {
  readonly scopeMiss?: () => void;
};

/**
 * One action as the rows drive it. `action` takes the body alone and calls the bound function the
 * way its envelope is called; `notFound` is the whole refusal a not-found class of caller gets, in
 * that envelope.
 */
type Row = [name: string, action: (body: unknown) => Promise<AnyResult>, notFound: AnyResult];

/** What `describeActionMatrices` is given, less the path it derives the module from. */
type MatrixOptions<R extends ActionRegistry> = {
  readonly registry: R;
  readonly bindings: NoInfer<ActionBindings<R>>;
  readonly validBody: NoInfer<ValidBodies<R>>;
  readonly profileId: string;
  readonly principal: string;
};

/**
 * Run every refusal matrix over one Server Action module.
 *
 * @param opts.testFile `import.meta.url` of the calling test. The module under test is the file
 *   beside it with `.test` dropped, so there is no path to mistype and a test cannot drive another
 *   module's registry by accident.
 * @param opts.registry the module's `ACTION_REGISTRY`, from its `*.registry.ts`. The suite checks it
 *   is that very object.
 * @param opts.profileId the profile id the valid bodies carry; the wrong-household row asserts the
 *   ownership lookup was made with it.
 * @param opts.principal the user id the calling file's session mock answers with.
 */
export function describeActionMatrices<R extends ActionRegistry>(
  opts: MatrixOptions<R> & { readonly testFile: string },
): void {
  const { registry } = opts;
  const moduleFile = fileURLToPath(opts.testFile).replace(/\.test\.tsx?$/, '.ts');
  const moduleRel = relative(WEB_DIR, moduleFile);

  describeMatrixRows(opts, moduleRel, () => {
    it('runs beside a real Server Action module', () => {
      expect(USE_SERVER_RE.test(code(moduleFile)), `${moduleRel} carries 'use server'`).toBe(true);
    });

    it('drives the registry that sits beside the module, not a copy of it', async () => {
      expect(await loadActionRegistry(registryFileFor(moduleFile))).toBe(registry);
    });

    /**
     * The per-module half of "the registry matches the actions on disk". An action exported here
     * and missing from this registry is red in the module's own test, by name; the merged form
     * of the same equality is in `actions.test.ts`.
     */
    it('the registry names exactly the actions the module exports', () => {
      expect(Object.keys(registry).sort()).toEqual(exportedActionNames(moduleFile).sort());
    });
  });
}

/**
 * The rows themselves, without the three checks that tie them to a module on disk.
 *
 * 🔴 **A Server Action module's test calls `describeActionMatrices`, never this.** The on-disk guard
 * (`actions.test.ts` → "the registry matches every Server Action module on disk") looks for that
 * name, so a module tested through this one is red there. It is exported for
 * `test/action-matrix.contract.test.ts` alone, which runs the rows over actions defined in the test file:
 * the only way to prove the rows drive an action that speaks the FAM-1 contract before one exists
 * (a `'use server'` fixture would be a real public endpoint, and would have to be added to the
 * pinned list of this app's action modules).
 *
 * @param label what the outer describe is named after: the module's path.
 * @param moduleChecks registers the `it`s that need the module file.
 */
export function describeMatrixRows<R extends ActionRegistry>(
  opts: MatrixOptions<R>,
  label: string,
  moduleChecks: () => void,
): void {
  const { registry, profileId, principal } = opts;

  // The mapped types are keyed by this registry's literal names. Iteration is by string, so the two
  // tables are widened once, here; the call site is where the per-name types are checked.
  const bindings = opts.bindings as Readonly<Record<string, AnyBinding>>;
  const validBody = opts.validBody as Readonly<Record<string, () => FormData | object>>;

  const MATRIX_NAMES = Object.keys(bindings);

  /** The registry entry for a bound name. The cast is the widening above, undone for one lookup. */
  const entryOf = (name: string) => matrixEntry(registry, name as MatrixActionName<R>);

  /**
   * Call the bound function the way its envelope is called (contract change C7): a form action
   * with the initial state and its `FormData`, an action that speaks the FAM-1 contract with its
   * typed input alone. The casts undo the widening above for one call; `BindingFor` is what holds
   * each `fn` to its entry's shape.
   */
  const callerOf = (name: string): Row[1] => {
    const { fn } = bindings[name]!;
    return speaksContract(entryOf(name))
      ? (body) => (fn as (input: unknown) => Promise<ContractResult>)(body)
      : (body) => (fn as ActionFn)(INITIAL_ACTION_STATE, body as FormData);
  };

  /**
   * The whole refusal a not-found class of caller gets from this action, in its envelope. The
   * contract's words come from the shared const, not from the registry entry, so an entry cast past
   * its type cannot make the rows agree with a wrong word.
   */
  const notFoundOf = (name: string): AnyResult => {
    const { refusal } = entryOf(name);
    return typeof refusal === 'string'
      ? { ok: false, error: refusal }
      : { ok: false, reason: TRANSPORT_REFUSALS.noSession };
  };

  /**
   * What a rate-limited caller gets. ⚠️ Never the not-found answer: a form action says
   * `RATE_LIMITED`, an action that speaks the contract says `retry`.
   */
  const limitedOf = (name: string): AnyResult => {
    const { refusal } = entryOf(name);
    return typeof refusal === 'string'
      ? { ok: false, error: RATE_LIMITED }
      : { ok: false, reason: TRANSPORT_REFUSALS.rateLimited };
  };

  const rowFor = (name: string): Row => [name, callerOf(name), notFoundOf(name)];

  const ALL_ACTIONS: Row[] = MATRIX_NAMES.map(rowFor);

  /** Matrix rows for one addressing mode. */
  const actionsScoped = (scope: ActionScope): Row[] =>
    MATRIX_NAMES.filter((n) => entryOf(n).scope === scope).map(rowFor);

  const PROFILE_ACTIONS = actionsScoped(ACTION_SCOPE.profile);
  const HOUSEHOLD_ACTIONS = actionsScoped(ACTION_SCOPE.household);

  /**
   * Every writer any binding declares — **derived, never hand-listed**. The old array omitted
   * `updateProfileRoutine`, which is why each refusal case carried a separate
   * `expect(updateProfileRoutine).not.toHaveBeenCalled()`; a writer no binding declares is now
   * asserted by construction. (Those separate lines went at FAM-1 step 0b: `editRoutineAction`'s
   * binding declares that writer, so they asserted it a second time.)
   */
  const ALL_WRITERS = [...new Set(MATRIX_NAMES.flatMap((n) => bindings[n]!.writers))];

  /**
   * The body for the three rows that do not depend on it: two are refused before the body is read,
   * and the third asserts only the limiter call. It carries the one field every profile-addressed
   * action shares. (The merged suite's `form({ profileId })` also added a default `day`, which none
   * of the three reads.)
   */
  const bareBody = (): FormData => {
    const fd = new FormData();
    fd.append('profileId', profileId);
    return fd;
  };

  /**
   * The body for those three rows, per action. An action that speaks the FAM-1 contract has no
   * field every input shares, so it is handed its own valid input.
   */
  const earlyBody = (name: string): FormData | object =>
    speaksContract(entryOf(name)) ? validBody[name]!() : bareBody();

  describe(`${label} — the boundary matrices`, () => {
    beforeEach(() => vi.clearAllMocks());

    describe('the matrices are wired to this module (FAM-1 step 0b)', () => {
      /**
       * 🔴 A refusal is reachable ONLY through these mocks: the limiter fails open and is `null`
       * under vitest, and a real session read needs Clerk. An unmocked one would make every row
       * below fail for a reason that says nothing, so it is named here first.
       */
      it('the calling test file mocks the five boundaries the matrices drive', () => {
        const boundaries = {
          sessionUserOrNull,
          checkMutationLimit,
          getProfileByPublicId,
          revalidatePath,
          redirect,
        };
        for (const [name, fn] of Object.entries(boundaries)) {
          expect(vi.isMockFunction(fn), `${name} must be vi.mock'd in the calling test`).toBe(true);
        }
      });

      moduleChecks();

      /**
       * The type already says this (`ActionBindings`, `ValidBodies`). Asserted at runtime too, so a
       * table pushed past the type by a cast is still caught, and so that an EMPTY table — which
       * makes every `it.each` below register nothing and pass — is a failure here.
       */
      it('every matrix action has a binding and a valid body, and there is at least one', () => {
        const matrixNames = Object.keys(registry)
          .filter((n) => !('excluded' in registry[n]!))
          .sort();
        expect(matrixNames.length).toBeGreaterThan(0);
        expect(Object.keys(bindings).sort()).toEqual(matrixNames);
        expect(Object.keys(validBody).sort()).toEqual(matrixNames);
      });

      /**
       * ⚠️ `it.each([])` passes silently in vitest, so a matrix whose rows come from a filtered
       * registry can go green by matching nothing — which is how the household suite would have
       * reported success on the day `addAthleteAction` was registered with the wrong scope. Over
       * one merged table the floor was "the household matrix drives at least one action". Per
       * module that is false for a module with none, so the floor is the two facts it stood for:
       * every action lands in exactly one addressing matrix, and the actions that carry a
       * `scopeMiss` are exactly the ones the household matrix drives. (That the app HAS a
       * household-addressed action, and which, is pinned in `mutating-actions.test.ts`.)
       */
      it('every action is driven by exactly one addressing matrix', () => {
        const scoped = [...PROFILE_ACTIONS, ...HOUSEHOLD_ACTIONS].map(([n]) => n);
        expect(scoped.sort()).toEqual([...MATRIX_NAMES].sort());
        expect(HOUSEHOLD_ACTIONS.map(([n]) => n).sort()).toEqual(
          MATRIX_NAMES.filter((n) => bindings[n]!.scopeMiss !== undefined).sort(),
        );
      });
    });

    /**
     * 🔴 **One assertion ties each registration to the function it names (WP-1).** Shorthand
     * properties hide a copy-paste: `fooAction: { fn: logBodyweightAction, … }` would pass every
     * matrix below while the real `fooAction` was never called. Viable because every action is a
     * plain `export async function` with the Sentry wrapper inside its body, so `.name` survives the
     * build.
     */
    describe('the bindings name the functions they claim', () => {
      it.each(MATRIX_NAMES)('%s binds its own function', (n) => {
        expect(bindings[n]!.fn.name).toBe(n);
      });
    });

    // MANDATORY unauth → reject (AGENTS.md → Backend / API PR rules; SEC-1). A Server Action is a
    // public POST and the proxy is not the auth boundary: SEC-1's scar was a matcher that let
    // prefetch-flagged requests skip the check entirely. Each action must refuse a caller with no
    // session BEFORE anything else runs, with the same copy as not-found (so the refusal says nothing
    // about the profile).
    /**
     * 🔴 **The MANDATORY unauth suite (AGENTS.md → Backend / API PR rules), and at `1d` it is the
     * only one.** `1c-3b` added the session BESIDE the gate, so there were two suites — one flipping
     * each conjunct — and either going green alone would have meant the AND had quietly become an OR.
     *
     * ⚠️ **`1d` deleted the gate suite rather than keeping both, and that is not a narrowing of
     * coverage.** With one conjunct left, a second suite would have been the SAME test with a
     * different mock name: duplicate, and duplicate in the way that rots, because the next author
     * updates one.
     * 🔴 What must never happen here is widening to an alternation — asserting that a caller is
     * refused when EITHER check fails would pass a build where the surviving check does nothing.
     *
     * The copy comes from the registry, which takes it from `@/lib/constants`, rather than a re-typed
     * literal. That matters beyond tidiness: the security argument for 404-never-403 is that the
     * refusal is **byte-identical** across no-session, unknown, soft-deleted and foreign-household —
     * so a crafted cross-household id learns nothing a stale id wouldn't. Asserting through the const
     * makes that identity structural; asserting through two copies of a string only makes it likely.
     */
    describe('every Server Action — unauth → reject before any DAL call (SEC-1, AUTH-1 1c-3b)', () => {
      it.each(ALL_ACTIONS)(
        '%s refuses a caller with no session',
        async (name, action, notFound) => {
          vi.mocked(sessionUserOrNull).mockResolvedValueOnce(null);
          const res = await action(earlyBody(name));
          // 🔴 The SAME bytes as every other refusal, deliberately: a caller must not be able to tell
          // "no session" from "another household" from "no such profile". ADR 0006's 404-never-403.
          expect(res).toEqual(notFound);
          expect(getProfileByPublicId).not.toHaveBeenCalled();
          for (const write of ALL_WRITERS) expect(write).not.toHaveBeenCalled();
          expect(revalidatePath).not.toHaveBeenCalled();
        },
      );
    });

    /**
     * AUTH-1 1c-3b — the mutation limiter, which is otherwise untestable.
     *
     * It fails OPEN and is `unconfigured` under vitest, so a call placed after the write, or one
     * whose result is ignored, would be invisible to every other test in the calling file. These are
     * the only cases that can distinguish "the limiter is wired" from "the limiter is imported".
     */
    describe('every Server Action — rate limited → reject before any DAL call (AUTH-1 1c-3b)', () => {
      it.each(ALL_ACTIONS)(
        '%s refuses when the limiter says so',
        async (name, action, notFound) => {
          vi.mocked(checkMutationLimit).mockResolvedValueOnce({
            allowed: false,
            reason: 'limited',
          });
          const res = await action(earlyBody(name));
          // ⚠️ NOT the not-found copy. A rate limit is the one refusal with something to do about it,
          // and borrowing `NO_PROFILE_*` would both lie to the user and blur the 404-never-403
          // argument above. (`RATE_LIMITED` for a form action, `retry` for one that speaks the
          // contract.)
          expect(res).toEqual(limitedOf(name));
          expect(res).not.toEqual(notFound);
          expect(getProfileByPublicId).not.toHaveBeenCalled();
          for (const write of ALL_WRITERS) expect(write).not.toHaveBeenCalled();
          expect(revalidatePath).not.toHaveBeenCalled();
        },
      );

      it.each(ALL_ACTIONS)('%s keys the limiter on the principal', async (name, action) => {
        await action(earlyBody(name));
        // The id comes from `auth()`, never from the request — so it cannot be forged or enumerated.
        // 🔴 The POLICY is asserted with it since FAM-1 step 0b, when `enterMutation` gained the
        // parameter: an action is counted against the default budget unless its binding declares
        // another. So "no action uses the row-write policy yet" is this row, for every action,
        // rather than a sentence in a PR.
        const expected = bindings[name]!.limit ?? MUTATION_RATE_LIMIT;
        expect(checkMutationLimit).toHaveBeenCalledWith(principal, expected);
        // 🔴 By IDENTITY as well. `toHaveBeenCalledWith` compares deeply, so an action passing a
        // look-alike `{ attempts: 600, window: '5 m' }` would satisfy a binding that declares the
        // row policy, while `limiterFor` (which also selects by identity) counted it against the
        // default. The policy an action is held to is the exported const itself.
        expect(vi.mocked(checkMutationLimit).mock.calls[0]?.[1]).toBe(expected);
      });
    });

    /**
     * MANDATORY wrong-owner → forbid (AGENTS.md → Backend / API PR rules) — **satisfiable for the
     * first time in this repo** at TEN-1 1b. Until then there was no notion of whose request this
     * was, and `actions.ts` said so in as many words: *"any known profile id writes to that
     * profile."*
     *
     * ⚠️ **What this suite proves, stated precisely, because the panel caught the first draft
     * over-claiming it (A2 · S1 · C7).** `getProfileByPublicId` is mocked wholesale here, so a
     * foreign-household id and an unknown id are byte-identical AT THIS BOUNDARY — and that is the
     * point: this proves the **action layer's** half, that a `null` resolution refuses with the
     * shared copy, calls no writer and revalidates nothing, for every profile-addressed action. It
     * would stay green with the household conjunct deleted, which is exactly why **the scoping itself
     * is proved in `db:verify`'s two-household matrix**, in both directions, against a real database.
     * Two vehicles, each honest about its own half.
     *
     * The `null` also covers the **no-scope** path: a zero-household database resolves no scope, so
     * `getProfileByPublicId` returns `null` and every action takes this same route — dark, not leaky.
     *
     * ⚠️ Each case needs a body that would otherwise SUCCEED. An action that zod-rejects first never
     * reaches the ownership check, and a suite built on `form({ profileId })` would have proved
     * nothing while looking identical in the report.
     */
    describe('every Server Action — wrong household → the same refusal as not-found (TEN-1)', () => {
      it('every action has a body that reaches the ownership check (no vacuous case)', async () => {
        // The guard on the guard: with the default mocks every one of these must SUCCEED, so a case
        // that refuses below is refusing for the reason this suite is about.
        // 🔴 PROFILE-ADDRESSED ONLY (WP-1). These three sites make a `profileId` foreign; an action
        // with no `profileId` in its body cannot be driven that way, so a `household` entry is
        // excluded here by scope rather than by being forgotten. ⚠️ The unauth and rate-limit
        // suites above stay over ALL entries on purpose — a household action must still be
        // rate-limited, and `addAthleteAction` is the one that grows a table without bound.
        for (const [name, action] of PROFILE_ACTIONS) {
          vi.clearAllMocks();
          const res = await action(validBody[name]!());
          expect(
            res.ok,
            `${name}: the valid body must succeed, or its refusal case proves nothing`,
          ).toBe(true);
        }
      });

      it.each(PROFILE_ACTIONS)(
        '%s refuses a profile outside the request’s household',
        async (name, action, notFound) => {
          vi.mocked(getProfileByPublicId).mockResolvedValue(null);
          const res = await action(validBody[name]!());
          expect(res).toEqual(notFound);
          // The session passed and the profile WAS looked up — the authZ refusal, not the authN one.
          // ⚠️ Switched from `hasGateAccess` at 1d: the point is that the EARLIER conjunct ran and
          // passed, so this must track whichever check is first, not be dropped.
          expect(sessionUserOrNull).toHaveBeenCalled();
          expect(getProfileByPublicId).toHaveBeenCalledWith(profileId);
          for (const write of ALL_WRITERS) expect(write).not.toHaveBeenCalled();
          // No revalidate: a refusal must not even confirm which path exists.
          expect(revalidatePath).not.toHaveBeenCalled();
          vi.mocked(getProfileByPublicId).mockReset();
        },
      );

      it('the refusal is byte-identical to the no-session one, for every action', async () => {
        // The whole 404-never-403 argument (ADR 0006). If these two ever diverge the envelope
        // becomes an oracle for "that profile exists, just not for you".
        for (const [name, action, notFound] of PROFILE_ACTIONS) {
          vi.clearAllMocks();
          vi.mocked(sessionUserOrNull).mockResolvedValueOnce(null);
          const unauthed = await action(validBody[name]!());

          vi.clearAllMocks();
          vi.mocked(getProfileByPublicId).mockResolvedValue(null);
          const foreign = await action(validBody[name]!());
          vi.mocked(getProfileByPublicId).mockReset();

          expect(
            foreign,
            `${name}: foreign-household and unauthed must be indistinguishable`,
          ).toEqual(unauthed);
          expect(foreign).toEqual(notFound);
        }
      });
    });

    /**
     * 🔴 **The HOUSEHOLD matrix (PROF-1 a-1w) — the proof a household-addressed action has no other
     * way to get.**
     *
     * Every other mutating action carries a `profileId`, and the wrong-household suite makes it
     * foreign. `addAthleteAction` carries none: there is nothing to point at another household. So
     * the isolation question lives in `createProfile`'s two scoped reads and is proved in `db:verify`
     * against a real two-household database (mutation patch `20` shows that proof can fail). What
     * belongs HERE is the tier above it: when the DAL reports that **no household resolved**, the
     * action must answer exactly as it does to a stranger, write nothing, and navigate nowhere.
     *
     * WP-1's plan accepted this suite and the two binding fields it needs (R1, R7) and shipped
     * neither — so until a-1w, the only matrix rows that could reach a household action were unauth
     * and rate-limit, with **no wrong-owner row at all**.
     *
     * ⚠️ A module with no household-addressed action registers no rows here. The floor that used to
     * open this describe is "every action is driven by exactly one addressing matrix", above.
     */
    describe('every HOUSEHOLD-addressed Server Action — a scope miss answers like a stranger', () => {
      it.each(HOUSEHOLD_ACTIONS)(
        '%s succeeds on the happy path, or its refusal case proves nothing',
        async (name, action) => {
          vi.clearAllMocks();
          const res = await action(validBody[name]!()).catch((e: Error) => e);
          // ⚠️ **The default is real, not documentation.** `succeeded?.(…)` alone meant a binding
          // without one asserted NOTHING here — and `.catch` has already swallowed any throw, so the
          // row would pass for an action that failed outright. Today's single entry defines
          // `succeeded`; the next one that does not must still be held to `ok`.
          const binding = bindings[name]!;
          if (binding.succeeded) binding.succeeded(res as never);
          else expect(res, `${name}: a valid body must succeed`).toMatchObject({ ok: true });
        },
      );

      it.each(HOUSEHOLD_ACTIONS)(
        '%s refuses a scope miss with the not-found bytes, and writes nothing',
        async (name, action, notFound) => {
          vi.clearAllMocks();
          bindings[name]!.scopeMiss?.();
          const res = await action(validBody[name]!());

          expect(res).toEqual(notFound);
          // 🔴 Nothing navigated and nothing was revalidated — a refusal that redirected would put
          // the caller on a page they have no business seeing, and one that revalidated would churn
          // caches for a write that never happened.
          expect(redirect).not.toHaveBeenCalled();
          expect(revalidatePath).not.toHaveBeenCalled();
        },
      );

      it('the scope-miss refusal is byte-identical to the no-session one, for every action', async () => {
        for (const [name, action, notFound] of HOUSEHOLD_ACTIONS) {
          vi.clearAllMocks();
          bindings[name]!.scopeMiss?.();
          const missed = await action(validBody[name]!());

          vi.clearAllMocks();
          vi.mocked(sessionUserOrNull).mockResolvedValueOnce(null);
          const unauthed = await action(validBody[name]!());

          expect(
            missed,
            `${name}: a signed-in caller with no household and an unauthenticated one must be indistinguishable`,
          ).toEqual(unauthed);
          expect(unauthed).toEqual(notFound);
        }
      });
    });
  });
}
