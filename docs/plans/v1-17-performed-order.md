# V1-17 — Logged-entries list in performed order (oldest-first) — Staff plan & panel log

> Backlog: [plan.md](../plan.md) **V1-17** (Ray, post-V1-8). Acceptance: _the day's "Logged entries" list
> reads top-down in the order things were performed (wake → bodyweight → rice bucket), not newest-logged
> first._ Base: `feat/v1-9-edit-set` (stacked on V1-9 #60; rebases onto `main` once V1-9 merges). **No
> migration** — pure read/ordering change (`event_at` already exists, `schema.ts:99`).

## The problem

`listEntriesForDay` orders `desc(createdAt), asc(id)` (`dal/entries.ts:148`) — the list reads
**newest-logged first**. On the gym floor the kids log top-to-bottom through their routine, so the natural
reading is **oldest-first / performed order**. Two consumers bake in the desc assumption and must flip
with it: `calisthenicsTotals` reverses `values` to get oldest-first (`activity-totals.ts`), and
`todayRows` anchors session blocks + the grouped calisthenics row against desc order.

## Design decisions

**P1 — Oldest-first is the DEFAULT; no toggle in v1.** The backlog says "decide default vs a toggle." A
single default is simplest and matches the one real reading order the kids use; a user-flippable
sort is a fast-follow (and cheap once day-navigation V1-15 lands a place to put controls). No new state,
no persistence.

**P2 — Order key = `COALESCE(event_at, created_at)` ascending, `id` ascending as tiebreak.** This is the
plan's "sort by `event_at` where present": a timing activity (wake, V1-7) sorts by **when it happened**
(`event_at` = the real wake instant), everything else by **when it was logged** (`created_at`) — the best
available proxy for performed order. `id` asc (UUIDv7 == insertion order) breaks ties within one
transaction (a session's members) deterministically, exactly as today. One `orderBy`, no app-side sort.

**P3 — `todayRows` + `calisthenicsTotals` become asc-native.** With oldest-first input:

- `calisthenicsTotals` DROPS the `[...values].reverse()` — input is already oldest→newest, so `values`
  reads "20, 30" without reversing.
- The grouped calisthenics row emits at the exercise's **oldest** bout (first-encountered in asc), so the
  exercise appears where the kid first did it — consistent with performed order.
- Session blocks anchor at the **first-encountered** member, which in asc IS the oldest member — so the
  explicit "sort members by id, anchor at oldest" bookkeeping simplifies (first-encounter = anchor).
  Members still sort `asc(id)` within a block (insertion order — unchanged).
- The non-contiguous replay-append case still holds: an appended member has a later
  `coalesce(event_at, created_at)`, so asc places it after the originals — same block, re-ordered by id.

**P4 — Nothing else moves.** The input forms, the "Calisthenics today" tally, weekly adherence, and the
session/superset rendering are untouched — only the entries list order flips. The calisthenics tally card
(a fold, order-independent) is unaffected.

## File-by-file

| Path                                           | Change | What                                                                                              |
| ---------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------- |
| `apps/web/lib/dal/entries.ts`                  | EDIT   | `orderBy(asc(coalesce(event_at, created_at)), asc(id))` (P2).                                     |
| `apps/web/lib/entries/activity-totals.ts`      | EDIT   | Drop the `values` reverse; asc-native anchoring for the calisthenics group + session blocks (P3). |
| `apps/web/lib/entries/activity-totals.test.ts` | EDIT   | Flip the expected row/`values` order for the (now asc) input; keep the grouping-invariant cases.  |
| `apps/web/lib/dal/*` tests / `db:verify`       | EDIT   | Assert the new order if covered.                                                                  |
| docs/plan.md, docs/status.md                   | EDIT   | V1-17 in-flight.                                                                                  |

## Open calls (stated, not blocking)

- **Toggle** default↔performed is a fast-follow, not v1 (P1).
- **`event_at` backfill** for non-timing activities is out — most entries legitimately have none; `created_at`
  is the right proxy until a per-entry performed-time input exists (a separate, larger feature).

---

## Adversarial panel review log

_(4 lenses — correctness/data-integrity · simplicity/scope · architecture/consistency · code-reuse/DRY.
No DB-safety lens: no migration. Reconciled below.)_

**Verdict: no blocking defect.** Correctness verified the asc-native path is already correct — session-block
anchoring, the non-contiguous replay-append case, the id tiebreak, NULL handling, and every other
`listEntriesForDay` consumer (`loggedFieldKeys`/`loggedLifeKeys` are membership Sets; no positional
`entries[0]`/`.at(-1)` read exists). The panel shrank the plan and caught one real latent trap.

### Dispositions

**Adopted — the two substantive changes:**

- **[simplicity S1] CUT `COALESCE` → `orderBy(asc(createdAt), asc(id))`.** `event_at` is set only on wake,
  logged near-real-time at session start, so plain `created_at` already reads wake→bodyweight→rice bucket.
  COALESCE conflated two clocks (correctness S2 named the real inversion: a non-timing entry performed
  early but logged late, adjacent to a timing entry) for a rare edge, and needed its own test. Deferred to
  the same fast-follow as the toggle + a real per-entry performed-time input. Removes the `sql\`\`` idiom
  question (arch S1) and the extra test entirely.
- **[correctness S1 / code-reuse B1] Move the `.reverse()` from display to the FOLD input, don't touch the
  kernel.** `calisthenicsTotals` uses `values` for two things: the display array AND
  `foldAggregation(agg, values)`. `foldAggregation`'s documented precondition is **newest-first** (`last`
  returns `values[0]`). With asc input, keeping the kernel correct means: display `values` = oldest-first
  (drop its reverse), but the fold gets `[...values].reverse()` (newest-first). This keeps
  `packages/shared/src/aggregation.ts`'s contract TRUE — **no edit to `aggregation.ts` or
  `fold-aggregation.test.ts`** — and future-proofs a `last`/`avg` calisthenics metric (today all are
  sum/max, order-independent, so `total` is unchanged either way). Cleaner than rewriting the kernel's
  precondition + its test.

**Adopted — do NOT refactor the anchoring (resolves the simplicity ↔ code-reuse tension):**

- Simplicity said leave `sessionAnchor` untouched; code-reuse S1 said collapse it into the first-encounter
  `Set` idiom. **Correctness confirms the anchor code needs NO logic change and already emits the block at
  the session's start under asc.** Keeping the explicit anchor (emit at the oldest member) also keeps
  `todayRows` robust to input order — a feature, not dead weight. **Decision: leave the grouping logic
  unchanged** (a small read change shouldn't refactor working group code); note the `Set`-unification as an
  optional future tidy. Members still sort `asc(id)` within a block (code-reuse S2 — untouched).

**Adopted — documentation (all lenses: N1/S2/S3):**

- Flip every stale `desc(createdAt)`-asserting comment in the SAME edit: `dal/entries.ts:144-147` (the
  tiebreak rationale), `activity-totals.ts:31-32/65/74-76/139-143/155-158/164`, and the test-fixture
  comments. These are the invariant documentation; leaving them is the drift the SSOT rule forbids.
- **[arch S4] Make "input is oldest-first" an explicit precondition** on `todayRows`/`calisthenicsTotals`
  (a doc comment), not just an implicit consequence of a deleted reverse.

**Adopted — tests:**

- Flip expected order in `activity-totals.test.ts` (row order + `values` now oldest-first; the
  replay-append case flips to `['session','entry']`). **[arch/code-reuse B1] Pin the display `values`
  order** (rendered in both the entries row and the "Calisthenics today" tally card) so the coupling can't
  silently regress. Keep every grouping-INVARIANT case unchanged.

**Rejected / confirmed-non-issues:**

- **[simplicity N3] "reverse the final rows array"** — rejected; `desc,asc(id)` reversed becomes
  `asc,desc(id)`, flipping the id tiebreak for same-`created_at` siblings. Flip at the DAL.
- **[code-reuse N2 / correctness] `verify.ts` + `weekly-adherence.ts`** — no `created_at` ordering there;
  reclassify to **no change** (removed from the file table).
- **[arch N1] DTO-neutral** — neither `event_at` nor `created_at` is on `EntryDTO`; the sort is invisible to
  the contract, no type change. Confirmed additive.
- **[P1] No toggle** — endorsed by all; a user-flippable sort waits for V1-15's controls home.

### Net file-by-file (revised)

| Path                                                            | Change | What                                                                                                                                                                                      |
| --------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/lib/dal/entries.ts`                                   | EDIT   | `orderBy(asc(createdAt), asc(id))` + rewrite the desc rationale comment.                                                                                                                  |
| `apps/web/lib/entries/activity-totals.ts`                       | EDIT   | Move `.reverse()` from display `values` to the `foldAggregation` input; oldest-first display; the "input oldest-first" precondition doc; flip stale comments. **No anchor logic change.** |
| `apps/web/lib/entries/activity-totals.test.ts`                  | EDIT   | Flip expected row/`values` order; pin the tally-card `values` order; keep grouping invariants.                                                                                            |
| docs/plan.md, docs/status.md                                    | EDIT   | V1-17 in-flight.                                                                                                                                                                          |
| ~~`aggregation.ts` / `fold-aggregation.test.ts` / `verify.ts`~~ | —      | **No change** (kernel contract preserved by the fold-side reverse; verify has no created_at order).                                                                                       |
