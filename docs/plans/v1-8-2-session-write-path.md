# V1-8-2 — Strength session write path (flat multi-movement) — Staff plan & panel log

> Backlog: [plan.md](../plan.md) row **V1-8-2**, second slice of **V1-8** (master plan:
> [v1-8-strength-sessions.md](./v1-8-strength-sessions.md)). V1-8-1 (#53, merged) shipped the DB model
> (`supersets` + `entries.superset_id`/`superset_order` + `db:verify` proof, DB-only). This slice ships
> the **app write path for flat multi-movement sessions** — the session **grouping/read UI moves to
> V1-8-3** (panel B1), which builds the grouping anyway for superset bracketing. Branch:
> `feat/v1-8-2-session-write-path`. Hardened by a 4-lens adversarial panel (§10) — scope was cut and the
> single-source obligation relocated; no blocking defect survives.

## Goal

Turn the **single-movement** strength logger into a **multi-movement session**: one "Log strength"
submission writes a `sessions` row grouping **N movement entries** (each its own `entry` → `entry_set`),
so a kid logs squat + press + rows in one go. Movements **render flat** (each its own row with sets — the
exact way three single-movement logs render today), which fully meets the plan.md acceptance **"Log a
full S&C strength day."** The `session_id` tag is the structural key V1-8-3's grouping + superset
bracketing read from; this slice writes and **proves** it (`db:verify`) without displaying grouping.

---

## 1. Scope (post-panel)

**In:**

- **`packages/db` shared write core** (panel B2) — `writeSessionStrengthEntry(exec, …)` (the entry-insert
  - `ON CONFLICT` + replay-reselect + `entry_set` loop, lifted from `logStrengthEntry`) and a session-row
    insert helper, both **parameterized over a `db | tx` executor** with **pre-resolved** ids, living in
    `packages/db/src/writers/` — the `weeklyAdherenceRows` "one unit, two consumers" pattern applied to a
    writer. The app DAL and `verify.ts` both call it → true single-source, no drift.
- `logStrengthSessionSchema` in `packages/shared` — reuses `strengthSetSchema`, `BODYWEIGHT_UNITS`,
  `uuidSchema`, and a new `DEFAULT_SESSION_TYPE` const. Flat only (no `feel`, no `supersetIdx`).
- `logStrengthSession` app DAL — a **thin wrapper**: resolves `activityTypeId` + per-movement
  `movementId` + the profile (inline `tx.select`, not `getProfileByPublicId` — F7), opens ONE
  `db.transaction`, calls the shared core (session row + N movement entries, per-row `ON CONFLICT`, no
  parent short-circuit).
- `logStrengthSessionAction` — `JSON.parse`(try/catch) → `logStrengthSessionSchema` → `resolveDeclaredDay`
  → `getProfileByPublicId` → DAL → `revalidatePath`; **`ok:true` on idempotent replay** (not the check-in
  "already logged" error — panel N6).
- Multi-movement `StrengthForm` — a mapped **`MovementCard`** sub-component (per-card set state — panel
  N3), the `checkin-form` **`idSeed` multi-id rotation** idiom (panel N4), a JSON hidden `movements`
  field. No feel input (deferred).
- Read: **switch `listEntriesForDay`'s set-fetch dispatch from `kind === 'strength'` to `movement_id !==
null`** (add `movementId` to the SELECT for the filter; it is used internally like the internal `id`,
  **not** added to `EntryDTO`). This is the ONLY read change — it is load-bearing (session members are
  `kind=NULL`, so the old dispatch would fetch zero sets for them) and decouples reads from the V1-1d
  `kind` drop.
- **Retire** `logStrengthEntry` / `logStrengthAction` / `logStrengthSchema` (Option A — the form no longer
  calls them; deletes the last `kind='strength'` writer, advancing V1-1d decoupling), and **sweep the
  stale comments** that name them as live writers (panel N7).
- Tests: shared-schema unit; `actions.test.ts` boundary (unauth-shaped / malformed-JSON / happy) swapping
  the deleted strength tests; the **single-sourced `db:verify` round-trip** (now non-optional — it is the
  ONLY thing pinning the write core's behavior, panel N5). Tri-viewport screenshots (390/820/1280).

**Out (→ V1-8-3, panel B1):** the `session` `TodayRow` grouping variant + session header + nested/bracketed
render; `EntryDTO` `sessionId`/`supersetId`(as **public_id**)/`supersetOrder`/`feel`/`sessionType`; the
`sessions` LEFT JOIN (+ its `deleted_at IS NULL` predicate — correctness #10); within-session member
ordering (correctness #7); the optional session **feel** input/display; the superset write branch + UI;
the Q4 single-movement-header display-consistency call.

**Out (→ later):** `next_day_soreness` (v2), weighted-calisthenics/`pullup_max` (V1-8a), set edit/delete
(V1-9/9b), per-exercise notes (V1-9a), session CSV (V1-13).

**Size:** ~350–400 lines. The multi-movement form is the bulk and the spillover-watch; it stays with the
write path (splitting the form from its only caller is the caller-less anti-pattern). If it clears 400 as
one coherent concern, that is flagged in the PR, not crammed.

---

## 2. Single-movement-path disposition — Option A (retire now), CONFIRMED by the panel

Once the form submits a session, `logStrengthEntry`/`logStrengthAction`/`logStrengthSchema` have **no
caller** (grep: only the form + its tests). All four lenses endorsed **retiring them this slice**:
correctness confirmed it's safe (`db:verify` never calls the strength DAL; the only refs are the action +
tests); architecture noted it _advances_ the V1-1d decoupling (deletes the last `kind='strength'`
writer); code-reuse noted it moots the `logStrengthSchema`↔session-schema overlap (one definition, no
sub-schema needed). Simplicity's caveat — retirement adds test-rewrite diff — is real but outweighed:
leaving a caller-less transactional writer is the dead-code the slice discipline forbids, and the standing
code-review lens would flag it. **Decision: retire in 8-2**, keep `strengthSetSchema` (the session schema
depends on it), and sweep the stale comments (`entries.ts:101`, `:250-251`) so the retained `kind`/
`entries_shape_check` notes don't lie about who writes them.

---

## 3. Design decisions (post-panel)

**D1 — Shared write core in `packages/db` (panel B2, the pivotal relocation).** `weeklyAdherenceRows` is
single-sourceable because it is a `packages/db/src/queries` unit taking the db handle, imported by both
the app DAL and `verify.ts`. A writer in app-side `entries.ts` (`server-only`, Neon `db`, app catalog
helpers) **cannot** be imported by `verify.ts` (wrong side of the app→packages edge). So the pure insert
core moves to `packages/db/src/writers/strength-session.ts`:

- `writeSessionStrengthEntry(exec, { profileId, sessionId, movementId, movementName, unit, sets, clientId,
day, activityTypeId })` — insert the `entry` (`kind=NULL` + `movement_name` + `movement_id`, `metric_key`
  **unset**, `activity_type_id` set, `superset_id`/`superset_order` NULL, `status` omitted → column
  default), `onConflictDoNothing` on `clientId` `WHERE deleted_at IS NULL`; on conflict re-select + return
  without re-inserting sets (the existing idempotent-replay behavior); else insert the N `entry_set` rows
  (1-based `idx`, `weightNum = String(weight)`). Returns `{ id, publicId, created }`. Takes an optional
  `sessionId` now; V1-8-3 adds optional `supersetId?`/`supersetOrder?` args (not a fork — panel #1).
- `insertStrengthSessionRow(exec, { profileId, day, sessionType, clientId })` — insert the `sessions` row
  (`onConflictDoNothing` on `clientId`); on conflict re-select the id by `clientId`. Returns `{ id }`.

Both are parameterized over the driver-generic executor type (the `asPg` cast precedent). **No
`server-only`, no app catalog/profile imports** — the caller pre-resolves every id. This is what makes the
DAL and `verify.ts` run the _same_ insert path.

**D2 — `logStrengthSession` app DAL = thin resolve-+-tx wrapper.** Resolve `activityTypeId =
getActivityTypeIdByKey(scLift)` and each movement's `movementId = findOrCreateMovementId(name)` **outside**
the tx (cached/idempotent-by-slug). Open ONE `db.transaction(async (tx) => …)`:

1. Resolve the profile via inline `tx.select({id}).from(profiles).where(publicId=…, deletedAt null)` (F7 —
   NOT `getProfileByPublicId`). Throw if absent.
2. `const { id: sessionId } = await insertStrengthSessionRow(tx, {…})` — **re-selected on conflict**, so a
   replay attaches new movements to the existing session.
3. For each movement: `writeSessionStrengthEntry(tx, { …, sessionId })` — threading the **re-selected**
   `sessionId` into every movement (incl. ones added on a replay — correctness #3). **No "session exists →
   skip movements" short-circuit** (a crash after the session commit would orphan it — master R7).

Returns `{ sessionId: publicId }`. No per-movement result surfacing (panel simplicity #7a — the action's
success is "session resolved," and replay is idempotent-`ok:true`).

**D3 — `logStrengthSessionSchema` (flat).** In `packages/shared/src/strength-session.ts`:

```
{
  profileId: uuidSchema,
  clientId:  uuidSchema,                        // the SESSION's client_id
  sessionType: sessionTypeSchema.default(DEFAULT_SESSION_TYPE),   // NEW const in sessions.ts — panel N1
  movements: z.array(z.object({
    movementName: z.string().trim().min(1).max(100),
    unit: z.enum(BODYWEIGHT_UNITS),
    clientId: uuidSchema,                        // per-movement entry client_id
    sets: z.array(strengthSetSchema).min(1).max(20),
  })).min(1, 'Add at least one movement.').max(12),
}
```

No `feel`, no `supersetIdx`/`supersetOrder` (flat, no dead fields). `day` resolved server-side
(`resolveDeclaredDay`), not in the schema. `DEFAULT_SESSION_TYPE = SESSION_TYPES[0]` added to `sessions.ts`
(mirroring `DEFAULT_BODYWEIGHT_UNIT`), so the default is sourced, never a re-typed `'strength'`.

**D4 — FormData encoding: one JSON hidden `movements` field (panel N8, accepted with guards).** The
existing parallel `reps`/`weight` arrays can't encode N movements × variable set counts. The form (already
a client component holding movement/set state) serializes that state to a hidden `movements` field via
`JSON.stringify`; the action `JSON.parse`s (try/catch → typed `{ok:false}`, never `error.tsx`) then
`logStrengthSessionSchema`-validates. The **zod schema is the trust boundary** — consistent with how
`logStrengthAction` already trusts `movementName`/`sets` from the body (strength is inherently free data
with no server registry to walk, unlike check-ins; this does NOT violate `logCheckinsAction`'s
"never-enumerate" stance). Guards: the schema's `.max(12)`/`.max(20)` bound the graph; a malformed-JSON
boundary test is mandatory. **`sessionType` is omitted from the parse object** (no form control in 8-2) so
the `.default` fires — passing `formData.get('sessionType')` would send `null`, which `.default` does NOT
catch and `z.enum` rejects → unreachable happy path (correctness B3). First JSON-encoded field in the app
— flagged in the PR as a conscious precedent.

**D5 — Read: `movement_id` dispatch only.** In `listEntriesForDay`, add `movementId:
schema.entries.movementId` to the SELECT and change the set-fetch filter from `r.kind ===
ENTRY_KIND.strength` to `r.movementId !== null`. Correct + safe (correctness #2): every legacy strength row
has `movement_id` (0002 backfill); metric rows (bodyweight/check-in/calisthenics/life) have it NULL by the
at-most-one CHECK → excluded; only `sc_lift` entries carry it. `movementId` is used only in the filter
(like the internal `id`) — **`EntryDTO` is unchanged this slice**. No `sessions` join, no grouping (→ 8-3).

**D6 — The form (multi-movement, mobile-first).** A mapped list of **`MovementCard`** file-local
sub-components — each owns its **own** `setKeys`/`addSet`/`removeSet` state (per-card, so add-set on card 2
never mutates card 1 — panel N3) and one `<fieldset>`/`<legend>`, reusing the existing set-row markup +
the shared `inputClass` (import it, don't add a third copy — panel #11). "Add movement" / "Remove movement"
(min 1). Per-movement + session `clientId`s live in React state (needed to serialize) via the
**`checkin-form` `idSeed` + `useMemo` rotation** idiom (panel N4 — NOT the single-`clientIdRef` idiom,
which conflicts with a controlled JSON field); on `state.ok`, bump `idSeed` to rotate all ids + reset. No
feel input. ≥44px targets, `inputmode` numeric/decimal, cards stack at 360px, one `<h2>`-scoped form.

---

## 4. File-by-file

| Path                                           | Change | What & why                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/db/src/writers/strength-session.ts`  | NEW    | `writeSessionStrengthEntry(exec, …)` + `insertStrengthSessionRow(exec, …)` over a `db\|tx` executor with pre-resolved ids (D1, B2). The single source the DAL + verify share.                                                                                                                                                                        |
| `packages/db/src/index.ts` (or writers barrel) | EDIT   | Export the writer core for both consumers.                                                                                                                                                                                                                                                                                                           |
| `packages/shared/src/strength-session.ts`      | NEW    | `logStrengthSessionSchema` + type (D3).                                                                                                                                                                                                                                                                                                              |
| `packages/shared/src/sessions.ts`              | EDIT   | Add `DEFAULT_SESSION_TYPE = SESSION_TYPES[0]` (panel N1).                                                                                                                                                                                                                                                                                            |
| `packages/shared/src/index.ts`                 | EDIT   | Export the new schema/type + const.                                                                                                                                                                                                                                                                                                                  |
| `apps/web/lib/dal/entries.ts`                  | EDIT   | Add `logStrengthSession` thin wrapper (D2); switch read set-fetch to `movement_id` + add `movementId` to the SELECT (D5, DTO unchanged). **Remove `logStrengthEntry`**; sweep its stale comments (N7).                                                                                                                                               |
| `apps/web/app/p/[profileId]/actions.ts`        | EDIT   | Add `logStrengthSessionAction` (D4, N6). **Remove `logStrengthAction`** + `logStrengthSchema` import.                                                                                                                                                                                                                                                |
| `apps/web/app/p/[profileId]/strength-form.tsx` | EDIT   | Multi-movement `MovementCard` map + JSON `movements` field + `idSeed` rotation (D6). Calls `logStrengthSessionAction`.                                                                                                                                                                                                                               |
| `packages/shared/src/strength.ts`              | EDIT   | **Remove `logStrengthSchema`/`LogStrengthInput`**; keep `strengthSetSchema` (Option A / panel #5).                                                                                                                                                                                                                                                   |
| `packages/db/scripts/verify.ts`                | EDIT   | Replace the bespoke session-insert helpers in a flat-session round-trip with the **shared `packages/db` core** (B2/N5): a 3-movement session persists as 1 `sessions` row + 3 `entry`s (`kind=NULL`, `movement_id`+`movement_name`, `session_id`) + sets; insert-twice → one graph; profile-scoped. Every existing V0–V1-8-1 assertion still passes. |
| `apps/web/app/p/[profileId]/actions.test.ts`   | EDIT   | Swap the `logStrength*` boundary/happy tests + the declared-day representative to `logStrengthSessionAction` (unauth-shaped / malformed-JSON / happy / default-`sessionType` lands).                                                                                                                                                                 |
| `docs/plan.md`, `docs/status.md`               | EDIT   | V1-8-2 wording; **carry the stale V1-7 (#52) → merged and V1-8-1 (#53) → merged** transitions the pristine-`main` merges deferred; note the 8-2/8-3 grouping rebalance (B1).                                                                                                                                                                         |
| `docs/plans/v1-8-strength-sessions.md`         | EDIT   | Update the §5 8-2/8-3 sketch rows to reflect the B1 rebalance (grouping → 8-3).                                                                                                                                                                                                                                                                      |
| `docs/plans/v1-8-2-session-write-path.md`      | NEW    | This plan (the reviewed contract + panel log).                                                                                                                                                                                                                                                                                                       |

**Not touched:** migrations (`0000`–`0005` — no schema change), `EntryDTO`, `activity-totals.ts`/`page.tsx`
(no grouping this slice), bodyweight/checkin/life forms & actions, the adherence path.

---

## 5. Test plan

- **Shared unit** (`strength-session.test.ts`): accepts a valid N-movement session; rejects 0 movements /
  a movement with 0 sets / bad unit / non-uuid; `sessionType` **defaults** when omitted.
- **Action boundary** (`actions.test.ts`, AGENTS.md mandatory set): unknown/absent profile → `{ok:false}`,
  no DAL call; malformed `movements` JSON / failed zod → typed error, no DAL call; happy path → the DAL
  called with the resolved profile + parsed movements + resolved day, then `revalidatePath`; a submit with
  no `sessionType` → default lands (correctness B3). Actions tested as plain async fns (mocked
  `getProfileByPublicId` + DAL).
- **`db:verify`** (PGlite): the **single-sourced** flat-session round-trip via the shared `packages/db`
  core (N5 — the only behavior pin for the write core now): 3 movements under one session, `kind=NULL` +
  `movement_id` + `session_id`, sets 1-based, insert-twice → one graph (per-row dedupe), consistent
  `entry.session_id == session.id`, profile-scoped. All prior assertions still green (the extraction is
  proven here, not assumed — R1 corrected).
- **e2e** stays green; **tri-viewport screenshots** (390/820/1280) of the empty + 2-movement-filled form
  and the flat logged rows, attached to the PR (mobile+desktop min).
- **Code review** — the standing workflow-backed round (every PR; iterate to no critical/blocking), panel
  including the code-reuse/DRY lens.

---

## 6. Reuse obligations (DRY rule)

- **The write core is single-sourced in `packages/db`** (D1/B2) — the DAL and `verify.ts` call ONE
  `writeSessionStrengthEntry` (no second insert path in either). The `weeklyAdherenceRows` precedent,
  applied to a writer.
- `logStrengthSession` reuses `findOrCreateMovementId`, `getActivityTypeIdByKey(scLift)`, the inline
  `profiles` publicId→id select (F7), `newId()`, the `onConflictDoNothing({target:clientId, where:isNull(
deletedAt)})` idiom.
- `sessionType` default = **`DEFAULT_SESSION_TYPE`** (new const off `SESSION_TYPES`), never a literal
  (panel N1). Session `status` **omitted** → `sessions.status` default (panel N2), never `'done'`.
- Shared schema reuses `strengthSetSchema`/`BODYWEIGHT_UNITS`/`uuidSchema`/`sessionTypeSchema`.
- Form reuses the existing `inputClass` (import, don't re-type — panel #11) and the `checkin-form`
  `idSeed`/`useMemo` multi-id rotation (panel N4). `MovementCard` is a **file-local** sub-component — no
  cross-file component package for one form (panel N3/#7: not over-abstraction).
- The 4→5 action shape (parse→resolveDeclaredDay→getProfileByPublicId→DAL→revalidatePath) stays **inline**
  per action — the codebase deliberately repeats it; no `runAction` helper (panel #9, blessed).

---

## 7. Risks / rollback

- **R1 — the `packages/db` write-core extraction changes behavior (`kind='strength'` → `kind=NULL`) and is
  NOT a pure lift** (correctness #8). The ONLY pin is the **non-optional single-sourced `db:verify`
  round-trip** (§5) — which now exercises the actual write core, so a regression fails verify. (The old
  framing "pinned by the existing strength assertions + action test" was wrong: verify uses raw SQL and the
  action test is deleted. Corrected.)
- **R2 — the executor-generic type across Neon `tx` + PGlite.** Mitigated by the `asPg`/`weeklyAdherenceRows`
  precedent (already generic over both drivers); the core takes the transaction executor, verify passes the
  PGlite handle.
- **R3 — removing `logStrengthEntry`/`Action` breaks a hidden caller.** Grep confirms only the form + tests;
  typecheck catches any stray import. Stale comments swept in the same PR (N7).
- **R4 — malformed-JSON body** → try/catch → typed `{ok:false}` (D4); a boundary test drives it; schema
  `.max` bounds cap the graph.
- **No migration** → no DB rollback surface; fix-forward.

---

## 8. Open questions — resolved by the panel

- **Q1 — retire the single-movement path?** **YES, Option A**, this slice (§2; all 4 lenses).
- **Q2 — FormData encoding?** **JSON hidden field** (D4) with try/catch + size bound + boundary test.
- **Q3 / Q4 — session header content / display-consistency?** **Deferred to V1-8-3** with the whole
  grouping UI (panel B1). 8-2 renders flat, so old/new single-movement logs render identically — the split
  only appears when grouping lands in 8-3, where Q4 (lightweight/absent header for a 1-movement session)
  is resolved.

---

## 9. Out-of-scope / deferred

Per §1 "Out": read grouping + header + feel + the `EntryDTO` session/superset fields + member ordering +
the `sessions` LEFT JOIN → **V1-8-3**; superset write branch + UI → V1-8-3; `next_day_soreness`, weighted
calisthenics, set edit/delete, notes, session CSV → later slices/v2.

---

## 10. Review-response log (adversarial panel)

Four lenses: Correctness/data-integrity · Simplicity/scope · Architecture/consistency · Code-reuse/DRY (no
DB-safety lens — no migration this slice). Net: **8-2 scope cut to the write path** (grouping → 8-3), the
**single-source obligation relocated** to `packages/db` (it was infeasible app-side), the `null`-default
happy-path trap fixed, and several re-typed literals / form-state bugs corrected. No blocking defect
survives.

| #   | Lens(es)                                     | Critique                                                                                                                                                                                                                                                                                                   | Resolution                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| B1  | simplicity (BLOCKING) + architecture + reuse | Read-path session GROUPING (`session` `TodayRow` variant, header, nested render, 5 new `EntryDTO` fields, incl. a `supersetId` **internal id** that breaks anti-IDOR) has no live consumer in a flat slice; 8-3 reworks that exact grouping for superset bracketing; the ~330 estimate is really ~550-650. | **Incorporated — cut.** 8-2 = write path + flat render + the load-bearing `movement_id` dispatch (the ONLY read change; `EntryDTO` unchanged). Grouping/header/feel + `sessionId`/`supersetId`(as public_id)/`supersetOrder`/`feel`/`type` DTO fields + member ordering + the `sessions` LEFT JOIN all move to **V1-8-3**. Resolves the budget blow + the old/new display split.                                                                                                                                               |
| B2  | architecture (BLOCKING) + reuse (BLOCKING)   | "Single-source à la `weeklyAdherenceRows`" (master R10e, non-optional) is **infeasible** with `logStrengthSession` in `server-only` app-side `entries.ts` — `verify.ts` (in `packages/db`) can't import across the app→packages edge, so it'd fork a second writer (the drift R10 exists to prevent).      | **Incorporated — relocate.** The pure insert core moves to `packages/db/src/writers/strength-session.ts`, parameterized over a `db\|tx` executor + pre-resolved ids (the `weeklyAdherenceRows` shape). The app DAL is a thin resolve-+-tx wrapper; `verify.ts` calls the same core. True parity (D1).                                                                                                                                                                                                                          |
| B3  | correctness (latent BLOCKING)                | `sessionType.default('strength')` / `feel.optional()` reject the `null` that `FormData.get` returns (`.default` fires on `undefined` only; `z.enum` rejects `null`) → with no form control, every strength log fails validation — happy path unreachable.                                                  | **Incorporated.** `sessionType` is **omitted** from the parse object so `.default` fires (feel dropped entirely with grouping). Boundary test asserts the default lands. The `?? undefined` idiom (`logBodyweightAction:59`) is the fallback if a control is ever added.                                                                                                                                                                                                                                                       |
| N1  | code-reuse                                   | `sessionType: sessionTypeSchema.default('strength')` is itself a re-typed literal — contradicting the R10c it cites, and the merged `verify.ts:1183` `SESSION_TYPES[0]` precedent.                                                                                                                         | **Incorporated.** Add `DEFAULT_SESSION_TYPE = SESSION_TYPES[0]` to `sessions.ts` (mirroring `DEFAULT_BODYWEIGHT_UNIT`); the schema defaults to it. Sourced, not re-typed.                                                                                                                                                                                                                                                                                                                                                      |
| N2  | code-reuse                                   | Session `status: 'done'` (D1) is a re-typed literal; every writer uses `ENTRY_STATUS.done`, and `sessions.status` already defaults to `'done'`.                                                                                                                                                            | **Incorporated.** The core **omits** `status` → column default. (Never the bare string.)                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| N3  | code-reuse + correctness                     | "The single-movement UI, repeated" over N movements with ONE shared `setKeys` state would let add-set on card 2 mutate card 1 — a DRY defect AND a correctness bug.                                                                                                                                        | **Incorporated.** A mapped **file-local `MovementCard`** with its **own** per-card set state (D6). File-local, not a cross-file component package (not over-abstraction for one form).                                                                                                                                                                                                                                                                                                                                         |
| N4  | code-reuse                                   | The plan cited the single-`clientIdRef` DOM-rotation idiom, which doesn't scale to N per-movement ids + a session id and conflicts with a controlled JSON field.                                                                                                                                           | **Incorporated.** Reuse the `checkin-form` **`idSeed` + `useMemo`** multi-id rotation (ids in React state, needed to serialize the JSON field), rotated on success.                                                                                                                                                                                                                                                                                                                                                            |
| N5  | correctness + reuse                          | The "behavior-preserving lift" framing is false (the core flips `kind`), and R1's stated pin (existing strength assertions + action test) is wrong — verify uses raw SQL, the action test is being deleted.                                                                                                | **Incorporated.** The single-sourced `db:verify` round-trip is **non-optional** and is the sole behavior pin (it now exercises the actual core). R1 wording corrected (§7).                                                                                                                                                                                                                                                                                                                                                    |
| N6  | correctness                                  | Don't clone the check-in "already logged" error: the strength form rotates its `clientId` on success, so a same-`clientId` resubmit is a genuine retry → idempotent success.                                                                                                                               | **Incorporated.** The action returns `ok:true` on replay (the `logLifeActivitiesAction` precedent), success = "session resolved," no per-movement partial-conflict surfacing.                                                                                                                                                                                                                                                                                                                                                  |
| N7  | architecture                                 | Retiring `logStrengthEntry` leaves stale comments naming it a live writer (`entries.ts:101`, `:250-251`) and the master-plan "untouched" note, making the retained `kind`/shape-check comments lie.                                                                                                        | **Incorporated.** Sweep the stale comments in the same PR. (The old/new single-movement **display** split is deferred with grouping — B1 — so no split appears in 8-2.)                                                                                                                                                                                                                                                                                                                                                        |
| N8  | architecture + simplicity + reuse            | JSON-in-a-hidden-field is the app's first such encoding (no precedent); acceptable because strength is free data with the zod schema as the boundary (doesn't violate `logCheckinsAction`'s never-enumerate stance).                                                                                       | **Accepted with guards (D4).** try/catch → typed envelope; schema `.max` bounds the graph; a malformed-JSON boundary test; flagged in the PR as a conscious precedent. The multi-movement form itself is core to the acceptance (not over-build).                                                                                                                                                                                                                                                                              |
| —   | all (confirmations)                          | —                                                                                                                                                                                                                                                                                                          | **Confirmed:** the `writeSessionStrengthEntry` extraction is warranted DRY (immediate caller); the `movement_id` dispatch is correct **and load-bearing** (kind=NULL members); the one-tx per-row-`ON CONFLICT` idempotency graph is correct incl. new-movement-on-replay (re-selected `sessionId` threaded); all 5 CHECKs pass for a `kind=NULL`+`movement_name`+`movement_id` member; `entryLabel` renders it; retirement is safe; `logStrengthSessionAction` is thin/consistent; the 4-action shape stays inline (blessed). |
