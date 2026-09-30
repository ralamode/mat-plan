---
name: add-server-action
description: Add or change a mutating Server Action in mat-plan the way the existing ones are built — Sentry-wrapped, zod-validated via a packages/shared schema, profile resolved by public_id, DAL/writer call with client_id idempotency, revalidatePath, the ActionState envelope — plus its boundary tests (bad body, unknown profile, wrong owner/stale id, replay). Use for any new form submit, write, edit, or mutation endpoint — "add an action", "save X", "let them edit Y", "new form".
---

# Add a Server Action

Read [docs/features/write-path.md](../../../docs/features/write-path.md) first. It owns these files
and its invariants are binding, and the `guides:check` gate will make you update it. Rules:
[AGENTS.md](../../../AGENTS.md) → "Server conventions" and "Backend / API PR rules".

**What is and isn't wired today**, so the code and the PR don't claim more than exists:

| AGENTS.md asks for                          | Reality today                                                                                    |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `getCurrentUser()` + `household_id` scoping | **No auth until Clerk (v1.5).** Ownership is existence-only: the profile resolves by `public_id` |
| Rate limit on mutations                     | **Gate only** (`lib/rate-limit.ts`). Actions are deliberately unlimited (tech-debt.md)           |
| Idempotency-Key header                      | A `clientId` form field (UUIDv7) + UNIQUE + ON CONFLICT                                          |
| unauth → reject test                        | Nothing to test yet. Write the other boundary tests                                              |
| Structured logs + correlation id            | Sentry only                                                                                      |

When Clerk lands, update this table in the same PR.

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
- Idempotency: `.onConflictDoNothing({ target: t.clientId, where: isNull(t.deletedAt) })`. The
  predicate must be repeated because the unique index is partial. Then re-select the live row, so a
  replay returns the same result.
- Return a **DTO** (`public_id` as `id`), never a raw row. Derive derived columns from the source
  value (e.g. dimension from unit) rather than trusting input.

## 3. The action (`apps/web/app/p/[profileId]/actions.ts`)

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
7. `revalidatePath(\`/p/${profile.id}\`)` (+ sub-routes). A stale view invites a duplicate submit.
8. `return { ok:true, error:null }`.

## 4. The form

`useActionState(xAction, INITIAL_ACTION_STATE)`. Generate `clientId` with `newId()` from
`@mat-plan/shared`.

⚠️ **Do NOT rotate it after an ok result** — this said to, and V1-24 PR 1a made that the bug. Rotating
the key while the form stays on screen turns a second submit into a second **row**, because
`logBodyweight` dedupes only on `client_id` and `entries` has no natural-key uniqueness. Paired with a
`form.reset()` it is worse: the emptied input is what invites the second submit. A **stable** key makes
a resubmit an `ON CONFLICT DO NOTHING` no-op, which is the behaviour you want. What removes the
affordance is not rendering the create form over an existing record at all (`bodyweight-section.tsx`).
Rotate only where a genuinely NEW record is expected next — an append-style surface that stays mounted
across writes — and say why in a comment.

A display-only field must drop its `name` (`readOnly`/`aria-disabled` fields still submit, which caused
duplicate rows; see lessons.md). The UI must never be stricter than the endpoint. UI work owes a UX
panel (`plan-with-panel`).

## 5. Tests (same PR, colocated in `actions.test.ts`)

Mock `next/cache`, `next/headers` and the DAL modules with `vi.mock`, as the file already does, and
use its `form(fields)` helper. Required describes:

- `'<action> — boundary (bad body → zod-reject)'`: each invalid field returns `fieldErrors` with no DAL call.
- `'<action> — happy path + ownership'`:
  - unknown profile → a typed error and **no write**
  - wrong owner / stale id → a typed error and no `revalidatePath`
  - the happy path asserts every threaded value with `mock.calls[0][0]` + **`toMatchObject`**, not
    `objectContaining`, because optional args drop silently (lessons.md)
  - replay (`clientId` conflict) → **success**, one effect
- A writer in `packages/db`: add a `db:verify` section proving ownership rejection and replay against
  real Postgres semantics.

## Red flags

- `db`, `process.env` or a Drizzle import in the action file.
- An action that trusts `profileId` without resolving it, or accepts an internal id.
- A new ON CONFLICT without the `deletedAt` predicate.
- A test using `objectContaining` for the DAL args.
- The PR claiming auth, household scoping or rate limiting that the table above says isn't wired.
