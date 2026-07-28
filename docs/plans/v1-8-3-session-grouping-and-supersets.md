# V1-8-3 — Session grouping (read) + supersets — Staff plan & panel log

> Backlog: [plan.md](../plan.md) row **V1-8-3**, final slice of **V1-8** (master:
> [v1-8-strength-sessions.md](./v1-8-strength-sessions.md); model ADR:
> [0003](../decisions/0003-superset-log-grouping.md)). V1-8-1 (#53) shipped the `supersets` schema; V1-8-2
> (#54) shipped the **flat** multi-movement write path — movements render **flat**, and the read-path
> session **grouping** was deferred here (the 8-2 panel B1 rebalance). Split into **3a (read grouping)**
> then **3b (supersets)**; this plan details **3a**. Branch: `feat/v1-8-3-superset-ui`. Hardened by a 4-lens
> panel (§10) — `feel` was cut to 3b, making 3a a **pure read slice**; no blocking defect survives.

## Goal (V1-8-3a)

Make a logged strength **session** read as one grouped **block** (a labeled header + its movements nested,
in insertion order) instead of N loose top-level rows. Pure read change — it groups the sessions 8-2
already writes; no new write path, no migration, no form change. Supersets and the session **feel**
input/display land in **3b** (panel: feel is write-path surface that doesn't belong in a read slice).

---

## 1. Scope + sub-split (read first)

The full 8-3 is ~600+ and mixes a read-model change, a transactional superset write branch, and a grouping
form UI — the mixing the <400/one-concern rules forbid. **2-way split** (all four lenses endorsed):

| Sub-PR                   | Scope                                                                                                                                                                                                                                                                                                                                                                                       | Closes                                                         | ~Size |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ----- |
| **V1-8-3a** ← THIS       | **Pure session read grouping.** `sessions` LEFT JOIN + `sessionId`(public_id)/`sessionType` on `EntryDTO`; a `{kind:'session'}` `TodayRow` variant grouping a session's movements (full-pass `sessionId` map, insertion-ordered) under a header (`SESSION_TYPE_LABELS` + movement count); `page.tsx` renders it via a shared movement renderer. **No feel, no supersets, no write change.** | Sessions logged in 8-2 read as grouped blocks.                 | ~250  |
| **V1-8-3b** (sketch, §7) | **Supersets + feel.** The superset **write branch** (create `supersets` rows + stamp members) + schema fields + validation (≥2 members, membership, distinct order) + the **"group as superset"** UI + read **sub-bracketing**; **and the session `feel`** input/thread/header display (rides 3b, which reopens the form + header).                                                         | The "+ light superset" clause + PPL-pairing UX + session feel. | ~380  |

**Why 3a first / pure:** superset bracketing is a _refinement of_ the session block, so shipping the flat
block first gives 3b a structure to extend; cutting feel (a write-path feature) out of a read slice keeps
3a single-concern and ~250 lines. 3a is independently valuable (sessions stop reading as loose rows).

---

## 2. Acceptance (V1-8-3a, concrete/testable)

- A session logged via `logStrengthSession` (8-2) renders on Today as **one block**: a header
  (`SESSION_TYPE_LABELS[type]` + "· N movements") with its N movements nested (each with its sets), **in
  insertion order** (Squat, Bench, Row), not N loose rows. A **1-movement** session is still a block
  (always-a-block — no N=1 special case; panel).
- Grouping is a **full-pass `sessionId` map** (the `calisthenicsTotals` `byMetric` idiom): a session's
  members are gathered even when **non-contiguous** (a replay-appended member has a later `created_at`);
  members are then sorted by **`publicId` asc == insertion order** (uuidv7 is monotonic per-process, and
  the writer mints public_ids in insertion order — verified). The block is emitted at the session's
  **first-encountered** member in the desc(createdAt),asc(id) list, preserving the rest of the day's order.
- A **mixed day** (session + bodyweight + check-ins + calisthenics) renders the session as a block and
  everything else exactly as today; **calisthenics grouping is intact** (calisthenics entries have no
  `session_id` — the two `todayRows` branches are disjoint); **legacy flat strength** (no `session_id`)
  still renders as individual rows.
- A **soft-deleted session's live members still render** (as flat rows) — the `deleted_at IS NULL` guard is
  in the JOIN **ON**, so they are never dropped.
- `EntryDTO` gains `sessionId` (public_id, nullable) + `sessionType` (nullable) — additive/nullable, the
  V1-4/5/6a pattern. **No `sessionFeel`, no `supersetId`/`supersetOrder`** (their readers are in 3b — no
  dead DTO fields).
- Tri-viewport screenshots (390/820/1280) of a grouped session + a mixed day (reuse the 8-2
  `strength-session` fixture — it now renders grouped).
- No regression: every existing `db:verify`/web test passes.

---

## 3. Design decisions (V1-8-3a)

**D1 — `listEntriesForDay`: LEFT JOIN `sessions`, add 2 nullable DTO fields.** Add
`leftJoin(sessions, and(eq(entries.sessionId, sessions.id), isNull(sessions.deletedAt)))` — same PK-join
idiom as the `metric_definitions`/`activity_types` joins (≤1 match, no fan-out). The `deleted_at IS NULL`
**must be in the ON, not WHERE**: in WHERE it would drop the _live member entries of a soft-deleted
session_ (matched row, `deleted_at` NOT NULL → whole entry vanishes = data loss); in the ON a deleted
session just fails to match → `sessionId` NULL → members render flat (panel: confirmed, materially
matters). Select `sessionId: sessions.publicId` (public_id — **never** the internal id, the anti-IDOR rule
at `entries.ts:69`) + `sessionType: sessions.sessionType`. Add both to `EntryDTO` typed `string | null`
(the header tolerates a NULL type with a fallback label — panel #9).

**D2 — Grouping in `todayRows` (pure, additive, MAP-based).** New variant `{ kind: 'session'; session:
{ id: string; type: string | null }; movements: EntryDTO[] }`. Build a **full-pass `Map<sessionId,
EntryDTO[]>`** over the day's rows (mirroring `calisthenicsTotals`' `byMetric` at `activity-totals.ts:35`)
— NOT a contiguous-run collector (a replay-appended member is non-contiguous; a run collector would split
one session into two blocks — panel N1). Emit each session's row once, at its **first-encountered** member
(a fresh `emittedSessions` Set — a _separate_ Set from the calisthenics `emitted`, no key-namespace mixing
— panel NIT). `movements` = the session's entries sorted **`publicId` asc** (necessary to re-order a
replay-appended member back into insertion order). Entries without a `sessionId` render as today.
`calisthenicsTotals` is untouched.

**D3 — `page.tsx` renders the block via a SHARED movement renderer.** Extract the existing single-entry
movement rendering (`page.tsx:176-193` — `entryLabel(entry)` + a `<ul>` of sets with the
`{s.reps ?? '?'} × {s.weightLabel ?? …}` fallback) into a small presentational helper (e.g.
`<MovementLine entry={…} />`) and call it from BOTH the `{kind:'entry'}` arm **and** each session movement
(panel: reuse, don't copy-paste the fallback expression; route the name through `entryLabel`, not a second
`movementName` path). The session block is a `<li>` (a bordered block) with an `<h3>`-scoped header
(`SESSION_TYPE_LABELS[type] ?? 'Strength'` + "· N movements") and a nested `<ul>` of `<MovementLine>`s.
≥44px, adaptive at 360px (block stacks).

**D4 — `SESSION_TYPE_LABELS` (the single-source label — panel BLOCKING).** Add
`SESSION_TYPE_LABELS: Record<SessionType, string>` to `packages/shared/src/sessions.ts`, mirroring
`ACTIVITY_CATEGORY_LABELS` (`activity-categories.ts`) and `UNIT_LABELS` (`units.ts`). The header renders
via this map — **never** a hardcoded `"Strength"` or an inline `.toUpperCase()` of the raw enum (the
re-typed-literal defect the constants rule forbids). Cannot reuse `ACTIVITY_CATEGORY_LABELS` (it lacks
`push`/`pull`/`legs`/`core`). `EntryDTO.sessionType` keeps the raw enum (dispatch-on-discriminant); the
label lookup happens only at render.

**Deferred to V1-8-3b (§7):** the `supersets` write branch + schema fields + validation, the "group as
superset" UI, the read sub-bracketing, the `supersetId`/`supersetOrder` DTO fields — **and the session
`feel`** input/thread/header display (panel: a write-path feature; rides 3b which reopens form + header).

---

## 4. File-by-file (V1-8-3a)

| Path                                                  | Change | What & why                                                                                                                                                                                                           |
| ----------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/lib/dal/entries.ts`                         | EDIT   | LEFT JOIN `sessions` (deleted_at in ON); add `sessionId`(public_id)/`sessionType` to the select + `EntryDTO` (D1).                                                                                                   |
| `apps/web/lib/entries/activity-totals.ts`             | EDIT   | `{kind:'session'}` `TodayRow` variant + the full-pass map grouping in `todayRows` (D2); separate `emittedSessions` Set.                                                                                              |
| `apps/web/app/p/[profileId]/page.tsx`                 | EDIT   | Extract `<MovementLine>`; render the session block; the `{kind:'entry'}` arm reuses `<MovementLine>` (D3).                                                                                                           |
| `packages/shared/src/sessions.ts`                     | EDIT   | Add `SESSION_TYPE_LABELS: Record<SessionType,string>` (D4). Auto-exported via the barrel `export * from './sessions'`.                                                                                               |
| `apps/web/lib/entries/activity-totals.test.ts`        | EDIT   | Grouping unit: collapse position; insertion order incl. a **non-contiguous replay-appended member**; mixed day (calisthenics intact); legacy flat strength stays flat; a soft-deleted session's members render flat. |
| `docs/plan.md`, `docs/status.md`                      | EDIT   | V1-8-2 → merged (#54); V1-8-3 → split 3a/3b; status rides with the work.                                                                                                                                             |
| `docs/plans/v1-8-3-session-grouping-and-supersets.md` | NEW    | This plan.                                                                                                                                                                                                           |

**Not touched (no write change in 3a):** `strength-session.ts` (shared + writer), `logStrengthSession`,
`logStrengthSessionAction`, `strength-form.tsx`, `verify.ts`, `actions.test.ts` — **no migration**.

---

## 5. Test plan (V1-8-3a)

- **Grouping unit** (`activity-totals.test.ts`, pure over `EntryDTO[]`): a 3-movement session → one
  `{kind:'session'}` row; movements in insertion order; a **replay-appended member with a later
  created_at** still yields ONE block with the member re-ordered by publicId; a mixed day keeps non-session
  rows flat + `calisthenicsTotals` intact; legacy flat strength (no sessionId) renders individually; a
  soft-deleted session (sessionId NULL on its members) renders them flat, not dropped.
- **`db:verify`**: unchanged (no write change) — every existing assertion still green.
- **e2e** green; **tri-viewport screenshots** (390/820/1280) of a grouped session + a mixed day via the
  existing `strength-session` fixture.
- **Code review** — the standing workflow-backed round + the code-reuse/DRY lens; iterate to no
  critical/blocking.

---

## 6. Reuse obligations

- The `sessions` LEFT JOIN reuses the `metric_definitions`/`activity_types` PK-join idiom; the grouping
  reuses the `byMetric` full-pass map + `emitted`-Set collapse idiom (a **second** Set, not the same one).
- `<MovementLine>` is extracted and reused by both the `{kind:'entry'}` arm and session movements (the
  `entryLabel` + set-fallback logic lives once). Not over-abstraction — 2 call sites, load-bearing fallback.
- `SESSION_TYPE_LABELS` beside the enum in `packages/shared` (the enum-is-reference-table rule); the header
  never re-types a label.
- `EntryDTO` additions are additive/nullable (the V1-4/5/6a pattern) — no new DTO type. `sessionId` is a
  public_id (anti-IDOR), never the internal id.
- Do **not** extract a generic `collapse(entries, keyFn, buildRow)` — the two groupings key/shape
  differently and calisthenics has the extra "skip if filtered" wrinkle; keep them parallel (panel).

---

## 7. V1-8-3b sketch (supersets + feel — next slice)

- **Schema** (`strength-session.ts`): each movement gains `supersetClientId?: uuid` + `supersetOrder?: int`;
  add `supersets?: [{ clientId: uuid, label?: string }]` + a `feel?` field. `superRefine`: distinct
  superset clientIds; every `movement.supersetClientId` ∈ `supersets`; `supersetClientId` ⟺ `supersetOrder`;
  distinct `supersetOrder` within a superset; **≥2 members per superset** (the ADR-0003 writer invariant,
  at the boundary). `feel` normalizes **blank → undefined** in the schema (`.transform(v => v || undefined)`)
  so a left-blank input stores NULL, not `''` (panel correctness #3).
- **Writer**: add `insertSupersetRow(exec, …)` (the `insertStrengthSessionRow` twin); `writeStrengthSession`
  creates `supersets` rows (clientId→id map) then passes `supersetId`/`supersetOrder` into the existing
  `writeSessionStrengthEntry` (already accepts them — no fork); thread `feel?` → `insertStrengthSessionRow`
  → `sessions.feel` (feel is **write-once** at creation — not updated on replay; LWW edits are v1.5). Also
  add `feel` to `LogStrengthSessionArgs` + the DAL hand-off (panel #8 — list the type explicitly).
- **UI**: "Group as superset" selects 2+ movement cards into a labeled superset (default "A + B"); card
  order → `supersetOrder`. A top-level `<input name="feel">` (a discrete named field in `StrengthFormBody`,
  reusing `inputClass` + the key-remount reset — NOT in the movements JSON; panel architecture #6).
- **Read**: add `supersetId`(public_id)/`supersetOrder` + `sessionFeel` to `EntryDTO`; **refactor** the 3a
  `{kind:'session'}` variant's `movements: EntryDTO[]` into a **two-level discriminated list**
  (`Array<{kind:'movement';entry} | {kind:'superset';members:EntryDTO[]}>`) inside the pure
  `activity-totals.ts` module (contained to that module + its render arm + its test — NOT purely additive,
  stated honestly per panel architecture #1); sub-bracket superset members (ordered by `supersetOrder`);
  show feel in the header.
- **`db:verify`**: a session with a 2- and a 3-movement superset round-trips via the shared core (the
  V1-8-1 raw-SQL superset proof, now exercised through the real writer) + `feel` persists.

## 8. Risks / rollback (3a) + recorded gaps

- **R1 — grouping splits a session into two blocks** (replay-appended non-contiguous member). Mitigated by
  the full-pass map (D2) + the non-contiguous-member unit test.
- **R2 — LEFT JOIN drops a soft-deleted session's members.** Mitigated by `deleted_at IS NULL` in the ON
  (D1) + a test.
- **No migration / no write path** → fix-forward only.
- **Recorded gaps (not 3a scope):** (a) soft-deleting a session does **not** cascade to its member entries
  (they fall to flat rows) — the cascade is a V1-9/edit-delete concern; (b) `EntryDTO` is accreting nullable
  per-kind fields (V1-4/5/6a + this + 3b) — a future per-kind discriminated-DTO refactor is the eventual
  cleanup, recorded as a trend, not an accident (panel architecture #4).

## 9. Open questions — resolved by the panel

- **Q1 — 2-way split (3a then 3b)?** YES (all four lenses). §1.
- **Q2 — header content?** `SESSION_TYPE_LABELS[type]` + movement count (feel deferred). §D3/D4.
- **Q3 — 1-movement session display?** **Always a block** (one code path, no N=1 fallback). §2.
- **Q4 — feel in 3a?** **No — deferred to 3b** (write-path surface; 3b reopens form + header). §3/§7.

## 10. Review-response log (adversarial panel)

Four lenses: Correctness/data-integrity · Simplicity/scope · Architecture/consistency · Code-reuse/DRY.
Net: **`feel` cut to 3b** (3a becomes a pure read slice), a **`SESSION_TYPE_LABELS` single-source** added,
the grouping pinned to a **full-pass map** (replay-appended members), a **shared `<MovementLine>`** factored,
**always-a-block** chosen, and the 3b forward-compat stated honestly. No blocking defect survives.

| #   | Lens(es)                             | Critique                                                                                                                                                                                                                                                                                                                                                   | Resolution                                                                                                                                                                                                                                                                                                                                                                                                       |
| --- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | simplicity (strongest) + correctness | `feel` is write-path surface (schema + writer + DAL + action + form + header) bolted onto a read-model slice — the 8-2 panel cut it once; re-adding it bloats 3a toward 400. Correctness also found a real `feel` bug (blank input → `''` not NULL).                                                                                                       | **Cut `feel` to 3b.** 3a becomes a pure read-grouping slice (~250 lines); feel rides 3b, which reopens the form + header anyway, and 3b's schema normalizes blank→undefined so a left-blank feel stores NULL (correctness #3 fixed there).                                                                                                                                                                       |
| B1  | code-reuse (BLOCKING) + architecture | The header must show `"Strength"` but `SESSION_TYPES` is lowercase and there is **no** label map — an implementer would hardcode/`.toUpperCase()` at the render site (the re-typed-literal defect).                                                                                                                                                        | **Add `SESSION_TYPE_LABELS: Record<SessionType,string>` to `packages/shared/src/sessions.ts`** (mirroring `ACTIVITY_CATEGORY_LABELS`/`UNIT_LABELS`); render via the map. Can't reuse the activity map (missing push/pull/legs/core). Raw enum stays on the DTO.                                                                                                                                                  |
| N1  | correctness                          | The `publicId==id==insertion` equivalence is sound, BUT a **replay-appended** member has a later `created_at` → is **non-contiguous** in the desc,asc order; a contiguity collector would split one session into two blocks, and the `publicId` sort is then _necessary_ (not redundant). "Emitted at newest entry" is misleading for a single-tx session. | **Incorporated.** Grouping is a **full-pass `sessionId` map** (the `byMetric` idiom); members sorted `publicId` asc; block emitted at first-encountered member. Wording corrected. A **non-contiguous replay-appended-member** unit test added.                                                                                                                                                                  |
| N2  | code-reuse + architecture            | The session block would **copy-paste** the single-entry set-list render (the non-trivial `weightLabel`/unit fallback), and read `movementName` directly instead of `entryLabel`.                                                                                                                                                                           | **Incorporated.** Extract `<MovementLine entry>` (2 call sites, load-bearing fallback — warranted, not over-abstraction); both the `{kind:'entry'}` arm and session movements use it; names via `entryLabel`.                                                                                                                                                                                                    |
| N3  | simplicity + correctness             | A 1-movement session block vs a legacy flat row is a read-consistency wrinkle; an N=1 fallback adds a second render path.                                                                                                                                                                                                                                  | **Resolved: always a block** (Q3) — one code path, no arity branch; the session affordance is preserved for N=1.                                                                                                                                                                                                                                                                                                 |
| N4  | correctness                          | The `deleted_at IS NULL` guard MUST be in the JOIN **ON** — in WHERE it would drop the live members of a soft-deleted session (data loss), not just hide the session.                                                                                                                                                                                      | **Confirmed + pinned.** ON placement (D1) + a unit test asserting a soft-deleted session's members still render (flat).                                                                                                                                                                                                                                                                                          |
| N5  | architecture                         | The plan can't claim BOTH "no dead fields in 3a" AND "3b purely additive" for the `TodayRow` session variant — 3b's sub-bracketing needs a two-level `movements`, a shape change. And grouping must stay in the pure module, not leak to `page.tsx`.                                                                                                       | **Stated honestly (§7):** 3b **refactors** `movements` into a two-level discriminated list **inside `activity-totals.ts`** (contained: one pure module + render arm + test). The `EntryDTO` extension (`supersetId`/`supersetOrder`) _is_ additive.                                                                                                                                                              |
| N6  | correctness + architecture (nits)    | `sessionType` typed non-null (it's schema-nullable); redundant per-row session data; feel replay-no-op unacknowledged; DTO accretion; soft-delete cascade gap.                                                                                                                                                                                             | **Incorporated/recorded.** `sessionType: string \| null` (header fallback); per-row session data is consistent with the LEFT-JOIN idiom (N≤12, single-household) + read from the first collected member; feel write-once + the DTO-accretion trend + the soft-delete-cascade gap recorded in §8.                                                                                                                 |
| —   | all (confirmations)                  | —                                                                                                                                                                                                                                                                                                                                                          | **Confirmed:** no superset writer exists until 3b (flat grouping correct by construction); calisthenics untouched + the two `todayRows` branches disjoint (session members `activityKey='sc_lift'`+`sessionId≠null`; calisthenics `activityKey='calisthenics'`+`sessionId=null`); the public-id anti-IDOR rule; the additive-nullable DTO pattern; keep the two groupings parallel (no generic collapse helper). |
