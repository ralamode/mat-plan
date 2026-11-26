---
name: add-server-action
description: Add or change a mutating Server Action in mat-plan the way the existing ones are built — Sentry-wrapped, zod-validated via a packages/shared schema, profile resolved by public_id, DAL/writer call with client_id idempotency, revalidatePath, the ActionState envelope — plus its boundary tests (bad body, unknown profile, wrong owner/stale id, replay). Use for any new form submit, write, edit, or mutation endpoint — "add an action", "save X", "let them edit Y", "new form".
---

# Add a Server Action

Read [docs/features/write-path.md](../../../docs/features/write-path.md) first. It owns these files
and its invariants are binding, and the `guides:check` gate will make you update it. Rules:
[AGENTS.md](../../../AGENTS.md) → "Server conventions" and "Backend / API PR rules".

**What is and isn't wired today**, so the code and the PR don't claim more than exists:

| AGENTS.md asks for                          | Reality today                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| authN inside the action                     | ✅ **A Clerk session with a household membership**, via `await enterMutation(refusal)` — never hand-rolled. ⚠️ Was "the gate AND a session" until `AUTH-1` 1d deleted the gate. See [write-path](../../../docs/features/write-path.md), which owns this.                                                            |
| `getCurrentUser()` + `household_id` scoping | ⏳ Ownership is **existence-only until `AUTH-1` 1c-4**: the profile resolves by `public_id` within the one live household. A session proves _who_, not yet _whose data_.                                                                                                                                            |
| Rate limit on mutations                     | ✅ **Limited**, inside `enterMutation` — `checkMutationLimit`, keyed on the Clerk principal. Do not add a second call. (The export's own limit is not an action's: `.github/SECURITY.md` → Rate limiting.)                                                                                                          |
| Idempotency-Key header                      | A `clientId` form field (UUIDv7) + UNIQUE + ON CONFLICT                                                                                                                                                                                                                                                             |
| unauth → reject test                        | ✅ Required and real: **no-session and wrong-household** must be **byte-identical** refusals (`actions.test.ts`), and the source guards in `pages-need-a-session.test.ts`. ⚠️ "un-gated" was a third arm until `AUTH-1` 1d deleted the gate — do not write a test against `@/lib/dal/gate`, which no longer exists. |
| Structured logs + correlation id            | Sentry only                                                                                                                                                                                                                                                                                                         |

🔴 **A new action that does not `await enterMutation(…)` and return its refusal fails CI** —
`app/pages-need-a-session.test.ts` reports it by name, pins the import source, and asserts the three
conjuncts in order inside the helper. ⚠️ This table said "no auth until Clerk (v1.5)", "actions are
deliberately unlimited" and "nothing to test yet" for two chunks after each stopped being true, which
would have walked an author straight into that failure. It is a **pointer** now, not a second copy of
`write-path.md`; when `1c-4` or `1d` moves something, that guide is what changes.

## 1. Contract first: the shared schema

In `packages/shared/src/<domain>.ts`, add `<verb><Noun>Schema` (e.g. `logBodyweightSchema`) with
`profileId: uuidSchema` and `clientId: uuidSchema`, and export it from `index.ts`. Reuse existing
enums and units. Never re-type an allowed value.

## 2. The write

- A single-table write goes in the DAL (`apps/web/lib/dal/<area>.ts`, `import 'server-only'`).
- A multi-table or transactional write goes in a **writer** in `packages/db/src/writers/`, so
  `db:verify` can prove it on PGlite.
- Resolve ownership **inside** the query by joining through `profiles.publicId`. Never accept an
  internal bigint id.
- Idempotency: `.onConflictDoNothing({ target: t.clientId, where: isNull(t.deletedAt) })`, then
  re-select **the live row** so a replay returns the same result.
  ⚠️ Since `V1-9b` B0 **no `client_id` unique is partial**, so the `where:` is no longer required to
  infer — it is kept because a supplied predicate still matches a non-partial index, which lets the
  index and the arbiter change in either order. The live-row re-select is the part that matters now:
  a conflict can be with a HIDDEN row, and an unguarded re-select would attach children to a dead
  parent. Throw on a miss (`write-path.md` invariant 6).
- Return a **DTO** (`public_id` as `id`), never a raw row. Derive derived columns from the source
  value (e.g. dimension from unit) rather than trusting input.

## 3. The action (`apps/web/app/p/[profileId]/actions.ts`)

**A new Server Action MODULE is three files side by side, and edits no shared table** (FAM-1 step
0b): the `'use server'` module, its `<module>.registry.ts` (`ACTION_REGISTRY`, one
`{ refusal, scope }` entry per exported action) and its `<module>.test.ts`, which calls
`describeActionMatrices` from `apps/web/test/action-matrix.ts` over that registry. The rule is in the
docblock of `apps/web/app/p/[profileId]/mutating-actions.ts`; `apps/web/app/p/profile-actions.ts` and
the two files beside it are the shortest example. An action added to an EXISTING module gets an entry
in that module's registry and a binding and a valid body in that module's test. Either way the
compiler and `actions.test.ts` say what is missing.

⚠️ **A NEW mutation follows AGENTS.md → Server conventions → "Contract" and "Time" (`SCALE-1`).**
Steps 1, 3, 4, 5, 6 and 8 below, §4 (`useActionState`) and the Done-when `ActionState` item describe
the **legacy forms**, which FAM-1 step 12f removes. Steps 2 and 7 still apply. For a new mutation:

- **Shape.** It takes the object its `packages/shared` zod schema parses, not `(prev, formData)`. It
  returns the contract's `{ ok:true,… } | { ok:false, reason }`, never `ActionState`. Copy
  `packages/shared/src/program/actions.ts` (`ProgramActions`, `DayActions`). `rowResultSchema`
  (`day-shapes.ts`) is the response-schema example. `ProgramResult` is still a bare TS type, so give
  it a schema with its first real action.
- **Refusals (confirmed by the FAM-1 contract owner, 2026-11-16):**
  - **No session, or the wrong household:** **`not_found`**, and a caller can't tell the two apart
    (ADR 0006's 404-never-403, which `enterMutation` already enforces). This holds for an action that
    names no id too: `createProgram` with no session answers `not_found`.
  - **Rate-limited:** **`retry`**. The limiter runs before anything is read or written, so a retry may
    reuse its `clientId`.
  - **The order stays session → limiter → schema parse.** An input the schema refuses answers
    `invalid` (a `ProgramResult`) or `bad_value` (a `RowResult`), as the contract already says.
- **Time.** The action resolves the day and the time zone and passes them to the writer.
- 🔴 **Not supported yet.** `enterMutation` (`apps/web/app/p/mutation-entry.ts`) returns an
  `ActionState`. `ActionFn` (`apps/web/test/action-matrix.ts:66`) is
  `(ActionState, FormData) => ActionState`. Neither can drive a contract action, so it cannot get its
  mandatory boundary tests from them. **The FAM-1 contract owner teaches both of them the contract
  shape, as a contract change made before 7a and 12b open**
  ([program-contract.md](../../../docs/features/program-contract.md) → Owner; its changelog fragment
  names the change). The first real contract action then replaces these legacy steps here.

Copy the shape of `logBodyweightAction` (plain form) or `editRoutineAction` (JSON payload):

1. `export async function xAction(prev: ActionState, formData: FormData)`. Only async function
   exports are allowed in a `'use server'` file; `use-server-exports.test.ts` enforces it. Import
   `ActionState` from `action-state.ts` and never re-export it.
2. `return await Sentry.withServerActionInstrumentation('xAction', async () => { … })`. It isn't
   auto-instrumented, and you pass no headers or formData.
3. `schema.safeParse(...)`. On failure: `{ ok:false, error:'Please fix the errors below.',
fieldErrors: parsed.error.flatten().fieldErrors }`. **Validate before any DB call.** A constraint
   violation throws away the whole transaction as a 500.
4. Day-grain writes: `resolveDeclaredDay(formData.get('day'))`.
5. `getProfileByPublicId(id)`. If it returns null: `{ ok:false, error:'No profile found…' }`.
6. Call the DAL or writer. Map a null or not-found result to a typed error. **Expected failures
   return, unexpected ones throw** (to `error.tsx`). Never leak internals.
7. `revalidatePath(athletePath(profile.id))` (+ sub-routes). A stale view invites a duplicate submit. One exception: the day page's four row writes call `refresh()` instead (AGENTS.md → Server conventions → Cache).
8. `return { ok:true, error:null }`.

## 4. The form

`useActionState(xAction, INITIAL_ACTION_STATE)`. Generate `clientId` with `newId()` from
`@mat-plan/shared`.

⚠️ **Do NOT rotate it after an ok result** when the form can be resubmitted for the same record (see
[lessons.md](../../../docs/lessons.md), "rotated idempotency key"). Rotating the key while the form
stays on screen turns a second submit into a second **row**, because
`logBodyweight` dedupes only on `client_id` and `entries` has no natural-key uniqueness. Paired with a
`form.reset()` it is worse: the emptied input is what invites the second submit. A **stable** key makes
a resubmit an `ON CONFLICT DO NOTHING` no-op, which is the behaviour you want. What removes the
affordance is not rendering the create form over an existing record at all (`bodyweight-section.tsx`).
Rotate only where a genuinely NEW record is expected next — an append-style surface that stays mounted
across writes — and say why in a comment.

A display-only field must drop its `name` (`readOnly`/`aria-disabled` fields still submit, which caused
duplicate rows; see lessons.md). The UI must never be stricter than the endpoint. UI work owes a UX
panel (`plan-with-panel`).

## 5. Tests (same PR, colocated in the module's own test)

That is `actions.test.ts` for `actions.ts`, and `<module>.test.ts` for any other module. Mock
`next/cache`, `next/headers` and the DAL modules with `vi.mock`, as the file already does, and use
its `form(fields)` helper. **The unauth, rate-limit, wrong-household and byte-identical refusal
rows are not written by hand**: add the action's binding and valid body to the file's
`describeActionMatrices` call and they run. Required describes, beyond those:

- `'<action> — boundary (bad body → zod-reject)'`: each invalid field returns `fieldErrors` with no DAL call.
- `'<action> — happy path + ownership'`:
  - unknown profile → a typed error and **no write**
  - wrong owner / stale id → a typed error and no `revalidatePath`
  - the happy path asserts every threaded value with `mock.calls[0][0]` + **`toMatchObject`**, not
    `objectContaining`, because optional args drop silently (lessons.md)
  - replay (`clientId` conflict) → **success**, one effect
- A writer in `packages/db`: add a `db:verify` section proving ownership rejection and replay against
  real Postgres semantics.

**Then force one error and find it in Sentry.** A test can't prove the wrapper is wired to a real
project. Throw once inside the `withServerActionInstrumentation` callback, **uncommitted**, against a
build with `SENTRY_DSN` set (local `.env.local`, or the preview if its scope has one). Submit the
form and confirm the event arrives under the action's name, then revert. Never commit the throw:
`hold-the-bar` flags a stub throw, rightly. With no DSN reachable, the PR says **Sentry: not
verified**, never "instrumented".

## Done when

- [ ] The input schema lives in `packages/shared`, and the action validates with it before anything else.
- [ ] The action re-checks the session and ownership itself, is wrapped in `withServerActionInstrumentation`, and returns the `ActionState` envelope (legacy forms) or the contract's typed result (a new mutation, §3's ⚠️).
- [ ] Every write carries the client's `client_id`; a replay returns success with one effect.
- [ ] The action is in its module's registry, with a binding and a valid body in that module's `describeActionMatrices` call.
- [ ] The module's test covers bad body, unknown profile, wrong owner or stale id, replay, and the happy path with `toMatchObject`.
- [ ] Sentry was checked with one forced, uncommitted error, or the PR says "Sentry: not verified".

## Red flags

- `db`, `process.env` or a Drizzle import in the action file. (#324)
- An action that trusts `profileId` without resolving it, or accepts an internal id. (hypothesis)
- A new ON CONFLICT without the `deletedAt` predicate. (lessons: "42P10")
- A test using `objectContaining` for the DAL args. (lessons: "objectContaining")
- The PR claiming auth, household scoping or rate limiting that the table above says isn't wired. (#324)
