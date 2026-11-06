# WP-1 — every Server Action module in the boundary matrix; why the steps still serialize

> Backlog: [WP-1](../plan.md#wp-1) · Spec:
> [crud-1-fix-it-yourself.md](../specs/crud-1-fix-it-yourself.md) chunk "The critical path" (last
> paragraph) and Risks row "Four tracks queue on `actions.ts`" · Milestone:
> [CRUD-1](../milestones/crud-1-fix-it-yourself.md) step 0 · Branches:
> `refactor/wp-1a-registry-scope`, then `refactor/wp-1b-no-silent-module`

> 🔴 **REFRESHED and RE-PANELLED 2026-11-06** against `bfd3e05`, after `AUTH-1` 1b-bis, 1c and 1d and the
> `enterMutation` collapse (#323) landed. The central finding survives; roughly half the proposed work
> had already shipped incidentally; every citation was re-read. **One PR, not two** — a first pass
> split this and all five lenses rejected the seam (log round 3, S1). What changed and why is in the
> log, not here.
>
> **Roadmap alignment:** advances [CRUD-1](../milestones/crud-1-fix-it-yourself.md) step 0 and **gates
> `PROF-1` a-r**. No other row owns the question (`git grep -in "boundary matrix" -- docs/plan.md
docs/roadmap.md` → WP-1's row only). `ID-1`'s six keep-open items are answered in § Standing
> obligations.
>
> ⚠️ **Rebase onto [#341](https://github.com/ralamode/mat-plan/pull/341) before implementing.** It
> fixes `guides:check`, which was reading **3 of `write-path.md`'s 13** `owns:` entries — including
> `mutation-entry.ts` and `mutating-actions.ts`, the two files this PR moves and edits. Until it
> lands, this plan's guide obligations are not actually CI-enforced.

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

**The hole, stated precisely.** `pages-need-a-session.test.ts:227-229` pins the set of Server Action
modules with `toEqual`, so a new module cannot appear silently. But the cross-check that ties
**actions** to `MUTATING_ACTIONS` reads only `actions.ts` (`actions.test.ts:1620-1627`). That means:

- A module **added to the pinned list** whose actions are **not added to `MUTATING_ACTIONS`** is
  skipped by the unauth matrix, the wrong-household matrix and the byte-identical-refusal check
  (`actions.test.ts:165-175`, `:1539-1606`).
- What still covers it is the source-text presence guard (`pages-need-a-session.test.ts:252-271`). That
  guard proves the call exists, not that it runs before the DAL (`pages-need-a-session.test.ts:231` — _"it proves the call is PRESENT, not that it runs BEFORE the DAL"_).

**Done when:**

- **The probe is green on `origin/main` and red after this PR.** It adds
  `app/p/[profileId]/probe-actions.ts` — a `'use server'` module exporting one
  `(ActionState, FormData)` action that goes through `enterMutation` (the call, plus the
  `if (!entry.ok) return entry;` that `ENTRY_REFUSAL`'s backreference demands) — **and** its entry in
  the pinned module list (`pages-need-a-session.test.ts:306`). Run in the PR, then deleted, not
  committed.
  - ⚠️ **The October probe specified `hasGateAccess()` as the first line. 1d deleted it**, so that
    probe would not compile; it survives only in comments recording its removal
    (`actions.test.ts:1628`, `export/route.ts:59`, `pages-need-a-session.test.ts:258`). That was the
    one real defect in it.
  - 🔴 **RETRACTED: an earlier pass of this refresh also claimed the October probe "named the wrong
    `it`s". It did not, and the claim was wrong on the facts.** The name it used — _"the exported
    actions are exactly MUTATING_ACTIONS"_ — is the name § Shapes gives this plan's **own**
    generalized cross-check, not the existing test, which has been
    `'exports exactly the actions MUTATING_ACTIONS names'` since #300 on **2026-10-22**, the day
    before the plan was drafted (`git log -S`). Both `it`s the original named do go red after this
    PR. Corrected by the correctness lens (round 3, C1); kept visible because a confident
    "correction" that invents a defect is worse than the stale citation it replaced.
  - ✅ **Why it is green on `main`, which is the hole:** `ALL_ACTIONS` is `Object.keys(MUTATING_ACTIONS)`
    mapped (`actions.test.ts:162-164`), and every refusal matrix iterates it — unauth `:187`,
    rate-limit `:208`, limiter-keyed-on-principal `:220`, wrong-household `:1621`, plus the
    valid-body `:1611` and byte-identical `:1643` loops. **Six iteration sites, all from the
    registry's keys**; a second module's actions enter none. What still covers the probe is the
    source-text triple, which proves the call is **present, not that it runs before the DAL**
    (`pages-need-a-session.test.ts:231`).
  - **After this PR** the generalized cross-check goes red naming `probeAction` — and **stays red
    after a line is added to `owns:`**, which is the point: bookkeeping must not buy coverage. It goes
    green only once the action is registered, at which point `Record<MutatingActionName, Binding>`
    forces a binding and all six sites run it.

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
- **Exclusion is a member of the registry union, pinned empty.** `{ excluded: { reason, provenBy } }`
  beside `{ refusal, scope }`, so a household action cannot be excluded as a matter of type (§ Shapes).
  `expect(excludedNames()).toEqual([])` today — every future entry is an edit to a pinned assertion,
  the `ALLOWLIST` idiom at `pages-need-a-session.test.ts:321`.
  ⚠️ **An earlier pass of this plan required the intersection of the exclusion list and the boundary
  `ALLOWLIST` to equal `['app/gate/actions.ts']`.** 1d deleted that file and `ALLOWLIST` is now `[]`,
  so the assertion was red on arrival — one of five places the refresh left pinning a deleted file
  (round 3, found by three lenses independently).
- **`provenBy` is source-scanned, not merely `existsSync`'d** _(security S8)_: the named file must
  contain the export name and a no-session case. "The file exists" proves nothing about what it
  proves.
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
  **`actions.test.ts`, `pages-need-a-session.test.ts`, `use-server-exports.test.ts`**, and
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

## What `AUTH-1` already built — the scope this refresh CUTS

Re-read against `bfd3e05` on 2026-11-06. Roughly half of what the October plan proposed arrived
incidentally with 1b-bis, 1c, 1d and the `enterMutation` collapse (#323). **Cut, not re-done:**

| Already on `main`                                                                  | Where                                                                |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| The boundary call unified into **one** helper                                      | `app/p/[profileId]/mutation-entry.ts:60`                             |
| Session **then** limiter, order asserted by position, not by reading               | `pages-need-a-session.test.ts:379-386`                               |
| Per-action proof that the call is present AND its result returned (backreferenced) | `ENTRY_CALL` `:272` · `ENTRY_REFUSAL` `:282` · `ENTRY_IMPORT` `:273` |
| The unauth matrix over **all** registered actions                                  | `actions.test.ts:186-198`                                            |
| A **rate-limit** matrix — not in the October plan at all                           | `actions.test.ts:207-225`                                            |
| The wrong-household matrix + byte-identical refusal check                          | `actions.test.ts:1589-1659`                                          |
| `MUTATING_ACTIONS` as the single source the matrices iterate                       | `mutating-actions.ts:24-32`                                          |
| The module scan, rooted at `apps/web` rather than `app/`                           | `test/source-scan.ts:75`                                             |
| `ALLOWLIST` exists **and is pinned empty**                                         | `pages-need-a-session.test.ts:255`, `:321`                           |

⚠️ **`ALLOWLIST` is not WP-1 point 2, and the two are easy to conflate.** It exempts a **module**
from having to make the boundary call at all — its only ever entry was the gate's own action, which
_issued_ the code rather than checking it. `OUTSIDE_THE_MATRIX` excludes an **action** from the
refusal matrices while it still makes the boundary call. Different question, different key, both
needed, and `WP-1b` is where they finally sit side by side with docblocks that say so.

🔴 **What is NOT built, and is therefore the real scope.** The thing that matters most is first,
because `PROF-1` is blocked on it: **`MUTATING_ACTIONS` is `{ name: refusalString }`, not
`{ refusal, scope }`** — so there is no way to say "this action is household-addressed", and
`addAthleteAction` must either fail the profile-only wrong-household suite (which asserts
`getProfileByPublicId` was called with a `PROFILE_ID`, `actions.test.ts:1631`) or be excluded by a
mechanism that does not exist. Then: no household suite · no `ACTION_BINDINGS` · no
`OUTSIDE_THE_MATRIX` · no ownership `it` · no `server-action-lists.ts` · no `guideOwns()` · the
module-naming convention absent from the guide · and the `mutation-entry.ts` move.

## Staging

**One PR**, `refactor/wp-1-shard-actions`, ~160 lines, almost all tests. Gate: none —`AUTH-1` is
complete and `git worktree list` shows nothing else in flight; rebase onto #341 first (banner).

| What                                                                                                                        | ~lines |
| --------------------------------------------------------------------------------------------------------------------------- | ------ |
| `MUTATING_ACTIONS` becomes a discriminated union: `{ refusal, scope }` or `{ excluded: { reason, provenBy } }`              | ~15    |
| The cross-check generalized off `actions.ts` — **every** scanned module's exports vs the registry                           | ~15    |
| `ACTION_BINDINGS` (one table: `fn`, `writers`, `body`, optional `scopeMiss`), `ALL_WRITERS` derived, `VALID_BODY` folded in | ~40    |
| The profile matrices filter `scope === 'profile'`; unauth and rate-limit stay over **all** entries                          | ~10    |
| `mutation-entry.ts` → `app/p/`, imported by one pinned alias                                                                | ~25    |
| `write-path.md`, the `add-server-action` skill, changelog                                                                   | ~55    |

🔴 **A first pass split this into `WP-1a` / `WP-1b` and the panel rejected it unanimously** (round 3).
The seam was drawn so that the generalized cross-check landed second — but `PROF-1` a-r registers
`renameAthleteAction` while that function lives in `app/p/profile-actions.ts`, so the registry would
carry 8 keys against `actions.ts`'s 7 exports and `actions.test.ts:1679`'s `toEqual` goes red. a-r
therefore needed **both** PRs, which is the opposite of the split's stated purpose. The security lens
added the sharper form: between the two PRs, PROF-1's module could land covered by the pinned list and
a source-text guard only — the exact window this plan exists to close. Collapsed, and the cut items
(§ Out-of-scope) take the line count below the original single-PR estimate.

## File-by-file changes

| Path                                                                                | Change      | What and why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/app/p/[profileId]/mutation-entry.ts` → `apps/web/app/p/mutation-entry.ts` | MOVE        | 🔴 **New obligation, not in the October plan, found while planning `PROF-1`.** `ENTRY_IMPORT` pins the import as a **literal string** — `/import\s*\{\s*enterMutation\s*\}\s*from\s*'\.\/mutation-entry'/` (`pages-need-a-session.test.ts:273`) — so `./mutation-entry` resolves only from `app/p/[profileId]/`. `PROF-1` D5 puts the household-level actions at `app/p/profile-actions.ts`, one level up, where that import does not resolve. Three ways out; **this plan takes the first**: move the helper to `app/p/`, the directory every `/p` action module shares. Rejected: leave it and import `./[profileId]/mutation-entry` (the pinned regex refuses it, and a route-group path in an import is a footgun the repo already avoids in `owns:` globs); or copy it (the seven-copies shape `write-path.md` invariant 1 exists to forbid). **Carries with it:** `actions.ts`'s own import `./mutation-entry` → `../mutation-entry`; `ENTRY_IMPORT` widened to accept both depths; `write-path.md`'s `owns:` entry for the file; and `mutation-entry.test.ts` moves alongside. ⚠️ `ALLOWLIST` is NOT involved — it exempts a _module_ from the boundary call, which this is not.                                                                                                                                                                                               |
| `apps/web/app/p/[profileId]/mutating-actions.ts`                                    | EDIT        | Values become `{ refusal, scope }`. All seven are `scope: 'profile'`; the refusals are unchanged (`:24-32`). The `as const satisfies` keeps literal types (`:20-22`). Docblock (`:3-23`): "this route" becomes "every Server Action module in the app". The stale **"`pages-need-a-session.test.ts` compares these keys against the actions it finds on disk"** (`:11-13`) is corrected: it is `actions.test.ts` that does, and `pages-need-a-session` pins **modules**. Add a pointer to the module set in `write-path.md`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `apps/web/test/source-scan.ts`                                                      | EDIT        | Add `serverActionModulePaths(): string[]` = `serverActionModules().map(f => relative(WEB_DIR, f))`. Three call sites compute that today or will. Add `guideOwns(guide: string): string[]`, a minimal frontmatter read. `check-feature-guides.mjs`'s `parseGuide` (`:30`) is not exported and the script runs on import, so it cannot be reused. The duplication is noted in its docblock.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `apps/web/app/p/[profileId]/actions.test.ts`                                        | EDIT        | ⚠️ **Citations re-read 2026-11-06:** `ACTION_FNS` is at `:152-160`, `ALL_WRITERS` at `:167`, `ALL_ACTIONS` at `:162-164`, the unauth suite at `:186-198`, the rate-limit suite at `:207-225` (**new since October** — add it to the list that filters on scope), `VALID_BODY` at `:1591` (local to the wrong-household describe, as the plan said), the wrong-household suite at `:1589-1659`, the byte-identical check at `:1640`, and the cross-check at `:1671-1685`. **(a)** `ACTION_FNS` (`:152-160`) becomes `ACTION_BINDINGS` with `writers`; `ALL_WRITERS` becomes the derived union. **(b)** `VALID_BODY` moves to file scope as `Record<MutatingActionName, …>`. **(c)** The unauth suite (`:165-175`) runs over all entries and asserts the entry's writers. **(d)** The wrong-household suite and byte-identical check (`:1539-1606`) filter on `scope === 'profile'`. **(e)** A new household suite, shape below. **(f)** The cross-check (`:1608-1633`) is replaced, shape below. **(g)** Merge the duplicate imports; drop the four the cross-check no longer uses.                                                                                                                                                                                                                                                                                                    |
| `apps/web/app/pages-need-a-session.test.ts`                                         | EDIT        | 🔴 **`ENTRY_IMPORT` is re-pinned to ONE literal, never widened to an alternation.** The move makes `'./mutation-entry'` wrong from `app/p/[profileId]/`, and the obvious fix — accept `'./'` or `'../'` — is **forbidden by this file's own standing rule** (`write-path.md:161`, `:258-261`: _"one matching either passes on either and proves neither"_). It also opens a shadow: a new local `app/p/[profileId]/mutation-entry.ts` shim would satisfy `'./mutation-entry'` from `actions.ts` while `:380` inspects only the canonical file — the _"local function of the same name"_ hole at `:360`, returning as a local MODULE. And "both depths" is already wrong: spec `:560` puts V1-22's edit actions under `app/p/[profileId]/program/`, a third depth. **Decided: every module imports `@/app/p/mutation-entry`**, so one literal covers every depth and no relative shim can satisfy it (`@/app/` already used in `app/design/tokens/page.tsx`). ⚠️ **`:380` must move too** — it is `code(join(APP_DIR, 'p', '[profileId]', 'mutation-entry.ts'))`, the one `it` proving session-before-limiter order, and it throws ENOENT after the move. The October plan and the first refresh both missed it; `PROF-1:559-560` had already named it as owed. **Also:** import `ALLOWLIST` stays local (reuse S1 — single-use, already `[]`); `serverActionModulePaths()` at `:306`. |
| `apps/web/app/p/[profileId]/use-server-exports.test.ts`                             | EDIT        | Replace the `walk(app)` + raw-text directive filter (`:19-40`) with `serverActionModulePaths()`, rooted at `apps/web`. Its own `'use server'` export-shape assertion (`:47-64`) is unchanged.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `docs/features/write-path.md`                                                       | EDIT        | Owned, and **CI-enforced only once [#341](https://github.com/ralamode/mat-plan/pull/341) lands** — the guide's `owns:` list was being read as 3 entries of 13, `mutation-entry.ts` and `mutating-actions.ts` among the ten unguarded. Edits: the `owns:` path for the moved helper; invariant 1 gains the registry union, the `scope` field and the type-level rule that a household action cannot be excluded; a **pointer** to the spec's seams table for the module list rather than a sixth copy of it (reuse S3 — the spec calls itself _"the one home"_ at `:540-541`); an "adding a Server Action" row in `Changing it`; and a Traps entry that a second module does not split this guide. ⚠️ The three blind spots stay a **link** to `pages-need-a-session.test.ts:235-243`, not a copy.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `.claude/skills/add-server-action/SKILL.md`                                         | EDIT        | §3's heading (`:43`) no longer names `actions.ts` as _the_ file; it points at write-path.md's module set and its "adding a Server Action" row, without restating the steps. The table row "unauth → reject test: **Nothing to test yet**" (`:19`) is false since SEC-1; it becomes "the registry-driven unauth suite". §5 (`:81-94`): per-action behaviour suites **colocate next to their module** (`<feature>-actions.test.ts`), the refusal-matrix rows stay central in `actions.test.ts`, and `form()` (`actions.test.ts:107`) is hoisted into `apps/web/test/` **when a second suite first needs it**, not before. `skills:check` verifies the cited paths.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ~~`docs/plans/auth-1-clerk-google.md`~~                                             | **DROPPED** | 🔴 **Moot as of 2026-11-06.** The row was to remove `app/gate/actions.ts#submitGate` from `OUTSIDE_THE_MATRIX` when 1d deleted the gate. **1d has merged and the file is gone**, and `OUTSIDE_THE_MATRIX` was never built, so there is nothing to remove from nothing. `ALLOWLIST` is already `[]` for the same reason. No edit to a merged plan is needed, which also retires open question 2.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `docs/changelog/<date>-test-wp-1-….md`                                              | NEW         | A changelog fragment.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

### Shapes

**One table of every exported action, in `mutating-actions.ts`** _(reuse lens, round 3 S1 — it
replaces the three-list design the October plan had)_:

```ts
export const ACTION_SCOPES = ['profile', 'household'] as const;
export const ACTION_SCOPE = keyBySelf(ACTION_SCOPES); // the enums.ts idiom
export type ActionScope = (typeof ACTION_SCOPES)[number];

export const MUTATING_ACTIONS = {
  logBodyweightAction: { refusal: NO_PROFILE_LOG, scope: ACTION_SCOPE.profile },
  // …the other six, all `profile` today
} as const satisfies Record<string, MatrixEntry | ExcludedEntry>;
```

🔴 **Exclusion is a member of the same union, not a second list.** `ExcludedEntry` is
`{ excluded: { reason: string; provenBy: string } }`. Three things fall out that the October design
needed extra machinery for:

- **"A household-addressed action may never be excluded" becomes a TYPE error**, not a prose rule —
  an entry cannot carry both `scope` and `excluded`. The October plan stated it as prose
  (`OUTSIDE_THE_MATRIX`'s docblock) with nothing enforcing it.
- **The cross-check is plain equality** — every scanned module's exports vs `Object.keys()` — with no
  second list to subtract. One identity per action (the bare export name), not
  `'<module>#<export>'` beside it.
- **`MatrixActionName` is a mapped-type filter**, so `ACTION_BINDINGS` is `Record<MatrixActionName,
Binding>` and an excluded action cannot be given a binding by accident.

**`ACTION_BINDINGS`, one table keyed by the same names** _(reuse S4: `ACTION_FNS`, `VALID_BODY` and
the writer list were three parallel maps)_:

```ts
ACTION_BINDINGS: Record<
  MatrixActionName,
  {
    fn: ActionFn;
    writers: [Mock, ...Mock[]]; // non-empty at the type level
    body: () => FormData; // was VALID_BODY, local to one describe
    scopeMiss?: () => void; // household entries only, enforced by the scope type
  }
>;
```

- `ALL_WRITERS` is derived from the union of `writers`, so `updateProfileRoutine` joins it instead of
  being asserted by hand at `:197`, `:216`, `:1633`.
- 🔴 **One assertion binds the registration to the real function:** `expect(ACTION_BINDINGS[name].fn.name).toBe(name)`
  _(security lens S7)_. Without it `fooAction: { fn: logBodyweightAction }` passes every matrix while
  the real `fooAction` is untested — and today's shorthand object properties make that typo
  invisible. Viable because every action is a plain `export async function` with the Sentry wrapper
  inside the body (`actions.ts:81-86`), so `.name` survives.
- ⚠️ **`scope` here means ADDRESSING — which id the body carries — not `HouseholdScope`.** The word
  already means the capability elsewhere in this repo (`packages/db/src/scope.ts`,
  `write-path.md` invariant 2). Four sibling plans already write `scope:`, so the name stays and the
  docblock says this.

**The empty household suite, pinned so it cannot pass vacuously** _(security S4, correctness S4)_:

- `expect(householdRows.map(([n]) => n)).toEqual([])` — the literal, today. `PROF-1` a-1 must
  consciously edit a pinned assertion to add `'addAthleteAction'`, which is the same discipline
  `ALLOWLIST` gets at `pages-need-a-session.test.ts:321`. A count `it` would be tautological: both
  sides derive from the same `filter`.
- The row-runner is a function, with a **permanent** self-test feeding it an in-file stub that ignores
  the DAL's `null` and returns `ok: true`; the runner must reject it. That proves the harness can fail
  **before** a real household action exists — the `guards:test` precedent, and the reason a
  probe-then-delete is not enough here.
- ✅ `it.each([])` registering zero tests is **not** an open question: it is recorded in-repo at
  `pages-need-a-session.test.ts:250` (Vitest 5.0.5, no warning). An earlier pass of this plan called
  it "unverified".

**The generalized cross-check:**

- `exportedActionNames()` over every `serverActionModulePaths()` module, sorted, equals
  `Object.keys(MUTATING_ACTIONS)` sorted. Catches a duplicate name across modules too, so no separate
  uniqueness `it`.
- ⚠️ **It reads modules, so it is the assertion that closes the hole.** An ownership check against
  `write-path.md` would only detect a missing `owns:` line — see § Out-of-scope.

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

3. **An exclusion probe.** Add a throwaway `app/probe/actions.ts` with **two** exports, one listed
   as `excluded`. The "its exports equal exactly its listed names" `it` goes red on the unlisted one.
   ⚠️ The October plan said "add a second export to `app/gate/actions.ts`" — that file was deleted at
   1d, so the probe was unrunnable.
4. **A writer probe: a writer no binding declares goes red.** Add an export to the mocked
   `@/lib/dal/entries` factory that is in no binding's `writers` and not in `READERS`. The writer-union
   `it` goes red. Separately, `writers: []` fails typecheck.

Delete every probe before committing. Run `hold-the-bar`, because this PR edits guards. The mandatory
backend boundary cases (unauth, wrong owner, bad body, replay) are unchanged for the seven and run
against the same functions.

## Risks / rollback

| Risk                                                                                                                        | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The unmerged `feat/auth-logout-button` branch** adds `app/p/lock-device-action.ts` (`lockDeviceAction`, `() => redirect`) | After WP-1 it needs an `OUTSIDE_THE_MATRIX` entry with a `provenBy` (its `lock-device-action.test.ts`) in whichever PR lands second. Its signature takes no `ActionState`, and it is not household-addressed. ⚠️ **It goes red at AUTH-1 1c, not 1d.** It calls `hasGateAccess()`, and 1c switches `BOUNDARY_CALL` to the session names (`pages-need-a-session.test.ts:211-217`), so 1c must convert or delete it.                                                                                                                                                                                                                                         |
| **The exclusion list becomes an escape hatch**                                                                              | Entries are per action, each with a reason and a proving test that must exist. Each excluded module's exports are pinned exactly. The intersection with the boundary allowlist is pinned to one module. ⚠️ **"A household action may never be excluded" is prose and review, not a type or an assertion.** An excluded export is by definition not in the registry, so nothing records its scope to type against. The rule lives in `write-path.md` invariant 1 and in `OUTSIDE_THE_MATRIX`'s docblock. Its only mechanical backing is that every exclusion is a visible, reasoned edit to one test-support file. This is said plainly instead of claimed. |
| **The registry shape change breaks a consumer**                                                                             | The only importers are `actions.test.ts` and, after this PR, `pages-need-a-session.test.ts` (grep). No app code reads `MUTATING_ACTIONS`. Typecheck covers it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ~~**Collision with AUTH-1 1b or 1c**~~ ✅ **spent** — 1a–1d all merged (#337)                                               | Staging gate. 1c's plan rows still apply as written: it edits the unauth suite's mocks (`auth-1-clerk-google.md:1712`), which now iterates the registry. **After 1c lands, re-verify** that its `{no session, no membership, wrong household, unknown id}` matrix is built from `MUTATING_ACTIONS` and honours `scope`, and that its `BOUNDARY_CALL` switch did not widen to an alternation.                                                                                                                                                                                                                                                               |
| **Write-path integrity, idempotency, `getHouseholdScope()` scoping, CSV byte-faithfulness, LLM-never-authors-loads**        | Untouched. No DAL, writer, schema, export or prompt file is in the table.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

**Rollback:** revert the PR. It changes tests, test support and docs only.

**Privacy:** nothing stored, sent or retained changes, so `docs/privacy/data-inventory.md` is
unchanged. **Feature guides:** `write-path.md` only. **UI:** none, so no UX panel is owed.

## Out-of-scope / deferred

🔴 **Cut by panel round 3, with the reason, so nobody re-adds them.**

- **`OUTSIDE_THE_MATRIX` as a second list, `apps/web/test/server-action-lists.ts`, `guideOwns()`, and
  the ownership `it`.** Exclusion is now a member of the registry union (§ Shapes), which removes the
  second list and makes the household rule a type error. The ownership `it` would have asserted every
  scanned module is in `write-path.md`'s `owns:` — but **detecting a missing `owns:` line is not
  testing an action**, and the generalized cross-check already forces every exported action into the
  registry, where a binding and all six matrices follow. `guideOwns()` would have been a **second**
  parser of the `owns:` frontmatter beside `check-feature-guides.mjs`'s; [#341](https://github.com/ralamode/mat-plan/pull/341)
  shows why that is dangerous rather than merely untidy — the existing one had been silently reading
  3 of 13 entries, and a second parser written to the documented format would have disagreed with it
  while both looked right.
  ⚠️ **One consequence to state:** a module an author adds to `owns:` but whose actions are
  unregistered is caught by the cross-check, not by ownership. A module in **neither** is caught by
  the pinned module list (`pages-need-a-session.test.ts:306`), which is a `toEqual` and cannot be
  appended to silently. Nothing is uncovered; the coverage just comes from two assertions instead of
  three. **And it avoids a collision V1-9b would have hit:** that plan gives
  `app/p/[profileId]/entry-actions.ts` to a **new** guide (`v1-9b:365`), so an ownership check against
  `write-path.md` alone would have been a latent red (architecture N2).
- **The writer-union machinery** (`MOCKED_DAL` self-check, `READERS` list, derived-union assertions) —
  ~50 lines to protect a six-element array. Replaced by asserting that every export of each mocked DAL
  module except the known readers was not called: no declaration to forget, and an undeclared writer is
  caught by construction (scope Q1).
- **The physical split of the existing seven actions into per-feature modules.** Unfiled, unplanned,
  and renamed here from "WP-1b" because that id now means the rejected second PR.

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
  (`auth-1-clerk-google.md:1638,1712`). That was a call for after 1c; 1c has merged, so it is a call for now — see open question 1.
- `docs/plan.md` and `docs/roadmap.md` are not edited on this branch. The WP-1 row and link land when
  the PR opens.

## Open questions

1. **Option C, for the maintainer:** should `write-path.md` stop owning `apps/web/lib/dal/` as a
   prefix and own only the seam (with feature DAL to feature guides, plus an `entries.ts` split) so
   that lanes A and B can run concurrently? _(The "after 1c" condition is met.)_ **Author's lean: no, for CRUD-1.** The lanes are
   short and mostly gated serially already.
2. ✅ **RETIRED 2026-11-06 — may WP-1 add the 1d row to the merged AUTH-1 plan?** Moot: 1d has
   merged, `app/gate/actions.ts` is deleted, and `OUTSIDE_THE_MATRIX` was never built, so there is no
   entry to remove and no merged plan to edit. `ALLOWLIST` is already `[]`.
3. 🔴 **NEW, for the maintainer: does `write-path.md` own `apps/web/app/p/mutation-entry.ts` after the
   move, or does the move itself need the maintainer's assent?** The guide owns the helper at its
   current path by exact entry, so the move edits `owns:` either way — but it relocates a file four
   other plans cite by path (`PROF-1` D5, `V1-9b`, `ASSIGN-1`, and this plan's own § Shapes).
   **Decided: in this PR.** It is cheaper now, while exactly one module imports the
   helper, than after three do; and `PROF-1` a-r cannot be written without it. The alternative is to
   let `PROF-1` discover the pinned-regex failure mid-PR, which is how the obligation was found in
   the first place.

## Standing obligations — `ID-1`'s six keep-open items

[`ID-1`](../plan.md) requires that _"a plan for AUTH-1 1c, or any later auth chunk, answers these six
in its review-response log."_ This plan adds a `scope` field to the action registry and defines what
the boundary matrices prove, so they apply.

🔴 **An earlier pass of this refresh asserted in its own banner that these were "answered in the
review-response log" when the log contained no such table.** Three lenses caught it. That is the
precise failure the obligation exists to prevent, in the first plan written after the rule was merged
(#340) — recorded rather than quietly fixed.

| #   | `ID-1` keeps open                                                                                        | This plan                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | The principal is a **login**, never a profile; no column ties one to the other                           | **n/a** — no schema change, no new column, nothing that assumes a profile cannot later hold a login.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 2   | Every access decision still goes through `getHouseholdScope()`, so a later grant widens **one** function | ⚠️ **Satisfied, and an earlier claim here was OVERSTATED.** The banner said "these matrices are what evidence item 2". They are not: the household suite **mocks the DAL** (`scopeMiss()` makes it resolve `null`), so it evidences that an action refuses on a DAL miss and reaches no writer. That the decision went through the resolver is evidenced by `packages/db/src/scope.test.ts`'s single-`DERIVES_SCOPE` assertion, `lib/dal/scoped.test.ts` and `db:verify` — unchanged by this plan. `scope` here classifies an action's **addressing**, not its authorization. _(architecture B1, security 5.)_ |
| 3   | State D (two memberships throws) is a **Beta 0 invariant, not the model**                                | **Satisfied.** `scopeMiss → null` counts nothing, and the household rows must never assert _which_ household resolved or how many exist. `ACTION_SCOPES` is an open `as const`, so a later `athlete` or `grant` addressing mode is additive.                                                                                                                                                                                                                                                                                                                                                                   |
| 4   | Nothing pins an athlete to a household — no key, index or cache key on `(household_id, profile)`         | **Satisfied.** `scope` routes a test row; it is not a key, an index or a cache key. No `revalidatePath`/tag choice changes here.                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 5   | **No age-based permission logic** (`profiles.kind`, `birthdate`)                                         | **n/a** — nothing in this plan reads `kind` or a birthdate; the registry keys on the action, not the athlete.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 6   | Household roles stay a **shared const + CHECK**, additive for `guardian`                                 | **n/a** — no role is read or introduced. `ACTION_SCOPE` is a different axis from `HOUSEHOLD_ROLES` and lives in `apps/web` because only tests consume it (reuse N2 confirmed nothing in `packages/shared/src/enums.ts` it duplicates).                                                                                                                                                                                                                                                                                                                                                                         |

## Review-response log

### Engineering panel, round 1 (correctness, scope, architecture, reuse, security)

| #   | Lens                            | Critique                                                                                                                 | Verdict      | Resolution                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | All five                        | Probe (a) is already red on `main`: `pages-need-a-session.test.ts:227-229` pins the module set with `toEqual`            | **accepted** | The hole is restated as "listed in the pinned list but missing from `MUTATING_ACTIONS` → the matrices skip it". The probe adds the module **and** its pinned entry, and names the failing `it`. Option B and the old "already iterate every module" paragraph are rewritten. Acceptance lists every test file touched.                                                                                                                                                         |
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

### Panel round 3 — 2026-11-06, on the refresh and the proposed split

> Five lenses: correctness · scope · architecture · reuse · security.
> Cost: correctness 130k · 6m08s, scope 106k · 4m07s, architecture 142k · 5m48s, reuse 129k · 5m51s,
> security 121k · 5m24s.

🔴 **The refresh's own additions were most of the findings, and the split it proposed was rejected by
every lens.** Recorded in full, because the pattern is the useful part: a refresh that re-verifies
citations is not the same as a refresh that re-derives decisions, and this one mistook the first for
the second.

| #   | Lens                                  | Finding                                                                                                                                                                                                        | Verdict             | Resolution                                                                                                                                                                                                                                                |
| --- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | all five                              | **The `WP-1a`/`WP-1b` seam is wrong:** `PROF-1` a-r registers an action in a second module, so it needs the generalized cross-check that was put in `WP-1b`                                                    | **accepted**        | Collapsed to **one PR**. The staging note records the mechanism (`actions.test.ts:1679`'s `toEqual` goes red at 8 keys vs 7 exports)                                                                                                                      |
| S2  | scope · security                      | Between the two PRs, PROF-1's module could land covered by the pinned list and a source guard only                                                                                                             | **accepted**        | Same collapse; the cross-check is now in the only PR                                                                                                                                                                                                      |
| C1  | correctness                           | 🔴 **The refresh's claim that the October probe "named the wrong `it`s" is itself wrong** — the name belongs to this plan's own new test, and the existing one predates the plan by a day (#300, `git log -S`) | **accepted**        | Retracted in § Acceptance, in place and visibly                                                                                                                                                                                                           |
| A1  | arch · sec                            | 🔴 **The banner claimed `ID-1`'s six were answered in the log; the log had no such table**                                                                                                                     | **accepted**        | § Standing obligations, six rows                                                                                                                                                                                                                          |
| A2  | arch · sec                            | The banner's "these matrices evidence `ID-1` item 2" is **overstated** — the suite mocks the DAL                                                                                                               | **accepted**        | Corrected in the item-2 row, with where that evidence actually lives                                                                                                                                                                                      |
| M1  | correctness · arch · security         | 🔴 **Widening `ENTRY_IMPORT` to an alternation is forbidden by `write-path.md:161`** and opens a local-shim shadow                                                                                             | **accepted**        | One pinned literal via `@/app/p/mutation-entry`; the reasoning is in the file row                                                                                                                                                                         |
| M2  | arch                                  | "Both depths" is already wrong — spec `:560` puts V1-22's edit actions at a third depth                                                                                                                        | **accepted**        | The alias covers every depth; cited in the row                                                                                                                                                                                                            |
| M3  | all five                              | The move breaks `pages-need-a-session.test.ts:380` (ENOENT), unlisted                                                                                                                                          | **accepted**        | Added, with the docblock paths in `session.ts`, `rate-limit.ts`, `actions.ts:87`, `write-path.md:98,103,139`                                                                                                                                              |
| G1  | scope · correctness · arch · security | **Five places still pinned the deleted `app/gate/actions.ts`** after the refresh "fixed" two                                                                                                                   | **accepted**        | § Shapes rewritten, the ∩ assertion dropped, test-plan probe re-based on a throwaway module                                                                                                                                                               |
| R1  | reuse                                 | 🔴 **`guides:check` reads 3 of `write-path.md`'s 13 `owns:` entries** — the guide obligation this plan relies on is not enforced for its own files                                                             | **accepted**        | **Fixed ahead of this PR in [#341](https://github.com/ralamode/mat-plan/pull/341)**, with the guard's first self-test; rebase onto it                                                                                                                     |
| R2  | reuse · arch                          | `guideOwns()` duplicates `check-feature-guides.mjs`'s `parseGuide`, and "cannot be reused" is false — `check-skills.mjs` exports its helpers behind `isEntryPoint()`                                           | **accepted**        | `guideOwns()` and the ownership `it` **cut** (§ Out-of-scope); no second parser                                                                                                                                                                           |
| R3  | reuse                                 | Fold exclusion into the registry as a discriminated union — one table, and "a household action can never be excluded" becomes a **type** error                                                                 | **accepted**        | § Shapes; `OUTSIDE_THE_MATRIX` and `server-action-lists.ts` cut with it                                                                                                                                                                                   |
| R4  | reuse                                 | `ACTION_FNS`, `VALID_BODY` and the writer list are three parallel maps keyed by the same names                                                                                                                 | **accepted**        | One `ACTION_BINDINGS` carrying `fn`, `writers`, `body`, `scopeMiss?`                                                                                                                                                                                      |
| Q1  | scope                                 | Cut the writer-union machinery (`MOCKED_DAL` self-check, `READERS`) — ~50 lines guarding a 6-element array                                                                                                     | **accepted**        | Replaced by asserting every mocked DAL export except the readers was not called                                                                                                                                                                           |
| V1  | security · correctness                | `'counts its rows'` is tautological and the empty suite cannot fail                                                                                                                                            | **accepted**        | The literal is pinned (`toEqual([])`) and the row-runner gets a **permanent** self-test, not a deleted probe                                                                                                                                              |
| V2  | security                              | Bind the registration to the real function — `fn.name === name`                                                                                                                                                | **accepted**        | § Shapes; without it a copy-paste binding passes every matrix                                                                                                                                                                                             |
| V3  | security                              | `provenBy` existence is bookkeeping; source-scan it                                                                                                                                                            | **accepted**        | § Acceptance                                                                                                                                                                                                                                              |
| S3  | scope                                 | Defer the household suite to `PROF-1` a-1; only the `scope` field and the filter are needed now                                                                                                                | **rejected**        | The suite's **shape** is this plan's deliverable — a-1 is weeks out and would otherwise design it under deadline. But V1's pinned literal and permanent self-test are what make an empty suite honest, so the objection is answered rather than dismissed |
| S4  | scope                                 | The document is longer than the work (455 lines); cut the banner, the finding table, options weighed, the AUTH-1 table                                                                                         | **partly accepted** | Banner 17→14, staging 2 rows→1, Shapes rewritten shorter, the AUTH-1 table kept as the scope-cut evidence a reader needs to not re-add the work                                                                                                           |
| N1  | reuse · correctness                   | NITs: `serverActionModulePaths()` has one real call site; `it.each([])` is verified in-repo at `:250`; the skill row at `:19` is already corrected                                                             | **accepted**        | Justification reworded to "1 + 2 planned"; the "unverified" note replaced with the citation; the skill row claim dropped                                                                                                                                  |
| N2  | arch                                  | `household.ts`-style NIT: the ownership `it` would collide with V1-9b, which gives `entry-actions.ts` to a **new** guide                                                                                       | **accepted**        | Moot once the ownership `it` is cut (R2); noted in § Out-of-scope so V1-9b is not surprised                                                                                                                                                               |
| X1  | arch                                  | "`MUTATING_ACTIONS` has no guide" is false — `write-path.md:11` owns it                                                                                                                                        | **accepted**        | Corrected                                                                                                                                                                                                                                                 |
| X2  | correctness · security                | Iteration-site count is wrong: six sites, not four, and the rate-limit suite must stay over ALL entries                                                                                                        | **accepted**        | § Acceptance lists all six and keeps unauth + rate-limit unfiltered — filtering them would exempt `addAthleteAction`, the one action that grows a table without bound                                                                                     |
