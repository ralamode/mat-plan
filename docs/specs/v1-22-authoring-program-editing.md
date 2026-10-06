# V1-22 — Authoring: the program gets a write path

> Model: [ADR 0005](../decisions/0005-programming-model.md). Plan this executes:
> [v1-22-program-editor](../plans/v1-22-program-editor.md) scope A. Milestone:
> [beta-1](../milestones/beta-1.md) §3b. Procedure: [`write-spec`](../../.claude/skills/write-spec/SKILL.md).

A prescribed load can only be changed by editing TypeScript and deploying. Six PRs have to agree on
what replaces that, in what order, and on one data contract — hence a spec rather than six plans.

**Honest about today's pain.** The live Youth Daily Program deliberately prescribes nothing on **11 of
its 13** prescriptions (`open()` → `sets: null, targetReps: null, load: null`), and its own `notes`
reads _"No prescribed reps or loads — log what you actually did."_ Only `single-leg_hip_thrusts`
(`strength_a#6`, `strength_b#5`) is `fixed()` — `3 × '10 per side'`, still no load. So the editing pain
is real for the archived S&C block and arrives for good with ONB-2's default program; it is not pain
felt on `main` today. That is why chunk 6 is cuttable and why chunk 1's closing window, not user pain,
sets the order.

## Decisions already made

Each is settled; a later session reopening one should read the source, not re-derive it.

| Decision                                                                                                        | Settled in                                            |
| --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Workouts become data; items reuse `ACTIVITY_INPUT_SHAPE`; rotation stays calendar-indexed                       | ADR 0005 decisions 1–3, 7                             |
| The prescription is snapshotted as a **rendered string** on the logged record, not an FK                        | ADR 0005 decision 5                                   |
| Authoring is **profile-scoped** at `/p/<id>/program`; the household library waits for TEN-1                     | 2026-10-05, below under Out of scope                  |
| Reorder = row lock + submitted-set assertion + positive offset band                                             | V1-22 **W1**                                          |
| No audit trail on prescriptions                                                                                 | V1-22 open Q4                                         |
| The editor is open to athletes under the shared gate; **AUTH-1 adds a role check rather than moving the route** | ADR 0005 deferral, re-recorded here                   |
| Program and routine axes **co-exist permanently** — neither replaces the other                                  | [features/programming.md](../features/programming.md) |
| A value edit is **last-write-wins on the server clock**                                                         | Below, chunk 4                                        |
| Blank `sets` means an **open** movement and is the dominant authored shape                                      | `prescriptions_sets_check`, `open()`                  |

## Acceptance

Each is written so a test can fail it. Acceptance 13 is the exception and says so.

**Editing**

1. **When** a coach submits a changed `sets`, `target_reps` or per-athlete load, the system **shall**
   persist it, and a subsequent read of the editor and of the athlete's Today **shall** return the new
   value.
2. **If** a submitted `sets` is `0`, negative, non-integer, or above `MAX_SETS_PER_MOVEMENT`, **then**
   the system **shall** return a typed error naming the limit and write nothing — never a 500 from
   `prescriptions_sets_check` and never a Postgres `22003` int4 overflow.
3. A **blank** `sets` **shall** persist as `NULL` and round-trip as an _open_ movement. A prescription
   with `sets` NULL and `target_reps` NULL **shall** survive the editor unchanged.
4. `target_reps` **shall** round-trip verbatim up to 100 characters — `3`, `8-12`, `AMRAP`,
   `10 per side` — and a blank **shall** store `NULL`, not `''`.
5. **Where** a prescription has per-athlete targets, editing one athlete's target **shall** change that
   athlete's row only, leaving every sibling's `load` and `reps` untouched.
6. **If** a submitted target names a profile outside the block's household, or the caller does not own
   the profile in the route, or the body fails zod, **then** the system **shall** return a typed error
   and write nothing. Ownership **shall** be resolved from `profiles.public_id` inside the query, never
   from an id in the request.
7. **When** a coach clears a per-athlete load, the system **shall** `UPDATE … SET load = NULL,
reps = NULL` on the existing row and **shall not** soft-delete it.

**History is never rewritten**

8. **When** any prescription value is edited, every entry already logged **shall** export the
   `prescribed` text it exported before the edit. The test **shall** assert the pre-edit string is
   **non-empty** before asserting equality — 11 of 13 live prescriptions render `''`, so an
   equality-only test passes with no snapshot column at all.
9. **When** a strength set is logged against a prescription, the system **shall** store the rendered
   prescribed string on the entry, produced server-side by the one shared renderer — never read from the
   submitted form. For a batch replayed through `/api/sync`, the snapshot **shall** be taken at
   server-receipt time against the program as it then stands.
10. **While** an entry's `prescribed_snapshot` **is NULL**, the export **shall** fall back to the live
    `(day_role, movement)` match, including emitting **empty** on an ambiguous match. `''` and `NULL`
    **shall** be distinct stored values; the predicate is `IS NULL`, never `coalesce(…,'') = ''`.
11. For an **unedited** prescription, the snapshot path and the legacy match path **shall** produce
    **identical bytes** — the only test that catches the renderer being copied.
12. `prescribed_snapshot` **shall not** be a field of `ScaffoldRow`, of any type reachable from the log
    form, or of any progression input — enforced by the **type**, the way `ScaffoldRow` already omits
    `load`. Exactly one query selects it and exactly one writer writes it.

**Order**

13. **When** items are reordered, the system **shall** apply the new order atomically, and a submit
    whose order already matches live **shall** short-circuit before any UPDATE, leaving every `idx`
    **and** `updated_at` byte-identical. ⚠️ Atomicity itself is **not test-provable** — `db:verify`
    runs on single-connection PGlite — so the lock must be correct by construction (V1-22 W1's own
    caveat).
14. **If** the submitted order does not match the live set of live prescriptions for that
    `(block_id, day_role)` exactly, **then** the system **shall** return `AMEND_ERROR_COPY.staleWrite`,
    **revalidate first**, and write nothing.
15. **Every** writer that computes an `idx` — add as well as reorder — **shall** take the same
    `program_blocks … FOR UPDATE` and **shall** `SET LOCAL lock_timeout` inside the transaction,
    mapping a timeout to a typed `busy` error.
16. **If** an add would take a day above `MAX_SESSION_MOVEMENTS`, **then** the system **shall** return a
    typed error naming the limit and the editor **shall not** offer the control past it. Day A already
    holds 7 of the 12, and `scaffoldMovements` **silently truncates** past it.
17. **When** `db:seed` runs after a human has removed or reordered a day's items, the system **shall**
    leave that day's prescriptions **and their per-athlete targets** as the human left them — no
    re-insert of a removed row, no refill of a vacated slot.

## The data contract

```
packages/shared
  programEditSchema          — the submit shape; field schemas DERIVED from
                               prescriptionSeedRowSchema (sets: int().positive().nullable()),
                               never re-typed. One source for the seed, the action and the CHECK.
  formatPrescribedForExport  — the ONE renderer. Three callers: the log-time writer,
                               the backfill correction, the export fallback.

apps/web/lib/programming      (beside ProgramDayDTO — no DTO in this repo lives in shared)
  ProgramEditDTO
    block:       blockPublicId · dayRole                     ← both REQUIRED, see below
    prescription: publicId · movementSlug · movementName · idx
                  sets: number | null · targetReps: string | null
    targets:     Array<{ profilePublicId · athleteName
                         load: string | null · reps: string | null }>
```

Rules the contract carries:

- **`dayRole` and `blockPublicId` are not optional.** `uq_prescriptions_block_day_role_idx` is
  `(block_id, day_role, idx)`, so `idx` repeats across day roles — `strength_a#0` and `strength_b#0`
  are both `push-ups`. Without both, the UI cannot group items, cannot distinguish them, and **cannot
  build the reorder payload**, since W1's stale check is scoped to `(block_id, day_role)`.
- **The page names the block it edits.** `programDayRows` resolves the newest block **holding a live
  prescription for the requested `day_role`** (`ORDER BY program_blocks.id DESC LIMIT 1`), so day A and
  day B can resolve to _different_ blocks. The editor renders one section per day role, each labelled
  with its block, and a reorder is scoped to that section.
- **`targets` is a list, with names.** V1-22 B4's accepted UX is a matrix that must name the athletes.
  The list comes from `prescription_targets → profiles` **within the already-authorized block** — not a
  new household hop, so TEN-1 is not a prerequisite. `listProfiles()` returns every profile in the
  database and must not be used here.
- **`movementSlug` is the machine key; `movementName` is display only.** The CSV keys `prescribed` by
  slug (`csv/columns.ts`), and a name with a comma breaks that column.
- **No authored load crosses into the athlete's log form.** `ScaffoldRow` has no `load` field by
  construction; this DTO is for the _editor_, and the two must never be merged.
- **The envelope is `ActionState`** (`app/p/[profileId]/action-state.ts`) and the stale message is
  `AMEND_ERROR_COPY.staleWrite` (`lib/constants.ts`) — both already single-sourced, both already
  revalidate-first. `ActionState`'s docblock scopes it to `app/p/[profileId]/`; chunk 4 **promotes it to
  `lib/`** rather than declaring a second copy for the new segment.

## Chunks, in order

| #     | Chunk                                                                                                                                  | Why it cannot move                                                                                                                                                                                                                    |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1** | `entries.prescribed_snapshot` (nullable text) + `CHECK (… IS NULL OR movement_id IS NOT NULL)`. **Ships dark.**                        | **Closing window.** Also deploy order: new code against an un-migrated DB throws. 2 merges only after `gh run list --workflow migrate.yml` is green **on 1's SHA**, read from the log — the step `exit 0`s when the secret is absent. |
| **2** | `formatPrescribedForExport` in `shared` + the log-time writer + the export fallback.                                                   | After 1. Touches the **log form** (a prescription public id on the submit payload), so it is not backend-only and must sequence against **V1-30b**.                                                                                   |
| **3** | The backfill, as a listed `db:correct` **correction**.                                                                                 | After 2, before 4. Manual: 4 cannot merge until `--apply` is recorded in the corrections **Applied** table with a row count.                                                                                                          |
| **4** | **Edit values** at `/p/<id>/program`. Removes the pain.                                                                                | After 3. Needs no seed guard — the seed is **insert-only**, so a value `UPDATE` already survives a re-seed. May land as two PRs (DAL + DTO, then the editor UI).                                                                      |
| **5** | **A day-scoped existence guard in `seedProgram`:** skip any `(block_id, day_role)` that already has a live prescription. No migration. | **Gate for 6 only.** A soft-delete-aware arbiter does **not** catch compaction — a compacted row's `deleted_at` is NULL, so the vacated top slot looks pristine.                                                                      |
| **6** | **Add / remove / reorder.**                                                                                                            | After 5. **Cuttable** if the milestone runs long.                                                                                                                                                                                     |

**A1 (read-only view) folds into 4.** The read surface already ships — `program-reference.tsx` renders
sets × reps plus this kid's verbatim load, collapsible since V1-23 PR 3 — and V1-20's discoverability
half shipped as V1-23 PR 2. A1 would be a second read of data already on screen. Chunk 4's _size_ is
answered by splitting the PR, not by shipping a redundant screen.

**A4 (create a block) is out** — see Out of scope. Chunks 1 and 5 are backend-only; **2 touches the log
form**; 4 and 6 need the data contract agreed and the UX panel run before a UI track splits off.

**Each chunk owes a `db:verify` section** (`packages/db/scripts/verify.ts`, which already seeds twice):
chunk 1 — `expectRejectedBy('entries_prescribed_snapshot_check', …)` on a metric-arm row, plus the
`''`/NULL distinction; chunk 5 — drive a non-empty `seedProgram` fixture against an edited block and
assert a removal stays removed **and** a compacted top slot is not refilled; chunk 6 — contiguity and
set-preservation across a renumber. Chunk 4 owes the three boundary tests of acceptance 6.

**Also owed, by chunk 4:** `requireGatedPage()` on the new page (`app/pages-are-gated.test.ts` fails CI
without it), the route added to `a11y.spec.ts`'s `ROUTES`, a rate limit on the mutations, and a `§2e`
write-path view in [docs/architecture.md](../architecture.md) — whose programming diagram still labels
authoring _"TypeScript, no UI yet"_. ⚠️ `docs/features/programming.md`'s `owns:` covers
`queries/program-day.ts` and `routine/` but **not** `queries/program-blocks.ts` or
`app/p/[profileId]/program/`, and `guides:check` cannot see a **new unowned** file — so the frontmatter
must grow in the same PR or the editor ships with no guide coverage, silently.

## Out of scope

- **Creating a workout** (V1-22 A4). A new block would hijack Today for any day role it answers. Needs
  the scheduling ADR. That ADR also needs an **active-block marker** on `program_blocks`; chunk 5
  deliberately adds **no column**, so it inherits a clean table.
- **The household-level library** (`/workouts`). Decided 2026-10-05: authoring is profile-scoped at
  `/p/<id>/program` because every BOLA guarantee derives from a profile public id. Waits for TEN-1.
- **Workout versioning.** Chunk 1 delivers the guarantee versioning was proposed for.
- **The movement dimension declaration and per-dimension field labels.** Owned by
  [v1-30b](../plans/v1-30b-form-stops-inviting.md), which already settled the vocabulary as
  `QUANTITY_FIELD_WORD` = `weight` / `time` / **`length`** — `length`, because the dimension covers a
  box-jump height _and_ a broad-jump distance, matching the live `LOGGABLE_DIMENSION_NOUNS`.
- **The routine-editor offer list** and **the wrestling drills as movements.** Both left this spec as
  backlog rows: different pain, different tables, gated on nothing. See [docs/plan.md](../plan.md).
- **Time- and distance-shaped prescriptions.** Chunk 6 adds **rep-shaped items only** until GAP-3's
  target shapes land.

## Risks

Only the three nothing else records; every other mitigation is an acceptance criterion above.

| Risk                                                                                                                                                                                                                                                                   | Mitigation                                                                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A cleared load comes back from the dead.** Soft-deleting a `prescription_targets` row frees `uq_prescription_targets_prescription_profile`, and the next push to `main` re-inserts the **seeded** load — an authored number reappearing on a child's card by itself. | Acceptance 7: clearing is `UPDATE … SET load = NULL, reps = NULL`, never a soft delete. This overrides V1-22 **W4**.                                                                                                                                |
| The snapshot becomes a form default and an authored load reaches an input                                                                                                                                                                                              | Acceptance 12, enforced by the type. It sits one column from `raw_load` — which reuses that idiom (verbatim nullable text, export-only) and deliberately **not** the `raw_` name, because `raw_*` is what was performed and this is what was asked. |
| A Vercel **instant rollback** to a pre-chunk-2 build reverts the exporter to live reconstruction while snapshots exist                                                                                                                                                 | Fix-forward only. Cut a Neon RESTORE branch before chunk 3's `--apply`.                                                                                                                                                                             |

## Context read

- [ADR 0005](../decisions/0005-programming-model.md) — the model and its two panel rounds
- [features/programming.md](../features/programming.md) — co-existence; the `id DESC LIMIT 1` trap;
  the `/p/` gate obligation. [strength-logging.md](../features/strength-logging.md) +
  [write-path.md](../features/write-path.md) — the owning guides for `lib/dal/` and the set fields
- [plans/v1-22-program-editor.md](../plans/v1-22-program-editor.md) — A1–A4, and **W1**–**W4**
- [plans/v1-30b-form-stops-inviting.md](../plans/v1-30b-form-stops-inviting.md) — owns the field labels
- `apps/web/lib/dal/export.ts` — `prescribed` is reconstructed live; the match key is non-unique
- `apps/web/lib/programming/program-day.ts` — `formatPrescription` is a **second, UI** renderer
  (`"4 sets × 3"`); do not reuse it for the snapshot. `toProgramDay` **collapses** the reps precedence
  (`r.reps ?? r.targetReps`), so it is **not** reusable on the edit path — reusing it writes one
  athlete's override into the shared field for every sibling
- `packages/db/src/seed.ts` — `onConflictDoNothing` on the partial slot key, **insert-only** except
  `units`. ⚠️ Its V1-10 comment _"Ships EMPTY today (PROGRAM_SEED = [])"_ is **stale**; chunk 5 fixes it
- `packages/shared/src/programming.ts` — `PROGRAM_SEED` is **13** prescriptions, 11 `open()`
  (ADR 0005 item 0 and beta-1 §8 both say 14 — wrong). `prescriptionSeedRowSchema`,
  `MAX_SESSION_MOVEMENTS`, `MAX_SETS_PER_MOVEMENT`
- `packages/shared/src/units.ts` — `LOGGABLE_DIMENSION_NOUNS` (`length: 'height or distance'`)
- `apps/web/app/p/[profileId]/action-state.ts`, `apps/web/lib/constants.ts` — the envelope, the stale copy
- `.github/workflows/migrate.yml` — one migrator, on merge to `main`, racing the Vercel deploy
- Constraints by name: `prescriptions_sets_check`, `prescriptions_idx_check`,
  `uq_prescriptions_block_day_role_idx` (a partial **index**, so `ON CONFLICT` repeats its predicate
  and `SET CONSTRAINTS` does not exist), `uq_prescription_targets_prescription_profile`

## Review-response log

Five lenses — correctness, scope, architecture, reuse, db-safety — against the first draft. 22
findings accepted, 4 rejected. The draft had **17 criteria across 6 chunks**; it now has 17 across 6,
but barely a criterion survived unedited and three chunks changed position.

### Accepted — the draft was wrong, not merely thin

| #   | Finding                                                                                                                                                                                                                                                                                 | Change                                                                                                                                                                                                                                                                                                                                                      |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | **Acceptance 5 was a vacuous gate.** 11 of 13 live prescriptions are `open()`, so `prescribedFor` renders `''` and "edit, re-export, assert unchanged" asserts `'' === ''` — green with no snapshot column at all. Verified by reading `PROGRAM_SEED` and the composer.                 | Acceptance 8 now requires the fixture's pre-edit string be **non-empty** and names the only two rows that qualify.                                                                                                                                                                                                                                          |
| A2  | **Acceptance 2 forbade the dominant authored shape.** `prescriptions_sets_check` is `sets is null or sets > 0`; blank means _open_; 11 of 13 seed rows are blank. The draft rejected it.                                                                                                | Split into acceptance 2 (`0`/negative/non-integer/overflow → typed error) and 3 (blank → NULL, round-trips).                                                                                                                                                                                                                                                |
| A3  | **Chunk 0 was never a gate for chunks 1–2.** The seed is **insert-only**, so a value `UPDATE` already survives a re-seed. It gated chunk 2 only through a soft-deleted _target_, and chunk 3 through a vacated slot.                                                                    | Re-ordered: the guard is now chunk **5**, gating chunk 6 only. Three PRs to value instead of six.                                                                                                                                                                                                                                                           |
| A4  | **A cleared load would come back from the dead.** V1-22 W4 soft-deletes the `prescription_targets` row; that frees the partial unique slot and the next merge re-inserts the **seeded** load onto a child's card.                                                                       | Acceptance 7, and the first risk row. **Overrides W4** — stated as an override, not silently.                                                                                                                                                                                                                                                               |
| A5  | **Acceptance 14 (labels) was owned by V1-30b, delivered by no chunk, and used two invented words.** The live map says `length: 'height or distance'`, `time: 'time'`; V1-30b's panel settled `length`. The draft said `height` and `hold`, and its own Out of scope deferred the input. | Deleted, with the DTO's `dimension` field. Out of scope now cites V1-30b's symbol.                                                                                                                                                                                                                                                                          |
| A6  | **Chunk 1 was one PR but must be two**, merged in order — new code naming a column against an un-migrated DB throws, on the strength write.                                                                                                                                             | Chunks 1 (dark migration) and 2, with the gate read from the migrate **log**, since the step `exit 0`s with no secret.                                                                                                                                                                                                                                      |
| A7  | **The rendered string had no single home.** Two live composers (`formatPrescription` → `"4 sets × 3"`; the inline one in `export.ts` → `"4x3 @ 145"`), three consumers. Picking wrong rewrites every historical month.                                                                  | `formatPrescribedForExport` named in the contract, hoisted to `shared` (a `packages/db` correction cannot import `server-only`), plus acceptance 11's byte-identity test.                                                                                                                                                                                   |
| A8  | **`''` vs `NULL` was unstated** — and the backfill must write `''` for ambiguous and unmatched rows, or an edit that disambiguates flips a past month from `''` to a real string.                                                                                                       | Acceptance 10 pins both values distinct, the predicate `IS NULL`, and no `CHECK (… <> '')`.                                                                                                                                                                                                                                                                 |
| A9  | **`ProgramEditDTO` had no `dayRole` and no block identity**, so `idx` was ambiguous and the reorder payload unbuildable. And `programDayRows` resolves a block **per day role**, so one screen can span two blocks.                                                                     | Both fields required; the page names its block per section. Verified against the query.                                                                                                                                                                                                                                                                     |
| A10 | **`target` was singular**, so acceptance 4's "siblings untouched" had no siblings and V1-22 B4's matrix was unbuildable.                                                                                                                                                                | `targets: Array<{ profilePublicId, athleteName, … }>`, sourced within the authorized block — so **not** blocked on TEN-1.                                                                                                                                                                                                                                   |
| A11 | **Acceptance 8 was an unfalsifiable universal negative** ("shall not appear in any form input"). No test fails when a seventh input leaks it.                                                                                                                                           | Acceptance 12 names the mechanism the repo already uses: enforced by the **type**, one reader, one writer.                                                                                                                                                                                                                                                  |
| A12 | **Acceptance 9's "no-op" contradicted W1**, which asserts _set_ equality and then UPDATEs every row, bumping `updated_at`.                                                                                                                                                              | Acceptance 13 requires an explicit short-circuit and names `idx` **and** `updated_at` as the observable.                                                                                                                                                                                                                                                    |
| A13 | **The lock was on the wrong set of writers**, and had no timeout. The **add** path also computes `idx = max+1`, so two concurrent adds raise a bare 23505 — a 500.                                                                                                                      | Acceptance 15: every `idx`-computing writer takes the same lock, with `SET LOCAL lock_timeout`.                                                                                                                                                                                                                                                             |
| A14 | **Chunk 3 had no cap.** A 13th movement is accepted by the endpoint and **silently truncated** by `scaffoldMovements`.                                                                                                                                                                  | Acceptance 16, importing `MAX_SESSION_MOVEMENTS`.                                                                                                                                                                                                                                                                                                           |
| A15 | **No ownership criteria at all** — the three mandatory boundary tests were absent, including W3's case (a target naming a profile outside the block's household, a writer-enforced invariant).                                                                                          | Acceptance 6.                                                                                                                                                                                                                                                                                                                                               |
| A16 | **Acceptance 11 said "prescriptions"**, excluding the per-athlete loads, which are the rows whose reversion matters most.                                                                                                                                                               | Acceptance 17 names both.                                                                                                                                                                                                                                                                                                                                   |
| A17 | **Chunk 0 offered two mechanisms and picked neither**, and both had costs: the `seedFixtures` split inverts OPS-2's own sequencing, and a marker collides with the active-block marker the scheduling ADR needs.                                                                        | Took a fourth option neither lens's list had: a **day-scoped existence guard**, no DDL — the only one that catches compaction. The milestone is now additive-only.                                                                                                                                                                                          |
| A18 | **The backfill belonged in `db:correct`**, not a migration: it re-implements `prescribedFor` in SQL, frozen forever by forward-only.                                                                                                                                                    | Chunk 3, with the procedural cost stated.                                                                                                                                                                                                                                                                                                                   |
| A19 | **No `db:verify` proof named for any chunk**, against an explicit AGENTS.md requirement.                                                                                                                                                                                                | One per chunk, named.                                                                                                                                                                                                                                                                                                                                       |
| A20 | **The envelope and the stale copy already had single homes**, and both revalidate first — which the draft's acceptance 10 omitted, leaving the coach staring at a stale order with no way forward.                                                                                      | The contract names `ActionState` and `AMEND_ERROR_COPY.staleWrite`, promotes `ActionState` to `lib/`, and acceptance 14 revalidates.                                                                                                                                                                                                                        |
| A21 | **Chunks 4–5 shared nothing with 0–3** — different pain, different tables, gated on nothing. `write-spec` rules on this: independent PRs are backlog rows.                                                                                                                              | Both left, with criteria 12–13. The chunk-4 row inherits two findings worth carrying: `buildDefaultRoutine(ROUTINE_CATALOG)` means a NULL-config profile still renders the duplicate and a coach who removes it **can never re-add it**, and `routine-editor.tsx` degrades an off-catalog key's label to the raw key. The TEST-1 precondition left with it. |
| A22 | **AUTH-1's record was dropped.** ADR 0005 deferred "the editor being open to athletes" explicitly so AUTH-1 would not silently reverse it; the draft deleted the record.                                                                                                                | Restored under Decisions already made, with the reason the route is `/p/`-scoped.                                                                                                                                                                                                                                                                           |

Smaller accepts, folded in without a row: the filename gained its id; acceptance 1 became observable
("a subsequent read returns"); acceptance 3's `8/side` became the seed's real `'10 per side'` and gained
a max length; acceptance 9 named server-receipt time for an `/api/sync` replay; the mismatched
`hasCommaOrLineBreak` risk row went (that guard is on the _logged_ movement name; no prescription name
reaches the CSV in this scope); the rollback window, the rate limit, `requireGatedPage()`, the
`a11y.spec.ts` route, `docs/architecture.md` §2e and the `owns:` frontmatter gap all gained an owner;
`toProgramDay`'s reps collapse is called out as **not** reusable; and the prescription count is now 13
everywhere in this document.

### Rejected

| #   | Finding                                                                                                                                     | Why not                                                                                                                                                                                                                                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Correctness: the backfill should write **NULL** for an ambiguous or absent match, so acceptance 10's live fallback stays the single source. | Taken db-safety's `''` instead. NULL leaves exactly the at-risk rows unprotected: a later edit that removes one of a duplicated pair makes the match unambiguous and flips a past month's `prescribed` from `''` to a real string. Correctness's own closing paragraph concedes this. `''` makes NULL mean one thing — never backfilled. |
| R2  | Architecture: split chunk 4 into **2a (a shipped read-only screen)** and 2b, so a UI track has a landed surface.                            | The read surface already ships (`program-reference.tsx`, V1-23 PR 3) and the Today link shipped as V1-23 PR 2, so 2a would be a second read of on-screen data. The real concern is PR **size**, answered by splitting chunk 4's PR (DAL + DTO, then UI) without shipping a redundant screen.                                             |
| R3  | Scope: delete the Risks table entirely — all six mitigations are cross-references.                                                          | True of three of six, and those are gone. The remaining three carry something no other section states: the re-seeded cleared load, the `raw_load` adjacency, and the rollback window.                                                                                                                                                    |
| R4  | Scope: fold the whole chunk table down to six pointer lines at ADR §8.                                                                      | Three of its six rows now hold reasoning that **contradicts** the ADR (the gate's real position, the deploy-order split, the no-DDL guard). Pointing at the ADR for those would point at the stale version. The ADR's own item 0 already drifted to three different ranges across three documents.                                       |

Second pass: A3, A4 and A17 together moved the gate and removed the only DDL, so they went back to
db-safety and scope. Both confirmed; db-safety added that the `programBlocks` upsert must stay
`onConflictDoNothing` for the guard to hold, which chunk 5 now owns.
