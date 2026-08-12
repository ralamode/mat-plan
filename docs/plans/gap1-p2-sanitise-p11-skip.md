# GAP-1 P2 + P1-1 — input sanitisation, and recording a skipped / sub-failure set

> ## ⚠️ SUPERSEDED — never implemented as written. Do not build from this file.
>
> Committed as the **historical record** the adversarial panel reviewed, because the review-response logs
> in the successor plans cite it. It is preserved AS DRAFTED, including the parts the panel rejected.
>
> | Part                             | Outcome                                                                                                                                            |
> | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
> | **A.1** sanitise `movementSlug`  | **CUT.** It does not fix the bug, and it is a persisted natural-key change. See below and [csv-recording-gaps.md](../csv-recording-gaps.md) §P2-2. |
> | **A.2/A.3** reject at boundaries | Shipped in **#99** as a shared predicate — the guard is on the movement NAME, not the slug.                                                        |
> | **B** skipped / sub-failure      | Replaced by [1a — skipped](./gap1-p1-1a-skipped-write.md) · [1b — sub-failure](./gap1-p1-1b-subfailure-write.md) · 1c (UI).                        |
>
> **The headline reversal:** A.1 proposed stripping `,` from `movementSlug`. The panel killed it on two
> independent grounds. (1) It fixes nothing — the comma is in the NAME, persisted verbatim in
> `movements.name` **and** `entries.movement_name`, and the CSV `movement` column is kebab-rendered, not
> the snake slug. (2) `movementSlug` is a **persisted natural key** whose derivation is inlined as SQL in
> applied, forward-only migration `0002`; changing it strands existing rows on the old slug, stops
> `ON CONFLICT (slug)` firing, and splits one movement's history across two rows — uncaught by `db:verify`
> check 6, which iterates `MOVEMENT_SEED_ROWS`, not DB rows.
>
> Open Q3 ("set or entry?") was answered **SET**, by the criterion _a status belongs on the entry only if
> it can be true with zero sets_. Open Q1 evaporated with A.1; Open Q5 ("one PR or two?") became four.

> Backlog: [plan.md](../plan.md) row GAP-1 · analysis: [csv-recording-gaps.md](../csv-recording-gaps.md).
> Branch: `feat/gap1-p2-sanitise-p11-skip` (off `main`). **No migration** — both status columns already
> exist with the right CHECKs. Significant (shared write contract + UI) → plan + panel before code.

Two small gaps in one PR, kept as separate commits. Both are write-path fidelity for the CSV, both are
no-migration, and neither is big enough to justify its own review cycle.

## Part A (P2) — a movement name can silently corrupt a CSV row

`movementSlug` is `trim().toLowerCase().replace(/\s+/g,'_')` — it strips **nothing**. A movement typed
as `Bench, Close Grip` becomes `bench,_close_grip`, exports as `bench,-close-grip`, and **shifts every
downstream field in the row**. The CSV has no quoting by design (real rows carry bare inch marks), so
there is nothing to catch it. `freeTextNoteSchema` has the same shape of hole: `.trim()` strips only the
ends, so an interior newline passes and would split a row.

**A.1 — Sanitise in `movementSlug`, not by rejecting the name.** The slug is the single derivation every
consumer uses (catalog lookup, find-or-create, and the CSV `movement` column), so fixing it once fixes
all three — and it does **not** restrict what a coach may type. Drop `,` `"` and control characters;
collapse the result. Rejecting the _name_ would be a UX tax for a legitimate one.

**A.2 — Reject newlines in a movement NAME.** A name is single-line by nature; a newline there is either
a paste accident or an injection attempt. `z.string()` with a newline guard, alongside the existing
`.trim().min(1).max(100)`.

**A.3 — Reject interior newlines in `freeTextNoteSchema`.** The CSV contract: "`notes` is free text,
single-line. No newlines occur — do not allow them." One line, and it protects `feel` and every future
note field at once.

**Open Q1:** should the slug **drop** the offending characters or **replace them with `_`**?
`bench_close_grip` vs `bench_close_grip` are the same here, but `30"box` → `30box` vs `30_box` differ.
Dropping risks two distinct names colliding on one slug (which is a `movements.slug` UNIQUE conflict,
surfacing as a find-or-create returning the wrong movement).

## Part B (P1-1) — `SKIPPED` and `sub-failure` are unreachable

Both `entries.status` and `entry_sets.status` exist with a `('done','skipped','sub_failure')` CHECK, and
**nothing writes a non-`done` value**. The CSV records both: `SKIPPED` in `load` with `sets=0,reps=0`,
and `sub-failure` in `reps`. Today a skipped movement is simply absent from the log, which loses the
signal Ray's own notes call `drop-if-yellow`.

**B.1 — A movement can be marked SKIPPED, and then carries zero sets.** `sessionMovementSchema.sets` is
`.min(1)`, so `sets: []` is currently unwritable. It becomes: **≥1 set normally, exactly 0 when
`status: 'skipped'`** — a cross-field refine, not a blanket relaxation, so an ordinary movement still
cannot be logged empty.

**B.2 — A set can be marked `sub_failure`.** Per-set `status`, defaulting to `done`. This is a real
observation ("couldn't complete the prescribed reps"), not an error state — `reps` stays required and
records what _was_ achieved, which is what the CSV's `2 sets sub-failure` row shows alongside a real
`reps` value.

**B.3 — UI: a "Skipped" checkbox on the movement card; a "sub-failure" toggle per set row.** Checking
Skipped hides the set rows (they're moot) and the card submits `sets: []`. **Open Q2:** does hiding the
sets lose already-typed data if the coach unchecks it? Preserve in component state and re-show, or clear?

**B.4 — Statuses are written, not inferred.** Same provenance rule as P0-1: `skipped` means someone said
so. Nothing derives it from an empty set list.

## Acceptance

- A movement can be logged as **skipped**, storing `entries.status='skipped'` with **zero** `entry_sets`.
- A set can be marked **sub-failure**, storing `entry_sets.status='sub_failure'` with its real `reps`.
- A movement named `Bench, Close Grip` produces a slug with **no comma**.
- A newline in a movement name or a note is **rejected**.
- An ordinary movement still **cannot** be logged with zero sets.
- The existing `done` path is byte-identical.

## File-by-file changes

| Path                                                     | New/Edit | What & why                                                                                   |
| -------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------- |
| `packages/shared/src/movements.ts`                       | EDIT     | `movementSlug` strips `,` `"` + control chars (A.1)                                          |
| `packages/shared/src/text.ts`                            | EDIT     | `freeTextNoteSchema` rejects interior newlines (A.3)                                         |
| `packages/shared/src/strength-session.ts`                | EDIT     | movement `status`; newline guard on the name; sets `.min(1)` → cross-field refine (A.2, B.1) |
| `packages/shared/src/strength.ts`                        | EDIT     | per-set `status` (B.2)                                                                       |
| `packages/db/src/writers/strength-session.ts`            | EDIT     | pass both statuses through; allow a zero-set entry                                           |
| `apps/web/app/p/[profileId]/strength-form.tsx`           | EDIT     | Skipped checkbox + per-set sub-failure toggle (B.3)                                          |
| `apps/web/app/p/[profileId]/set-display.ts`              | EDIT     | render a skipped/sub-failure set distinctly                                                  |
| `apps/web/app/p/[profileId]/strength-set-schema.test.ts` | EDIT     | slug + note + status cases                                                                   |
| `packages/db/scripts/verify.ts`                          | EDIT     | skipped movement (0 sets), sub-failure set, both via the shipped writer                      |
| `docs/plan.md` · `docs/status.md`                        | EDIT     | GAP-1 progress                                                                               |

## Test plan

- **Unit:** `movementSlug('Bench, Close Grip')` has no comma; a name/note with `\n` is rejected; a
  skipped movement accepts `sets: []` while a `done` one does not; a `sub_failure` set keeps its reps.
- **`db:verify`, through the shipped writer:** a skipped movement persists `status='skipped'` with **zero**
  `entry_sets` rows; a sub-failure set persists its status **and** its reps; a `done` session is unchanged.
- **Screenshots:** tri-viewport of a card marked Skipped and a set marked sub-failure.

## Risks / rollback

- **A.1 can collide two names onto one slug** (Open Q1) — the concrete failure is
  `findOrCreateMovementId` returning the _wrong_ movement, which is silent. This is the risk to weigh.
- B.1's refine must not weaken the "≥1 set" rule for ordinary movements — that guard is what stops an
  empty movement being logged by accident.
- No migration; rollback is a revert.

## Out of scope

`prescribed` (P1-2 — needs `entries.prescription_id`, cheapest alongside V1-19); bodyweight `context`
(P1-3); the CSV export itself (V1-13); editing a skipped movement (V1-9b).

## Open questions for the panel

1. **A.1** — drop the offending characters or replace with `_`? What is the collision risk, and should
   `movements.slug`'s UNIQUE surface it rather than find-or-create silently matching?
2. **B.3** — unchecking Skipped: restore the typed sets, or clear them?
3. Should `sub_failure` live on the **set** or the **entry**? The CSV puts `sub-failure` in the `reps`
   column of a **movement** row, which suggests the entry — but a real session is "3 sets, the last
   sub-failure", which suggests the set.
4. Does the read path need to show either status, or is write-and-export enough? (P0-1's answer was
   "show it" — does the same provenance argument apply?)
5. Is one PR right for both parts, or should A ship alone first (it is smaller and strictly a bug fix)?
