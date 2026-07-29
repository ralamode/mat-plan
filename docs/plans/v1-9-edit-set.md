# V1-9 — Fix-a-set / edit UX (LWW update) — Staff plan & panel log

> Backlog: [plan.md](../plan.md) **V1-9**. Acceptance: _mistype a set → correct it → Today reflects the
> fix._ Base: `main` (V1-8 merged — supersets shipped). **No migration** — the mutable-row columns
> (`updated_at`, `deleted_at`) already exist on `entry_sets` (the shared `timestamps` group,
> `schema.ts:31`), so this is an app-layer edit slice, not a DB PR.

## Goal

Give a logged **strength set** an inline edit affordance so a mistyped **reps** or **weight** can be
corrected in place — the single most common logging mistake (wrong number on the gym floor). The set
updates last-writer-wins on `updated_at`, ownership-scoped, and Today re-renders the fix. Tight scope:
one existing set's two numeric fields. Everything else (add/remove a set, edit the movement name/unit,
edit a bodyweight value, edit a check-in) is out — deleting is V1-9b, notes are V1-9a.

## Design decisions

**E1 — Scope: a strength set's `reps` + `weight`, edited in place.** The acceptance test is literally
"a set" — an `entry_set` row's reps × weight. NOT add/remove sets (that changes the set list — a
different, heavier interaction that overlaps V1-9b delete), NOT movement name/unit, NOT the bodyweight
scalar. Editing the two mistype-prone numbers is the 80% case and keeps the slice bounded (<400 lines).
Bodyweight-value edit is the obvious sibling but is a _separate_ surface (a single value, not a set) —
noted as a fast-follow, not folded in.

**E2 — Identify the set by its `public_id` (additive DTO field).** `SetDTO` (dal/entries.ts:34) exposes
`idx/reps/weight/weightLabel` but no stable id. Add `publicId: string` (the `entry_sets.public_id`
UUIDv7) to `SetDTO` + one column to the sets select — additive, nullable-free, no read regression. The
edit action addresses the set by this non-enumerable id (anti-IDOR), never by `idx` (which shifts) or
internal id.

**E3 — The UPDATE is a single-sourced `packages/db` writer, proven by `db:verify`.** Mirror the
`writeStrengthSession` "one unit, two consumers" pattern (R11): `updateStrengthSetById(exec, {...})` in
`packages/db/src/writers/strength-session.ts`, called by BOTH the app DAL and `db:verify` — so the edit
path can't fork. It is **ownership-scoped in SQL**: the UPDATE targets `entry_sets` filtered by
`public_id` AND a subquery/join proving the parent `entries.profile_id = <resolved internal id>` with
`deleted_at IS NULL` at the set, entry, AND profile level (BOLA-first — never trust the `setId` alone).
It sets `reps`, `weight_num`, and `updated_at = now()`, and returns the updated row (or throws
"set not found" when the guarded UPDATE matches nothing — a wrong-owner or deleted set). Idempotent by
nature: re-applying the same values is a no-op-equivalent (same end state).

**E4 — LWW is server-`now()` today; the client-timestamp compare is v1.5.** `updated_at` advances to
`now()` on each edit. The spec's client-supplied-timestamp LWW (spec.md §sync/edits) lands with the
offline outbox at v1.5; until then there's one online writer, so server-now is correct and not a
regression. Documented at the writer edge so v1.5 knows where to add the `setWhere incoming >= stored`.

**E5 — Contract: `editStrengthSetSchema` in `packages/shared`, reusing `strengthSetSchema`'s bounds.**
`{ profileId: uuidSchema, setId: uuidSchema, reps, weight }` where `reps`/`weight` reuse the EXACT
coercion + bounds from `strengthSetSchema` (no re-typed `z.coerce.number()` — extract the field shapes
if they aren't already reusable, per the constants/reuse rule). One source for "what a valid rep/weight
is," shared by the log form and the edit form.

**E6 — Server Action mirrors the existing writers.** `editStrengthSetAction(_prev, formData)` in the
route's `actions.ts`: `safeParse` the schema, resolve the profile by `public_id` (the ownership seam,
never a raw internal id), call the DAL, `revalidatePath(/p/${id})`, typed `ActionState` envelope. Same
authZ shape as the other writers (existence-check until Clerk v1.5). A failed guard (wrong owner /
missing set) surfaces as a typed error, not a throw.

**E7 — UI: a per-set client island with progressive disclosure.** The "Logged entries" list is a pure
RSC (page.tsx). Introduce ONE small client component, `EditableSet`, rendered per strength set inside
`MovementLine`: it shows the read line (`reps × weight`) plus a ≥44px **Edit** control; tapping reveals
inline `reps` × `weight` number inputs (reusing the log form's `inputClass` + `inputmode`) with
**Save**/**Cancel**, wired to `editStrengthSetAction` via `useActionState`. Collapsed by default (the
V1-9a progressive-disclosure idiom), so the read view is unchanged until you choose to edit. Only
strength sets get it; bodyweight/check-in lines are untouched.

**E8 — Tests (same PR).** `db:verify`: log a session → edit a member's set → reselect asserts new
reps/weight + advanced `updated_at`; a wrong-`profileId` edit changes nothing (ownership scope). Action
boundary: bad body → zod-reject; wrong-owner setId → typed error, no write. Schema: reps/weight bounds
(shared with the log form's vectors). Component: the `EditableSet` toggle read↔edit + Cancel restores.

## File-by-file

| Path                                          | Change   | What                                                                                                                                  |
| --------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared/src/strength.ts`             | EDIT     | Export the reusable `reps`/`weight` field shapes (if not already); `editStrengthSetSchema` may live here or in `strength-session.ts`. |
| `packages/shared/src/strength-session.ts`     | EDIT     | `editStrengthSetSchema` (`{profileId, setId, reps, weight}`), reusing the set-field shapes (E5).                                      |
| `packages/db/src/writers/strength-session.ts` | EDIT     | `updateStrengthSetById` — ownership-scoped UPDATE + `updated_at=now()`, returns the row or throws (E3/E4).                            |
| `packages/db/scripts/verify.ts`               | EDIT     | Edit round-trip + ownership-scope assertion (E8).                                                                                     |
| `apps/web/lib/dal/entries.ts`                 | EDIT     | `SetDTO.publicId` + select column (E2); `editStrengthSet` DAL wrapper (resolve profile → call the writer).                            |
| `apps/web/app/p/[profileId]/actions.ts`       | EDIT     | `editStrengthSetAction` (E6).                                                                                                         |
| `apps/web/app/p/[profileId]/editable-set.tsx` | NEW      | The `EditableSet` client island (E7).                                                                                                 |
| `apps/web/app/p/[profileId]/page.tsx`         | EDIT     | Render each strength set via `EditableSet` (pass `profileId` + set).                                                                  |
| tests                                         | NEW/EDIT | schema · action boundary · `EditableSet` component · `db:verify` (E8).                                                                |
| docs/plan.md, docs/status.md                  | EDIT     | V1-8 → merged; V1-9 → in-flight.                                                                                                      |

## Open scope calls (stated, not blocking)

- **Bodyweight-value edit** is deferred (separate surface, not a "set"); if the panel deems the DAL/UI
  reuse cheap, it can fold in — otherwise it's V1-9's fast-follow.
- **Add/remove a set post-log** is out (overlaps V1-9b delete + reopens the set-list write path).

---

## Adversarial panel review log

_(4 lenses — correctness/data-integrity · simplicity/scope · architecture/consistency · code-reuse/DRY.
No DB-safety lens: no migration. Reconciled below before implementation.)_

### The central adjudication — keep the update in `packages/db` (reject "DAL-local"), but minimal

Simplicity called the `packages/db` writer + `db:verify` proof (E3/E8) ceremony for a one-row UPDATE and
wanted it DAL-local, proven by the "mandated" action-boundary integration test. **Rejected on a factual
premise:** this project's Server Action tests **mock Drizzle** (AGENTS.md testing-gotchas: "test as plain
async fns (mock Clerk `auth()` + Drizzle)"), so a mocked action test would **not** exercise the
ownership-guard SQL at all — the one security-critical, IDOR-relevant part of this slice. `db:verify`
(PGlite, a required CI check) is the project's real-DB proof path. Architecture (S1) and correctness (#4)
both want the BOLA guard exercised against a real DB, and correctness's soft-deleted-set case only exists
there. **Decision: keep `updateStrengthSetById` in `packages/db`, resolve ownership by `public_id`
_inside_ the guarded UPDATE, prove via `db:verify`.** But adopt simplicity's _spirit_ — the writer is a
single minimal guarded UPDATE (no `db.transaction`), the schema is a one-line `.extend()`, and the
redundant bounds test + the broader `resolveLiveProfileId` refactor are dropped.

### Findings & dispositions

**BLOCKING — accepted:**

- **[correctness #1 / arch N2] `weight_label` masks `weight_num` → the fix is invisible + row double-populated.**
  `page.tsx:276` renders `weightLabel ?? \`${weight} ${unit}\``, so a labeled set ('BW', '50ft') would
still show the stale label after editing `weight_num`. **Revise E1/E7 scope:** the Edit affordance is
offered **only on numeric reps+weight sets** — `weightLabel === null && reps !== null && weight !== null`.
Label-only sets, timing/`seconds`sets, and null-valued sets render **read-only** (no edit). This also
resolves correctness #3 (null-valued sets can't round-trip). Session`sc_lift` sets qualify (label NULL).
- **[correctness #2 / arch B1] E3-throws vs E6-typed-error contradiction.** A set's ownership is only
  knowable from the guarded UPDATE's zero-row result (unlike a profile, pre-checked by
  `getProfileByPublicId`), so a guard miss is a **reachable** expected path (IDOR / stale id) and must NOT
  throw to `error.tsx`. **Revise E3/E6:** the writer returns `{ publicId } | null` from
  `.returning()` (`rows.length === 0 → null`); the DAL passes it through; the action maps `null →
{ ok:false, error:'That set could not be found.' }`. No throw crosses the boundary.
- **[code-reuse B1] `inputClass` is triplicated + module-private; the reps × weight row would be a 4th copy.**
  **Adopt:** hoist `inputClass` to `apps/web/lib/constants.ts` (exported; update the 3 existing forms —
  strength/bodyweight/checkin — to import it, killing the triplication), and extract a shared client
  `SetRepsWeightFields` (the two number inputs + `×`, with their `inputMode/min/step/aria`) from
  `MovementCard`'s set row (`strength-form.tsx:366-391`). Both `MovementCard` and `EditableSet` consume it.

**SHOULD-FIX — accepted:**

- **[all lenses] schema via `.extend()`, in `strength.ts`.** `editStrengthSetSchema =
strengthSetSchema.extend({ profileId: uuidSchema, setId: uuidSchema })` — exact reps/weight reuse
  (keeps the `weight` blank→NaN preprocess), no field-shape extraction. Placed in
  `packages/shared/src/strength.ts` (the _set_ concern, per arch S3's blast-radius argument — NOT
  `strength-session.ts`, the session-graph concern). Drop the `strength.ts`/`strength-session.ts`
  ambiguity in the table; only `strength.ts` changes.
- **[arch S1/S2/S4] ownership seam inside the writer; return `{ publicId }`; no tx.** The guarded UPDATE
  proves ownership by joining `profiles` on `public_id` in a subquery (`inArray(entrySets.entryId, select
entries ⋈ profiles where publicId=$ and all deleted_at null)`), returns `{ publicId }` (never a raw row /
  internal id), and is NOT wrapped in `db.transaction` (a single atomic statement).
- **[correctness #4] explicit set-level `deleted_at` guard + `db:verify` soft-deleted-set case.** The UPDATE
  `WHERE` includes `entry_sets.deleted_at IS NULL` (not just entry/profile); `db:verify` asserts a
  soft-deleted set → no match, alongside the wrong-`public_id` case.
- **[code-reuse S2 / arch N3] `EditableSet` owns the per-set render on all 3 surfaces.** The set-line
  formatting (`weightLabel ?? \`${weight} ${unit}\``, `reps ?? '?'`) relocates INTO `EditableSet`;
`MovementLine`'s set `.map` (`page.tsx:273-279`) delegates to `<EditableSet>`. So the formatting lives
  once and applies uniformly to flat entries, session members, and superset members.
- **[correctness #5/#6] `.returning()` length for zero-match; `String(weight)`; subquery not `update().from()`.**
- **[arch S5] server-`now()` LWW recorded as accepted debt** in `docs/tech-debt.md` (not only the writer
  edge), with the v1.5 client-timestamp payoff pointer.

**Dropped / noted (not this slice):**

- **[simplicity #3] redundant bounds test** — cut; test only the new `setId`/`profileId` surface (bounds
  are inherited from `strengthSetSchema`'s golden vectors).
- **[code-reuse S3] `resolveLiveProfileId` 5×-duplication** — real, but refactoring the 4 existing call
  sites is out of V1-9's scope. Resolve ownership inline in the UPDATE subquery; note the extract as a
  future DRY chore.
- **[simplicity #5] bodyweight-value edit stays deferred** (separate table/column/surface). Add/remove-set
  (V1-9b) and notes (V1-9a) remain out.

### Net effect on the file-by-file

- **Removed:** `packages/shared/src/strength-session.ts` edit (schema goes to `strength.ts`).
- **Added:** `apps/web/lib/constants.ts` (hoist+export `inputClass`); `apps/web/app/p/[profileId]/set-fields.tsx`
  (NEW — `SetRepsWeightFields`); edits to `bodyweight-form.tsx` + `checkin-form.tsx` + `strength-form.tsx`
  (import the hoisted `inputClass`; strength-form also consumes `SetRepsWeightFields`); `docs/tech-debt.md`
  (LWW debt).
- **`packages/db/src/writers/strength-session.ts`** keeps `updateStrengthSetById` (minimal, no tx,
  ownership-by-`public_id` subquery, returns `{ publicId } | null`); **`verify.ts`** keeps the edit +
  ownership-scope + soft-deleted cases.
- **`EditableSet`** owns the per-set render (read-only for non-numeric sets, inline-edit for numeric).
