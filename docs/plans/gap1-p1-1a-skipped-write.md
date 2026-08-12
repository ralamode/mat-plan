# GAP-1 P1-1a — a movement can be logged as SKIPPED (write path only)

> Backlog: [plan.md](../plan.md) row **GAP-1** · analysis: [csv-recording-gaps.md](../csv-recording-gaps.md) §P1-1.
> Branch: `feat/gap1-p11a-skipped-write`, off `main` (**#99**, P2 CSV-unsafe input, is merged).
> **PR 2 of a 4-PR split of P1-1**: #99 = input rejection · **this = skipped write path** · PR 3 =
> [`entry_sets.status='sub_failure'`](./gap1-p1-1b-subfailure-write.md) · PR 4 = the UI.
> **No migration. No UI. No read-path change.**
> Supersedes Part B of [gap1-p2-sanitise-p11-skip.md](./gap1-p2-sanitise-p11-skip.md), which was
> **never implemented** — it is committed as the historical record the panel reviewed.

## Goal

Make `entries.status = 'skipped'` **writable** — a movement logged as skipped, carrying **zero**
`entry_sets` rows. Today `sessionMovementSchema.sets` is `.min(1)`, so `sets: []` is unrepresentable and a
skipped movement is simply absent from the log, losing the signal Ray's notes call `drop-if-yellow`. The
CSV records it as the `0,0,SKIPPED` triple ([csv-export-contract.md:74,99](../csv-export-contract.md)).

Splitting the write path from the UI is deliberate: **the read path already renders this** (verified
below), so this PR is provable by `db:verify` + unit tests with no screenshots, and the UI PR inherits a
working store.

## Acceptance

- `logStrengthSessionSchema` accepts `status: 'skipped'` + `sets: []`, and **rejects** a non-skipped
  movement with `sets: []` — issue at `['movements', i]`, message `Add at least one set.`
- The rendered form error is **byte-identical** to today: the action maps any issue with
  `path[0]==='movements'` + numeric `path[1]` to `` `Movement ${i+1}: ${message}` ``
  ([actions.ts:303-306](../../apps/web/app/p/[profileId]/actions.ts)). Today's path is
  `['movements', i, 'sets']`, the new one `['movements', i]` — `path[1]` is `i` either way.
- `writeStrengthSession` persists `entries.status='skipped'` with `COUNT(entry_sets) = 0`, while a sibling
  `done` movement in the same session keeps its sets. Proven in `db:verify`.
- A movement `status` of `sub_failure` is **rejected** by zod (it is a set-level status; PR 3).
- `sessions.status` is **unwritten** — still the column default `'done'` for a session containing a skip.
- The `done` path is byte-identical: `status` omitted → `.default('done')` → the writer omits the column →
  the DB default. No existing test changes, only additions.

## Decisions

**D1 — `entries.status ∈ {done, skipped}`; `entry_sets.status ∈ {done, sub_failure}` (PR 3).** The
criterion: **a status belongs on the entry only if it can be true when there are zero sets.** `skipped`
can; `sub_failure` cannot — it is an observation about an attempt, and an attempt is a set row. Settles
Open Q3 of the superseded plan.

**D2 — Constrain at the zod boundary, NOT the DB CHECK.** All three CHECKs (`entries_status_check`,
`entry_sets_status_check`, `sessions_status_check` — [schema.ts:162,204,333](../../packages/db/src/schema.ts))
already allow all three values. Widening a CHECK is cheap; narrowing one is a migration, and keeping this
PR migration-free is worth more than a redundant guard. The subsets live in `packages/shared/src/enums.ts`
beside `ENTRY_STATUSES`, **built from `ENTRY_STATUS` members** — `[ENTRY_STATUS.done, ENTRY_STATUS.skipped] as const`
— so a rename/removal is a compile error, not silent drift. Corollary: **do not** add an
`assertCheckCoversConst` (verify.ts:716) for them — the CHECK is deliberately the wider net.

**D3 — `sessions.status` stays unwritten.** `insertStrengthSessionRow` omits it → column default
([writers/strength-session.ts:71](../../packages/db/src/writers/strength-session.ts)). A session is not
skipped because one movement was; writing it there gives the export a **third** source of truth for "did
this happen" (session · entry · set) with no reconciliation rule. Stated so the next agent doesn't add it.

**D4 — Zero `entry_sets` is the representation; a placeholder skipped set is not.** Provenance (a set row
asserts an attempt occurred, and none did); the export's `sets = COUNT(entry_sets)` yields 0 with no
special case; and it is unstorable anyway — `numericSetSchema.reps` is `.positive()`
([strength.ts:16-20](../../packages/shared/src/strength.ts)), so `reps = 0` cannot exist. **The
`0,0,SKIPPED` triple is a STATUS-DRIVEN RENDER at export time, never read from storage** — `parseLoad`
already rejects the literal `SKIPPED` as a load ([strength.ts:118-120](../../packages/shared/src/strength.ts)).

**D5 — The `sets` relaxation goes in the EXISTING top-level `.superRefine`, never on
`sessionMovementSchema`.** Adding `.superRefine` to that `ZodObject` makes it `ZodEffects`, killing
`.extend`/`.shape` — [strength.ts:5-13](../../packages/shared/src/strength.ts) documents that exact trap
costing a whole parallel schema. So: drop `.min(1)` from `sessionMovementSchema.sets` (keep `.max(20)`) and
fold the pair of per-movement checks into the superRefine's **existing** loop (3)
(`for (const [i, m] of val.movements.entries())`, line 119) — it already iterates `movements` four times;
a fifth pass over ≤12 elements is noise.

```
!skipped && sets.length === 0 → ['movements', i] 'Add at least one set.'   // verbatim today's message
 skipped && sets.length  >  0 → ['movements', i] 'A skipped movement can’t have sets.'
```

The converse is not decoration: without it a crafted body stores `skipped` **with** sets, which the export
can render as neither shape.

**D6 — `status` defaults on the wire; the `null` trap does not apply.** `movements` rides as a JSON string
the action `JSON.parse`s ([actions.ts:272-275](../../apps/web/app/p/[profileId]/actions.ts)), so an absent
key is `undefined` and `.default()` fires — unlike the `FormData.get → null` trap that made `sessionType`
unreachable (panel B3 of v1-8-2), which applies only to discrete form fields.

**Rejected.** (a) **A discriminated union on `status`** — doubles shape maintenance, forces `status` onto
the wire for every movement, interacts badly with `.default('done')`. (b) **`sets` `.optional()`** — adds
an `undefined` case to the writer and every future reader for no gain; `[]` already means "no sets".

## No read-path change (verified)

- [page.tsx:334-336](../../apps/web/app/p/[profileId]/page.tsx) — `MovementLine` renders `entry.status`
  whenever `!== ENTRY_STATUS.done`; **:338** already guards the set list with `entry.sets.length > 0`.
- [entries.ts:207](../../apps/web/lib/dal/entries.ts) — `setsByEntry.get(r.id) ?? []` returns `[]` for a
  set-less entry; `EntryDTO.status` is already `EntryStatus` (:51, selected at :102).
- [weekly-adherence.ts:56](../../packages/db/src/queries/weekly-adherence.ts) already filters
  `eq(entries.status, ENTRY_STATUS.done)` → a skipped movement drops out of adherence for free.

A skipped movement therefore renders today as the label + `skipped` and no set list. **That is why the UI
is a separate PR.**

## File-by-file changes

| Path                                                         | Change   | What & why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared/src/enums.ts`                               | EDIT     | Add `MOVEMENT_STATUSES` + `movementStatusSchema`, built from `ENTRY_STATUS` members (D2). `SET_STATUSES` is PR 3's — don't add it speculatively.                                                                                                                                                                                                                                                                                                                                                                |
| `packages/shared/src/strength-session.ts`                    | EDIT     | `sessionMovementSchema`: add `status: movementStatusSchema.default(ENTRY_STATUS.done)`; drop `.min(1)` from `sets`. Fold the two checks into the superRefine's loop (3) (D5).                                                                                                                                                                                                                                                                                                                                   |
| `packages/db/src/writers/strength-session.ts`                | EDIT     | `ResolvedSessionMovement` gains `status?: EntryStatus`; `writeSessionStrengthEntry` args gain `status?: string`, and its `.values()` gains `...(args.status !== undefined ? { status: args.status } : {})` — a **spread** (mirroring the `'weightLabel' in s` idiom two lines below) so the `done` path still omits the column and takes the DB default. `writeStrengthSession` threads `status: m.status`. **The zero-set guard already exists** (`if (args.sets.length > 0)`, :190) — no other writer change. |
| `apps/web/lib/dal/entries.ts`                                | **NONE** | `logStrengthSession` spreads `...m` (:406-409) and `LogStrengthSessionArgs.movements` is `readonly SessionMovementInput[]`, so `status` rides through once the shared type gains it. The hardcoded `ENTRY_STATUS.done` at **:261/:363** belongs to the **bodyweight** and **check-in** writers — out of scope.                                                                                                                                                                                                  |
| `apps/web/app/p/[profileId]/actions.ts`                      | **NONE** | The action forwards `parsed.data.movements` wholesale (:330). Pinned by a test instead — see R2.                                                                                                                                                                                                                                                                                                                                                                                                                |
| `apps/web/app/p/[profileId]/strength-session-schema.test.ts` | EDIT     | New `describe` block. Tests live in `apps/web` because vitest's root is `apps/web` — a test under `packages/` is never collected (the file's own header says so).                                                                                                                                                                                                                                                                                                                                               |
| `apps/web/app/p/[profileId]/actions.test.ts`                 | EDIT     | One pass-through boundary test (R2).                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `packages/db/scripts/verify.ts`                              | EDIT     | New block after the P0-1 `day_role` block (~:1934), through the **shipped** writer. Also retune **:1346** — `'each session entry expands to an entry_set'` reads as a universal this PR falsifies; it is fixture-scoped over three `insertSessionEntry` rows (that helper always inserts one set, :1229) so it still passes — reword to name its fixtures.                                                                                                                                                      |
| `docs/plan.md` · `docs/status.md`                            | EDIT     | GAP-1 row progress + the 4-PR split; link this plan.                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

**Not touched:** any migration (`0000`–`0009`), all three `*_status_check` CHECKs, `entry_sets.status`
(PR 3), `sessions.status` (D3), every form/component, `set-display.ts`, `activity-totals.ts`.

## Test plan

**Unit — `strength-session-schema.test.ts`** (`pnpm --filter web test`): (1) `skipped` + `sets: []`
parses, output `status === 'skipped'`; (2) `status` omitted → output `'done'` (D6); (3) `status` omitted +
`sets: []` rejects, asserting **both** the path `['movements', 0]` **and** the message `Add at least one set.`
(the path is what keeps the rendered string identical); (4) `skipped` + one set rejects (the converse);
(5) `status: 'sub_failure'` on a movement rejects (D1 pinned); (6) an ordinary 1-set `done` movement still
parses unchanged.

**Action boundary — `actions.test.ts`:** a `movements` JSON carrying `{status:'skipped', sets:[]}` →
`logStrengthSession` is called with a movement whose `status === 'skipped'`. Exists specifically to catch R2.

**`db:verify` (PGlite):** one session via `writeStrengthSession` with two movements — one `skipped` +
`sets: []`, one `done` with 2 sets. Assert the skipped entry's `status`; `COUNT(entry_sets) = 0` for it;
the done sibling keeps its 2 sets, 1-based; the parent `sessions.status === 'done'` (D3); an identical
replay still yields one entry and zero sets. Written against `ENTRY_STATUS.*`, never a bare string.

**Regression:** full unit suite + typecheck. `e2e` untouched (no UI).

## Risks / rollback

- **R1 — the `≥1 set` guard moves from the field schema to the parent refine.** A consumer using
  `sessionMovementSchema` alone would lose it. Grep: exactly **one** consumer, the `movements` array in the
  same file (:65). Re-run that grep at review; a second consumer means the guard moves with it.
- **R2 — a boundary that parses a field but never forwards it.** Not hypothetical: drafting this plan
  surfaced that #98 added `dayRole` to the schema and to the action's parse object but **never passed it
  to `logStrengthSession`**, so `sessions.day_role` was never written from the app. Three gates missed it
  — the DAL arg is optional (`tsc` clean), `db:verify` drives the writer directly (bypassing the action),
  and the happy-path assertion used `expect.objectContaining`, which is **blind to an absent key**.
  **Fixed in #101**; recorded in [lessons.md](../lessons.md) → _Vitest / RTL_.
  `status` rides through only because the DAL spreads `...m` — exactly the same shape of assumption — so
  the action-boundary test above is mandatory, and must assert the **value** (`toMatchObject`), never a
  partial `objectContaining` shape that cannot see the field going missing.
- **R3 — BUG-2(a)** (a numeric `sub_failure` set stays `isEditableSet`) is **not reachable** here —
  `entry_sets.status` is untouched. It becomes reachable in PR 3 and must be fixed there.
- **Rollback:** revert; no migration, nothing to unwind. A `skipped` entry written pre-revert still reads
  correctly — the read path predates this PR and is status-agnostic.

## Deferred to the UI PR (hard prerequisite)

`isUntouchedMovement` ([strength-form-supersets.ts:64-69](../../apps/web/app/p/[profileId]/strength-form-supersets.ts))
is `m.movementName.trim() === '' && m.sets.every(...)`, and **`[].every(...)` is vacuously true**. A
skipped movement carries zero sets, so a skipped card with a blank name is silently discarded by
`dropUntouchedMovements` ([strength-form.tsx:155](../../apps/web/app/p/[profileId]/strength-form.tsx)) with
**no** validation message — contradicting that helper's own documented contract ("a card with ANY field
typed is a partial entry, NOT untouched"). Filed as **BUG-2(b)** in [plan.md](../plan.md). Not reachable
here (no UI writes `status`), but it **must be fixed in the same PR that adds the skip toggle**, or the
affordance is a data-loss bug on first use.

## Out of scope

`entry_sets.status='sub_failure'` + BUG-2(a) (**PR 3**) · the skip toggle / sub-failure marker + BUG-2(b)
(**PR 4**) · `sessions.status` (D3) · the `0,0,SKIPPED` render (V1-13) · editing or un-skipping a logged
movement (V1-9b) · `prescribed` (P1-2) · bodyweight `context` (P1-3) · #98's unforwarded `dayRole` (R2).

## Open questions

None — the panel settled D1–D6 before this draft.

## Review-response log (adversarial panel)

The panel reviewed the combined [gap1-p2-sanitise-p11-skip.md](./gap1-p2-sanitise-p11-skip.md); this plan
reconciles its Part B.

| #   | Lens                    | Critique → resolution                                                                                                                                                                                                                                                                              |
| --- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | scope (BLOCKING)        | Sanitisation + two statuses + two UI affordances is four concerns, well past <400 lines (its own Open Q5 asked this). → **Accepted: split into 4 PRs.** #99 shipped A; this is the write path only, provable without screenshots because the read path already works.                              |
| B2  | architecture (BLOCKING) | "Both statuses on both tables" was never justified — Open Q3 asked set-vs-entry and the plan shipped both. → **Accepted: D1.** One criterion decides it.                                                                                                                                           |
| B3  | correctness (BLOCKING)  | A `.superRefine` on `sessionMovementSchema` makes it `ZodEffects`, killing `.extend`/`.shape` — the trap `strength.ts:5-13` documents. → **Accepted: D5**, plus verification that the action's error mapping keeps the rendered message byte-identical.                                            |
| B4  | data integrity          | A placeholder `status='skipped'` set would keep `.min(1)` intact and look tidier. → **Rejected: D4** (provenance, `COUNT(entry_sets)`, and `reps.positive()` making it unstorable).                                                                                                                |
| B5  | DB safety               | Narrow the CHECKs to the new per-table vocabularies? → **Rejected: D2.** Narrowing is a migration; widening is cheap. Constrained at zod, derived from `ENTRY_STATUS`. Explicitly no `assertCheckCoversConst`.                                                                                     |
| B6  | correctness             | Nothing said what happens to `sessions.status`. → **Accepted: D3**, with the "third source of truth" rationale.                                                                                                                                                                                    |
| B7  | simplicity / DRY        | Discriminated union, or `sets.optional()`, as alternative shapes. → **Rejected**, both (see "Rejected" above).                                                                                                                                                                                     |
| N1  | reuse (author)          | The superseded plan's file table named files needing no change and missed ones that do. → **Accepted:** every row above checked against code; the two `NONE` rows are asserted with line numbers, and the writer's pre-existing zero-set guard means it needs only `status` threading.             |
| N2  | correctness (author)    | Verifying "the DAL spreads `...m`, so it just works" surfaced that #98 parses `dayRole` and never forwards it — a shipped-but-inert feature with three green gates. → **Recorded as R2**; fixed in **#101**, and an action-boundary test here makes the same class of bug impossible for `status`. |
