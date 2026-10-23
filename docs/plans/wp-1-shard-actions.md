# WP-1 — every Server Action module in the boundary matrix; why the steps still serialize

> Backlog: WP-1 (proposed, unfiled. The `plan.md` row and roadmap link land when this PR opens) · Spec:
> [crud-1-fix-it-yourself.md](../specs/crud-1-fix-it-yourself.md) chunk "The critical path" (last
> paragraph) and Risks row "Four tracks queue on `actions.ts`" · Milestone:
> [CRUD-1](../milestones/crud-1-fix-it-yourself.md) step 0 · Branch:
> `test/wp-1-every-action-module-in-the-matrix`

## Goal

The spec first recommended splitting `apps/web/app/p/[profileId]/actions.ts` (631 lines, seven
actions) per feature, before A1, so that CRUD-1's lanes would not queue on one file. This plan checked
that claim against the code. **The split does not unlock parallelism.** `docs/features/write-path.md`
owns `apps/web/lib/dal/` as a **directory prefix** (`write-path.md:4`), and every new action needs a
DAL function. So every action-adding step edits that guide, whatever happens to `actions.ts`, and
under [parallel-work.md](../parallel-work.md) gate 1 those steps serialize. The spec and the milestone
have since been corrected to say this (`crud-1-fix-it-yourself.md:199-206`,
`milestones/crud-1-fix-it-yourself.md:86`).

The split's real value turned out to be elsewhere. The guards that prove every action refuses an
unauthenticated caller, a wrong-household caller and a bad body were built for **one module of
profile-addressed actions**, and CRUD-1's first step breaks both assumptions. A1's "add an athlete"
is **household-addressed**: it has no `profileId`, so it cannot pass the wrong-household suite, which
asserts `getProfileByPublicId` was called (`actions.test.ts:1579`). It is also likely to live in a
**second module** on `/p`.

So WP-1 is one PR, about 300 lines, almost all tests. It:

1. **Makes the action registry the contract for every Server Action module.** Each entry carries a
   refusal, a **scope** (`'profile' | 'household'`) and its writers. The matrices are generalized so
   that a household-addressed action is covered, not excluded.
2. **Turns the exclusion of an action from the matrix into a per-action, reasoned, pinned decision.**
3. **Names now the per-feature module each future action belongs in**, so new actions go to their
   eventual home and `actions.ts` stops growing.
4. **Records that the mutating steps serialize on `write-path.md`.**

It moves no app code, so no action ID changes. The physical split of the existing seven
(**"WP-1b"**) is not planned. It is one paragraph under Out-of-scope.

## Acceptance

There is no `plan.md` row and no spec criterion. The milestone lists step 0 as _"none (no
behaviour)"_ (`milestones/crud-1-fix-it-yourself.md:86`).

**The hole, stated precisely.** `pages-are-gated.test.ts:227-229` pins the set of Server Action
modules with `toEqual`, so a new module cannot appear silently. But the cross-check that ties
**actions** to `MUTATING_ACTIONS` reads only `actions.ts` (`actions.test.ts:1620-1627`). That means:

- A module **added to the pinned list** whose actions are **not added to `MUTATING_ACTIONS`** is
  skipped by the unauth matrix, the wrong-household matrix and the byte-identical-refusal check
  (`actions.test.ts:165-175`, `:1539-1606`).
- What still covers it is the source-text presence guard (`pages-are-gated.test.ts:252-271`). That
  guard proves the call exists, not that it runs before the DAL (`pages-are-gated.test.ts:192-194`).

**Done when:**

- **The probe is green on `origin/main` and red after WP-1, naming the failing `it`.** The probe adds
  `app/p/[profileId]/probe-actions.ts`, a `'use server'` module exporting one
  `(ActionState, FormData)` action with a `hasGateAccess()` first line, **and** its entry in the
  pinned list at `pages-are-gated.test.ts:228`. On `origin/main` every suite is green. After WP-1,
  **two** `it`s go red:
  - `'the exported actions are exactly MUTATING_ACTIONS'`, because the module's export is not
    registered;
  - `'every in-matrix module is in write-path.md owns:'`, because the module is not listed there.

  The probe is run in the PR, then deleted, not committed.

- **`MUTATING_ACTIONS` entries are `{ refusal, scope }`.** The unauth suite runs over **all** entries.
  The wrong-household suite and the byte-identical check run over `scope: 'profile'` entries. A
  household suite runs over `scope: 'household'` entries (below). With today's seven, all `profile`,
  the household suite has no rows. Its count `it` (below) keeps it from being an empty `describe`.
  The first household action (A1) fills it.
- **The binding is a discriminated union on `scope`.** It is:

  ```ts
  ACTION_BINDINGS: { [K in MutatingActionName]: Binding<(typeof MUTATING_ACTIONS)[K]['scope']> }
  ```

  - **Profile entries** are `{ fn, writers }`.
  - **Household entries** are `{ fn, writers, scopeMiss: () => void }`. `scopeMiss` makes **this**
    action's household DAL function resolve `null` (e.g.
    `() => vi.mocked(createProfile).mockResolvedValueOnce(null)`). So the generic household rows can
    drive each action's own scope miss, and a household binding without one is a **type** error. A
    missing binding of either kind is a type error too.

- **Writers are a non-empty tuple, and their union is checked against the DAL mocks.**
  - `writers: [Mock, ...Mock[]]` rejects `[]` at the type level.
  - Every refusal case asserts that **that action's** writers, and the union of all writers, were not
    called.
  - `ALL_WRITERS` (`actions.test.ts:157-163`) becomes the derived union, not a hand list.
    `updateProfileRoutine` joins it rather than being asserted separately (`:172`, `:1580`).
  - **Union check:** the derived union must **equal** every function export of the mocked
    `@/lib/dal/*` modules, minus an explicit `READERS` list (`getProfileByPublicId`,
    `ownedBodyweightValue`, `hasGateAccess` today; each with a one-line reason). The test reads the
    mocked modules' keys with `await import()` over `MOCKED_DAL` (`'@/lib/dal/entries'`,
    `'@/lib/dal/profiles'`, `'@/lib/dal/gate'`).
  - A further `it` asserts that `MOCKED_DAL` equals the set of `vi.mock('@/lib/dal/…')` specifiers in
    this file's own source, read through `code()`. So a newly mocked DAL module cannot be left out.
  - Result: a writer that no binding declares, and that is not a declared reader, is **red**.
- **`VALID_BODY` is a file-scope `Record<MutatingActionName, () => FormData>`**, up from
  `Record<string, …>` inside one describe (`:1541`). A household action cannot forget its body.
- **Exclusions are per action.** `OUTSIDE_THE_MATRIX` is keyed `'<module>#<export>'`, and each entry
  has a `reason` and a `provenBy` test file. Tests assert that each `provenBy` file exists, and that
  each excluded module's exported names equal **exactly** its listed names. A second, unlisted export
  in an excluded module goes red.
- **The two lists are pinned against each other.** `OUTSIDE_THE_MATRIX`'s modules ∩ the boundary
  `ALLOWLIST` equals exactly `['app/gate/actions.ts']`. Both lists live in one test-support module,
  and their docblocks name each other.
- **Every in-matrix module is in `write-path.md`'s `owns:`**, asserted by an `it`.
- **`use-server-exports.test.ts` enumerates through `serverActionModulePaths()`**, rooted at
  `apps/web`. Today it walks `app/` only (`use-server-exports.test.ts:37-40`), so a module under
  `lib/` or `components/` escapes the shape guard. 1b-bis widened the boundary guard to `apps/web`
  but not this one. Closing that gap is about 3 lines.
- **`write-path.md`, the `add-server-action` skill and `mutating-actions.ts`'s docblock** state the
  convention, the module names and the serialization finding. The "Changing it" row is the one list
  of steps; the skill points to it.
- **`pnpm verify` is green.** No file under `apps/web/app/**` changes except
  **`actions.test.ts`, `pages-are-gated.test.ts`, `use-server-exports.test.ts`**, and
  `mutating-actions.ts` (a shape change consumed only by tests; grep shows no app importer). No
  action ID, import or bundle changes.

## The finding: why a split alone does not unlock parallelism

Gate 1 is two intersections: the files, **and the guides' `owns:`** (`parallel-work.md:10-20`). The
guide checker matches an exact path or a directory prefix
(`.github/scripts/check-feature-guides.mjs:54`).

| Shared point a mutating step edits                                          | Owned by                                                 | Does splitting `actions.ts` remove it?                                                                                                                                                                                                                                     |
| --------------------------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/p/[profileId]/actions.ts`                                              | `write-path.md` (exact, `:5`)                            | At the file level, yes. Each module is still listed in the guide.                                                                                                                                                                                                          |
| `apps/web/lib/dal/*`: every new action needs a DAL function                 | `write-path.md` (**prefix**, `:4`)                       | **No.** A1 → `lib/dal/profiles.ts`; V1-9b and V1-24 2/3a → `lib/dal/entries.ts`, by V1-24 1b's precedent (`v1-24-form-is-the-day.md:272`). Their plans are not written, so this is _expected, unverified_. If it holds, B and E share a **code** file, not just the guide. |
| `packages/db/src/writers/*`                                                 | `write-path.md` (prefix) + `strength-logging.md` (exact) | No.                                                                                                                                                                                                                                                                        |
| `MUTATING_ACTIONS`, `ACTION_BINDINGS`, `VALID_BODY`, the pinned module list | no guide                                                 | No. **These are append points every action-adding PR edits, under the same serialization.** They are deliberately central: the byte-identical-refusal argument (`actions.test.ts:127-131`) is strongest when one place asserts it for every action.                        |

**What would make the lanes disjoint (open question 1):** narrow `write-path.md`'s `owns:` to the
seam files, give feature DAL and action modules to feature guides, and split `lib/dal/entries.ts`.
That gives up the guide's "touch any DAL file → read the write path" forcing function.
`lib/dal/scoped.test.ts` only partly replaces it: it covers scoping for every `lib/dal/*.ts`
(`scoped.test.ts:71`), but not the guide's other invariants, such as the DTO rule and the amend
branch.

**What "serialize" means:** at most one PR that edits `write-path.md` is **in review** at a time.
Plans and panels still run in parallel. The milestone's gate run records the order
(`milestones/crud-1-fix-it-yourself.md` → "Gate run").

## Options weighed

| Option                                                                                   | Verdict                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Split the seven now** (the spec's first recommendation)                             | **Rejected.** No gate-1 gain. It would touch three guides: `strength-logging.md` via `strength-form.tsx:39` and `editable-set.tsx:11`, `programming.md` via `routine/routine-editor.tsx:12`, and `write-path.md`. So it collides with V1-22 chunk 2, AUTH-1 1c (`auth-1-clerk-google.md:1707`), V1-24 3a and PICK-1. It also rotates every action ID. See Out-of-scope. |
| **B. Serialize, change nothing**                                                         | **Rejected.** The first household-addressed action has no home in the matrices. Its author would design the contract inside A1's PR, or exclude the action. A module listed in the pinned list but missing from the registry would still skip the matrices (the hole above).                                                                                            |
| **C. Split + re-own the DAL per feature + split `entries.ts`**                           | **Open question 1.** It is the only option that makes lanes disjoint, and it is a guide-policy change.                                                                                                                                                                                                                                                                  |
| **D. Generalize the registry and matrices, name the module set, serialize** (**chosen**) | It closes the hole and defines the household contract before A1 needs it. It moves no app code and needs no 1c re-plan. The steps still take turns on `write-path.md`, which they would have done anyway.                                                                                                                                                               |

## Staging

| PR       | What                                                                                                            | ~lines                                                    | Gate                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **WP-1** | The registry shape, generalized matrices, per-action exclusions, the shape guard re-rooted, the convention docs | ~300 (≈210 test and test-support, ≈70 docs, ≈20 registry) | **Not concurrent with AUTH-1 1b or 1c.** 1b edits `write-path.md` (`auth-1-clerk-google.md:1668`). 1c edits `actions.test.ts`, `write-path.md` and renames `pages-are-gated.test.ts` (`:1710-1717`). **It lands now, before 1b's branch is cut**, because 1b is next on the roadmap. If 1b has started, it lands in the gap after 1b merges and before 1c branches. Run `git worktree list` first. **Two live worktrees intersect:** `feat/auth-logout-button` edits `pages-are-gated.test.ts:228`, the line this PR's import change sits beside; whichever lands second merges and adds the `lockDeviceAction` exclusion. `docs/auth-1c-signout-findings` edits `auth-1-clerk-google.md`, the file the proposed 1d row edits. **The 1d row waits for that PR to merge, or is dropped** (open question 2). |

## File-by-file changes

| Path                                                    | Change | What and why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/app/p/[profileId]/mutating-actions.ts`        | EDIT   | Values become `{ refusal, scope }`. All seven are `scope: 'profile'`; the refusals are unchanged (`:24-32`). The `as const satisfies` keeps literal types (`:20-22`). Docblock (`:3-23`): "this route" becomes "every Server Action module in the app". The stale **"`pages-are-gated.test.ts` compares these keys against the actions it finds on disk"** (`:11-13`) is corrected: it is `actions.test.ts` that does, and `pages-are-gated` pins **modules**. Add a pointer to the module set in `write-path.md`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `apps/web/test/server-action-lists.ts`                  | NEW    | Test support. **`BOUNDARY_ALLOWLIST`**, hoisted verbatim from `pages-are-gated.test.ts:209` (module-keyed: exempt from the boundary call). **`OUTSIDE_THE_MATRIX`** (action-keyed: not a refusal-matrix action). Each docblock names the other list and the question it answers. Not a `.test.ts`, so both suites can import it without running each other.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `apps/web/test/source-scan.ts`                          | EDIT   | Add `serverActionModulePaths(): string[]` = `serverActionModules().map(f => relative(WEB_DIR, f))`. Three call sites compute that today or will. Add `guideOwns(guide: string): string[]`, a minimal frontmatter read. `check-feature-guides.mjs`'s `parseGuide` (`:30`) is not exported and the script runs on import, so it cannot be reused. The duplication is noted in its docblock.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `apps/web/app/p/[profileId]/actions.test.ts`            | EDIT   | **(a)** `ACTION_FNS` (`:142-150`) becomes `ACTION_BINDINGS` with `writers`; `ALL_WRITERS` becomes the derived union. **(b)** `VALID_BODY` moves to file scope as `Record<MutatingActionName, …>`. **(c)** The unauth suite (`:165-175`) runs over all entries and asserts the entry's writers. **(d)** The wrong-household suite and byte-identical check (`:1539-1606`) filter on `scope === 'profile'`. **(e)** A new household suite, shape below. **(f)** The cross-check (`:1608-1633`) is replaced, shape below. **(g)** Merge the duplicate imports; drop the four the cross-check no longer uses.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `apps/web/app/pages-are-gated.test.ts`                  | EDIT   | Import `BOUNDARY_ALLOWLIST` (replacing the local `:209`) and use `serverActionModulePaths()` (`:220`). **No other change.** The pinned list, the regex and the per-function slice stay, so 1c's later switch of `BOUNDARY_CALL` is unaffected.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `apps/web/app/p/[profileId]/use-server-exports.test.ts` | EDIT   | Replace the `walk(app)` + raw-text directive filter (`:19-40`) with `serverActionModulePaths()`, rooted at `apps/web`. Its own `'use server'` export-shape assertion (`:47-64`) is unchanged.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `docs/features/write-path.md`                           | EDIT   | Owned and CI-enforced. **(1)** `Files` row `:62`: `actions.ts` holds the seven pre-CRUD-1 actions. **The rule for new actions:** each goes in a per-feature `*-actions.ts` module, always plural. Its scope is declared in the registry, and the module is added to `owns:`; the ownership `it` enforces that. **The settled list (an open list that a new module adds to, not a closed set; it mirrors the spec's seams table):** `app/p/profile-actions.ts`, for PROF-1 (add athlete is household-scoped; rename, archive and restore are profile-scoped); `app/p/[profileId]/entry-actions.ts`, for V1-9b (hide, restore, clear a day; profile-scoped); `app/p/movement-actions.ts`, for MOV-1 (rename a movement; household-scoped); `app/p/program-actions.ts`, for V1-22 A4 create, CLONE-1 copy and RETIRE-1 archive/restore (household-scoped); `app/p/assignment-actions.ts`, for ASSIGN-1 set and undo (household-scoped; each item names its profile). The legacy seven stay in `app/p/[profileId]/actions.ts`, and `editRoutineAction` stays where it is. **(2)** Invariant 1 (`:94-98`): the registry's `scope`, the household suite, per-action exclusions, and the rule that **a household-addressed action may never go on the exclusion list**. **(3)** The three blind spots restated from `pages-are-gated.test.ts:196-201`: an inline `'use server'` closure, an anonymous default export, and Route Handlers (covered by the handler suite). **(4)** `Changing it` (`:478-488`) gets an "adding a Server Action" row: the **one** list of steps (module → registry entry with scope → binding with writers → `VALID_BODY` → pinned list → `owns:`). **(5)** A **Traps** entry: a second module does not split this guide; the mutating PRs take turns. |
| `.claude/skills/add-server-action/SKILL.md`             | EDIT   | §3's heading (`:43`) no longer names `actions.ts` as _the_ file; it points at write-path.md's module set and its "adding a Server Action" row, without restating the steps. The table row "unauth → reject test: **Nothing to test yet**" (`:19`) is false since SEC-1; it becomes "the registry-driven unauth suite". §5 (`:81-94`): per-action behaviour suites **colocate next to their module** (`<feature>-actions.test.ts`), the refusal-matrix rows stay central in `actions.test.ts`, and `form()` (`actions.test.ts:107`) is hoisted into `apps/web/test/` **when a second suite first needs it**, not before. `skills:check` verifies the cited paths.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `docs/plans/auth-1-clerk-google.md`                     | EDIT   | One row added to **1d's** table: delete `app/gate/actions.ts#submitGate` from `OUTSIDE_THE_MATRIX`. The dead-entry and pinned-intersection assertions force it. This adds to a merged plan's table, which `docs/plans/README.md` allows for a dependency it could not have known. ⚠️ **Edit only if the maintainer agrees**; otherwise 1d's author finds out from the red test.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `docs/changelog/<date>-test-wp-1-….md`                  | NEW    | A changelog fragment.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

### Shapes

```ts
// mutating-actions.ts
export const ACTION_SCOPE = { profile: 'profile', household: 'household' } as const;
export const MUTATING_ACTIONS = {
  logBodyweightAction: { refusal: NO_PROFILE_LOG, scope: ACTION_SCOPE.profile },
  // … six more, unchanged refusals
} as const satisfies Record<string, { refusal: string; scope: keyof typeof ACTION_SCOPE }>;

// test/server-action-lists.ts
/** Exempt from the boundary CALL (pages-are-gated). Compare OUTSIDE_THE_MATRIX. */
export const BOUNDARY_ALLOWLIST = ['app/gate/actions.ts'];
/** Not a refusal-MATRIX action (actions.test.ts). Compare BOUNDARY_ALLOWLIST. A household-addressed
 *  action may never be listed here: it goes in the matrix with scope 'household'. */
export const OUTSIDE_THE_MATRIX: Record<string, { reason: string; provenBy: string }> = {
  'app/gate/actions.ts#submitGate': {
    reason: 'issues the gate; cannot refuse an un-gated caller. Deleted at AUTH-1 1d.',
    provenBy: 'app/gate/actions.test.ts',
  },
};
```

**The household suite**, run over `scope: 'household'` entries. Household DAL functions resolve
`getHouseholdScope()` themselves (`write-path.md` invariant 2) and are mocked here. A scope miss
therefore reaches the action as the DAL's `null`, which the binding's `scopeMiss()` arranges. Inside
one `describe('every household-scoped action …')`:

- **`'counts its rows'`**, always present, asserts that `householdRows.length` equals the number of
  `household` registry entries. It is 0 today. This `it` keeps the `describe` non-empty, so the suite
  is visibly zero rather than silently absent. ⚠️ How vitest reports an `it.each([])` (skipped,
  passed, or an error) is **unverified**. The implementer runs it once and records the observed
  behaviour in the PR. If an empty `it.each` errors, the rows are guarded with `if (rows.length)`.
- **`'every household action has a body that succeeds'`** is the non-vacuity guard, mirroring
  `actions.test.ts:1555-1566`. With default mocks and no `scopeMiss()`, each `VALID_BODY[name]` must
  **succeed by its binding's `succeeded` predicate**, so a refusal below refuses for the scope reason.
  - Every binding (profile and household) takes an optional
    `succeeded?: (result: ActionState | undefined, mocks) => boolean`. The default is
    `result?.ok === true`, which every legacy action uses.
  - **A household action that redirects on success** never returns `ok: true`. PROF-1's
    `addAthleteAction` is the first; later `program-actions` and `assignment-actions` follow. With
    `next/navigation` mocked, `redirect` returns `undefined`, so such an action's predicate asserts
    instead that `redirect` was called with the expected path and `RedirectType.replace`.
  - **`next/navigation` is mocked once, centrally** in `actions.test.ts`:
    `vi.mock('next/navigation', …)` with `redirect: vi.fn()` and the real `RedirectType`. No such mock
    exists in the file today (grep). The profile matrices are unaffected, since no legacy action
    redirects.
  - On a refusal row, `redirect` must **not** have been called. That is added to the unauth,
    wrong-household and scope-miss rows' assertions.
- **Per row, after `scopeMiss()`:**
  - the action returns `{ ok: false, error: refusal }`;
  - `getProfileByPublicId` is **not** required to have run;
  - the scope-missing DAL function **was** called (the row reached the scope check);
  - no other writer ran, and `revalidatePath` was not called;
  - the refusal is byte-identical to the action's un-gated refusal.

The real "scope miss → no row" proof belongs to that action's `db:verify` section, which A1 owns.

**The cross-check (replaces `:1608-1633`):**

- `inMatrix` = every action exported by every `serverActionModulePaths()` module, minus
  `OUTSIDE_THE_MATRIX` keys. The suite asserts:
  - _"the exported actions are exactly MUTATING_ACTIONS"_ (sorted equality). This also catches a
    duplicate name across modules, so no separate uniqueness `it` is added.
  - _"the scan is not vacuous"_.
- **Per excluded module:** its exports equal exactly its listed names, and each `provenBy` file
  exists.
- **The lists against each other:** the excluded modules ∩ `BOUNDARY_ALLOWLIST` equals
  `['app/gate/actions.ts']`.
- **Ownership:** each module that holds an in-matrix action ∈ `guideOwns('docs/features/write-path.md')`.

## Test plan

Unit tier only, with no DB. Run `pnpm --filter web test app/`, then `pnpm verify`. That covers
`guides:check` for `write-path.md`, `skills:check` for the skill, `guards:test`, and typecheck (the
`Record<MutatingActionName, …>` bindings). Record in the PR description:

1. **The probe** from Acceptance. It is green on `origin/main` and red after WP-1, naming the failing
   `it`.
2. **A household probe.** Add a temporary `scope: 'household'` entry bound to a stub action and a
   stub mocked DAL function. Then run three variants:
   - **(a)** The stub skips its gate check: its unauth row goes red.
   - **(b)** The stub ignores the DAL's `null` and returns `ok: true`: its scope-miss row goes red.
   - **(c)** The binding omits `scopeMiss`: typecheck fails.

   Restore the stub and all rows go green, with `'counts its rows'` now reporting 1.

3. **An exclusion probe.** Add a second export to `app/gate/actions.ts`. The "exactly its listed
   names" `it` goes red.
4. **A writer probe: a writer no binding declares goes red.** Add an export to the mocked
   `@/lib/dal/entries` factory that is in no binding's `writers` and not in `READERS`. The writer-union
   `it` goes red. Separately, `writers: []` fails typecheck.

Delete every probe before committing. Run `hold-the-bar`, because this PR edits guards. The mandatory
backend boundary cases (unauth, wrong owner, bad body, replay) are unchanged for the seven and run
against the same functions.

## Risks / rollback

| Risk                                                                                                                        | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The unmerged `feat/auth-logout-button` branch** adds `app/p/lock-device-action.ts` (`lockDeviceAction`, `() => redirect`) | After WP-1 it needs an `OUTSIDE_THE_MATRIX` entry with a `provenBy` (its `lock-device-action.test.ts`) in whichever PR lands second. Its signature takes no `ActionState`, and it is not household-addressed. ⚠️ **It goes red at AUTH-1 1c, not 1d.** It calls `hasGateAccess()`, and 1c switches `BOUNDARY_CALL` to the session names (`pages-are-gated.test.ts:211-217`), so 1c must convert or delete it.                                                                                                                                                                                                                                              |
| **The exclusion list becomes an escape hatch**                                                                              | Entries are per action, each with a reason and a proving test that must exist. Each excluded module's exports are pinned exactly. The intersection with the boundary allowlist is pinned to one module. ⚠️ **"A household action may never be excluded" is prose and review, not a type or an assertion.** An excluded export is by definition not in the registry, so nothing records its scope to type against. The rule lives in `write-path.md` invariant 1 and in `OUTSIDE_THE_MATRIX`'s docblock. Its only mechanical backing is that every exclusion is a visible, reasoned edit to one test-support file. This is said plainly instead of claimed. |
| **The registry shape change breaks a consumer**                                                                             | The only importers are `actions.test.ts` and, after this PR, `pages-are-gated.test.ts` (grep). No app code reads `MUTATING_ACTIONS`. Typecheck covers it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Collision with AUTH-1 1b or 1c**                                                                                          | Staging gate. 1c's plan rows still apply as written: it edits the unauth suite's mocks (`auth-1-clerk-google.md:1712`), which now iterates the registry. **After 1c lands, re-verify** that its `{no session, no membership, wrong household, unknown id}` matrix is built from `MUTATING_ACTIONS` and honours `scope`, and that its `BOUNDARY_CALL` switch did not widen to an alternation.                                                                                                                                                                                                                                                               |
| **Write-path integrity, idempotency, `getHouseholdScope()` scoping, CSV byte-faithfulness, LLM-never-authors-loads**        | Untouched. No DAL, writer, schema, export or prompt file is in the table.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

**Rollback:** revert the PR. It changes tests, test support and docs only.

**Privacy:** nothing stored, sent or retained changes, so `docs/privacy/data-inventory.md` is
unchanged. **Feature guides:** `write-path.md` only. **UI:** none, so no UX panel is owed.

## Out-of-scope / deferred

- **WP-1b, the physical split of the existing seven.** It is not planned. If it is ever filed, it
  must:
  - state that it buys **no gate-1 relief**;
  - land only after AUTH-1 1c is observed live and V1-22 chunk 2 has merged;
  - deploy outside the household's evening logging window. Moving a function rotates its action ID,
    so a stale page gets _"Failed to find Server Action"_. Next already rotates IDs _"at most every 14
    days"_ (`node_modules/next/dist/docs/01-app/02-guides/server-actions.md:174`), and every create
    is idempotent by `client_id`;
  - repoint every `vi.mock('./actions')`, because a stale mock path silently un-mocks. Proof: a grep
    for `'./actions'` / `'../actions'` under `app/p` returns nothing;
  - prove body identity with a **helper-aware** slice. The private `valueSchemaFor` and
    `deriveSupersets` (`actions.ts:137-153`, `:247-258`) sit between exports, so a naive
    export-to-export slice would compare them as part of the wrong function.

  Trigger: `actions.ts` passes ~800 lines, or two in-flight PRs need to edit existing actions in it at
  once.

- **Option C:** open question 1.
- **Splitting `actions.test.ts`.** Per-action behaviour suites colocate beside new modules (see the
  skill edit). The matrices stay central.
- **Moving `mutating-actions.ts` out of `[profileId]/`.** It would re-point AUTH-1 1c's plan text
  (`auth-1-clerk-google.md:1638,1712`). That is a call for after 1c.
- `docs/plan.md` and `docs/roadmap.md` are not edited on this branch. The WP-1 row and link land when
  the PR opens.

## Open questions

1. **Option C, for the maintainer:** should `write-path.md` stop owning `apps/web/lib/dal/` as a
   prefix and own only the seam (with feature DAL to feature guides, plus an `entries.ts` split) so
   that lanes A and B can run concurrently after 1c? **Author's lean: no, for CRUD-1.** The lanes are
   short and mostly gated serially already.
2. **For the maintainer:** may WP-1's PR add the 1d row to the merged AUTH-1 plan, or should the red
   test be the notice?

## Review-response log

### Engineering panel, round 1 (correctness, scope, architecture, reuse, security)

| #   | Lens                            | Critique                                                                                                                 | Verdict      | Resolution                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | All five                        | Probe (a) is already red on `main`: `pages-are-gated.test.ts:227-229` pins the module set with `toEqual`                 | **accepted** | The hole is restated as "listed in the pinned list but missing from `MUTATING_ACTIONS` → the matrices skip it". The probe adds the module **and** its pinned entry, and names the failing `it`. Option B and the old "already iterate every module" paragraph are rewritten. Acceptance lists every test file touched.                                                                                                                                                         |
| 2   | Correctness B1, Arch B2, Sec B2 | A household-addressed action (A1) cannot pass the profile matrix (`actions.test.ts:1579` asserts `getProfileByPublicId`) | **accepted** | The registry carries `scope`. Unauth runs over all entries; wrong-household and byte-identical run over profile entries; a household suite was added. "No legitimate reason to be excluded" and "handles either answer" are deleted. **A household action may never be excluded.** This is now the plan's main purpose.                                                                                                                                                        |
| 3   | Security B1, Correctness #4     | Exclusions should be per action, pinned exactly, intersected with the allowlist, and proven                              | **accepted** | `'<module>#<export>'` keys with `reason` + `provenBy`. Each excluded module's exports are pinned exactly. ∩ `BOUNDARY_ALLOWLIST` is pinned to `app/gate/actions.ts`. The `provenBy` files' existence is asserted.                                                                                                                                                                                                                                                              |
| 4   | Correctness #3                  | Registering an action must prove its own writer is not called on refusal                                                 | **accepted** | `ACTION_BINDINGS[name].writers` is required by type. `ALL_WRITERS` is derived. A writer probe was added.                                                                                                                                                                                                                                                                                                                                                                       |
| 5   | Security S2, S3, S4             | Gate on 1b too; add 1d's row; re-root `use-server-exports`; the logout action reds at 1c                                 | **accepted** | Staging says "not concurrent with 1b or 1c" and when it lands. The 1d row is proposed (open question 2, since it edits a merged plan). `use-server-exports.test.ts` uses `serverActionModulePaths()`. The `lockDeviceAction` risk row says 1c.                                                                                                                                                                                                                                 |
| 6   | Scope #3                        | WP-1b's file table and proof are speculative weight                                                                      | **accepted** | Cut to one "if ever filed, it must…" paragraph, including correctness #5's helper-aware slice. The old OQ3 is deleted.                                                                                                                                                                                                                                                                                                                                                         |
| 7   | Architecture #3                 | Name the module set now                                                                                                  | **accepted** | Six modules are named in `write-path.md`'s `Files` row, always plural `-actions.ts`, `/p`-level `profile-actions.ts` included.                                                                                                                                                                                                                                                                                                                                                 |
| 8   | Arch #4, Scope #7, Security N3  | The gate-6 "grouping keeps hunks apart" claim does not hold                                                              | **accepted** | Dropped. The registry, bindings, bodies and pinned list are named as append points under the same serialization.                                                                                                                                                                                                                                                                                                                                                               |
| 9   | Architecture #5                 | Assert that each module is in `write-path.md`'s `owns:`                                                                  | **accepted** | Added as an `it` via `guideOwns()`.                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 10  | Reuse #2, #3, #4, #6; Scope #6  | Shared path helper; lists name each other; colocated suites; one list of steps; stale docblocks; imports                 | **accepted** | `serverActionModulePaths()` added. Both lists live in one test-support file whose docblocks cross-reference. Skill §5 colocation and the `form()` hoist "when needed". `write-path.md`'s "Changing it" row is the one list and the skill points to it. `mutating-actions.ts:11-13` and `SKILL.md:19` are corrected. Imports are merged and the unused ones dropped. `parseGuide` cannot be imported (the script runs on import), so `guideOwns` is a noted, minimal duplicate. |
| 11  | Correctness #6, #8; Scope #5    | The uniqueness `it` and probe (b) are redundant with the equality; `VALID_BODY` is loosely typed                         | **accepted** | Both are dropped: sorted equality with the registry's keys already fails on a duplicate. `VALID_BODY` is `Record<MutatingActionName, …>` at file scope.                                                                                                                                                                                                                                                                                                                        |
| 12  | Security N1                     | The convention text must restate the blind spots                                                                         | **accepted** | `write-path.md` edit (3) restates them.                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 13  | Scope #2                        | Make WP-1 a recorded decision and fold the cross-check into PROF-1a                                                      | **rejected** | With items 2–5 the guard is no longer ~15 lines. It is a security-relevant contract (household scope, per-action exclusions, writer lists) that A1's review should **inherit, not also design**. Landing it before the first second module also keeps A1's PR under 400 lines.                                                                                                                                                                                                 |
| 14  | Scope #4                        | Add the WP-1 row to `plan.md` and edit the roadmap now                                                                   | **rejected** | The maintainer's brief bars this branch from editing `docs/plan.md` and `docs/roadmap.md`. The row and link land when the PR opens. The spec paragraph and the milestone step-0 text that this plan's first draft listed as contradictions **have been corrected by the orchestrator** (`crud-1-fix-it-yourself.md:199-206`, `milestones/crud-1-fix-it-yourself.md:51,59,86`), so they are removed from this plan.                                                             |

### Re-review (round 2) — security

The security lens re-reviewed the plan. The probe, the per-action exclusions and the ordering are
resolved.

| #   | Lens                           | Critique                                                                                                                                                                                                                   | Verdict      | Resolution                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Security                       | **BLOCKING.** `{ fn, writers }` gives a generic household row no way to make _this_ action's DAL return `null`                                                                                                             | **accepted** | Binding is a discriminated union on `scope`; household entries require `scopeMiss()` (type-enforced). Added a household "valid body succeeds" guard mirroring `actions.test.ts:1555-1566`, and a "scope-missing DAL fn was called" assertion. Probe 2 gains a scope-miss variant and a missing-`scopeMiss` typecheck variant. The household-never-excluded rule is now stated in Risks as **prose and review**, with the reason no type can carry it. |
| R2  | Security                       | **BLOCKING.** `writers: Mock[]` accepts `[]`, so an undeclared writer is asserted by nothing                                                                                                                               | **accepted** | `writers: [Mock, ...Mock[]]`. The derived union must equal every function export of the mocked `@/lib/dal/*` modules minus `READERS`. `MOCKED_DAL` is pinned to the file's own `vi.mock` specifiers. Probe 4 is restated as "a writer no binding declares → red".                                                                                                                                                                                     |
| R3  | Security                       | Should: name the intersecting worktrees                                                                                                                                                                                    | **accepted** | Staging names `feat/auth-logout-button` and `docs/auth-1c-signout-findings`. The 1d row waits for the latter or is dropped.                                                                                                                                                                                                                                                                                                                           |
| R4  | Security                       | Should: record both `it`s the probe turns red                                                                                                                                                                              | **accepted** | Acceptance names the registry-equality `it` **and** the `write-path.md`-ownership `it`.                                                                                                                                                                                                                                                                                                                                                               |
| R5  | Security                       | Should: keep the count `it` inside the household describe; confirm vitest's empty `it.each`                                                                                                                                | **accepted** | `'counts its rows'` lives in the household `describe`. The empty-`it.each` behaviour is marked **unverified**, to be observed once and recorded, with a fallback.                                                                                                                                                                                                                                                                                     |
| R6  | Architecture (sibling plans)   | The "fixed module set" in the `write-path.md` text diverged from what PROF-1, V1-9b, MOV-1, the program plans and ASSIGN-1 need                                                                                            | **accepted** | Replaced with the rule (per-feature plural `*-actions.ts`, scope in the registry, module in `owns:`, enforced by the ownership `it`) plus the settled, open list from the spec's seams table. The legacy seven and the routine action stay put. This supersedes round 1, row 7's six-module list.                                                                                                                                                     |
| R7  | Correctness (PROF-1 re-review) | A household action that redirects on success (PROF-1's `addAthleteAction`; later program and assignment actions) can never pass the "valid body returns `ok: true`" check, because a mocked `redirect` returns `undefined` | **accepted** | Each binding takes an optional `succeeded(result, mocks)` predicate (default `result.ok === true`). A redirecting action's predicate asserts `redirect` was called with the expected path and `RedirectType.replace`. `next/navigation` is mocked centrally, and every refusal row asserts no `redirect`.                                                                                                                                             |

_Round 3 pending._
