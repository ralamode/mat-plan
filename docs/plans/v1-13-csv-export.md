# V1-13 — CSV export

> Backlog: [plan.md](../plan.md) row V1-13. Branch: `feat/v1-13-csv-export`.
> Contract: **[csv-export-contract.md](../csv-export-contract.md)** — authoritative.
> **Revised after two panels (engineering + contract-fidelity). Nine blocking findings; two of them
> would have silently corrupted the workflow this feature exists to serve.** Log at the end.

## Goal

**The MVP finish line.** v1 is "kids log a full day online **+ CSV export keeps the Claude workflow
alive**". Blocked twice — six weeks on the legacy samples (#121), then behind GAP-3 (#141). Nothing
blocks it now.

## The two that would have shipped broken

**1. Every movement would have silently forked into two series.** Legacy bytes are kebab-case —
`front-squat`, `bulgarian-split-squat`, `ghd-back-extension`. `movementSlug()`
(`shared/movements.ts:35`) emits **underscores** (`front_squat`), and `EntryDTO` carries no slug at
all — only free-text `movementName`. So the export would emit `front_squat` forever, the workflow
would group by movement string, and _"what did he back-squat across the last four Tuesdays"_ returns
nothing. The contract flags this trap **for `session_type` only** (L37); my draft dutifully handled
that column and missed the identical trap on the one next to it.

**2. A kilogram load would have exported as a bare number meaning pounds.** Every legacy `load` number
is unit-less and means lb. GAP-3 made units first-class, and the form now offers `LOGGABLE_UNITS`. A
set logged in `kg` exported as `85` is read by the workflow as 85 lb — **a 2.2× error in the exact
column that drives load progression**, invisible to the contract's own `sets`-vs-list-length check.
Given the project's one inviolable rule is that bad loads are an injury risk, a silent 2.2× is the
worst defect available in this feature.

## Decisions, taken

| #                          | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Units**                  | **Refuse, do not convert.** The exporter emits only `lb` / `in` / `sec`. If any row in range carries another unit, the export **fails loudly and names the rows**. Conversion was rejected: it invents a number the athlete never logged, and ADR 0004 §6's whole point is that the resolved unit rides the row. Incidence today is ~0 (`DEFAULT_BODYWEIGHT_UNIT` is lb) — so this is a tripwire, not a tax, and the first time it fires is a real decision with real data.  |
| **`movement`**             | `movements.slug`, `_` → `-`. **Never `movements.name`** (`"Front Squat"` would be catastrophic). Needs a new read: `EntryDTO` has no slug.                                                                                                                                                                                                                                                                                                                                   |
| **`session_type`**         | Source is **`sessions.day_role`, not `session_type`.** `strength_a` lives only in `DAY_ROLES`; `SESSION_TYPES` is `strength\|conditioning\|skill\|push\|pull\|legs\|core`, so reading the obvious column collapses every A/B/C day into `strength` and destroys the distinction all 14 current legacy rows are built on. `day_role ?? session_type`, hyphenated; **both are nullable and `entries.session_id` is nullable too** — a sessionless entry emits the empty field. |
| **`SKIPPED`**              | Source is **`entries.status`** (movement-level), never `entry_sets.status` — `SET_STATUSES` is `['done','sub_failure']` and `enums.ts:67-70` explains why: a skipped set row is never written _precisely because_ the export derives `sets` from `COUNT(entry_sets)`. The aggregator branches on the entry **before** it counts.                                                                                                                                             |
| **Partial skips**          | `sets` counts sets with `status != 'skipped'`; skipped sets are excluded from both slash-lists, so `sets` == list length still holds. A fully-skipped movement emits `0,0,SKIPPED`.                                                                                                                                                                                                                                                                                          |
| **`sub-failure`**          | The 12th shape, which my draft missed entirely — the only non-numeric `reps` value besides a slash-list, real in both kids' files. Emitted via **`ENTRY_STATUS_LABELS`**, never re-typed (`enums.ts:84-95` says the badge and the exporter must emit the same byte).                                                                                                                                                                                                         |
| **Aggregation grain**      | **`(session, movement)`, not `(date, movement)`.** The latter merges a trainer AM and a home PM session into one row with two different `session_type`s, silently discarding one and summing the slash-lists.                                                                                                                                                                                                                                                                |
| **Row order**              | `ORDER BY activity_date, session id, entries.created_at, entries.id` — the V1-17 clause (`entries.ts:173`), which is also what makes superset members read in order. **Stated limitation:** there is deliberately no `position` column (`schema.ts:498`), so intra-session order is _insertion_ order; an offline set flushed late from a second device lands at the bottom of a session it happened at the top of.                                                          |
| **`prescribed` commas**    | **Quote `prescribed` as well as `notes`.** 8 of 21 seeded prescriptions contain a comma (`'5, last set to failure'`, `'3 (top triple, then 2 back-offs)'`, `'40 yd, to grip failure'`) — ~38%. Unquoted, each splits the row into 9 fields. Guarded at the joiner with the existing `hasCommaOrLineBreak` (`text.ts`), not a new predicate.                                                                                                                                  |
| **`prescribed` ambiguity** | `(day_role, movement)` is **documented non-unique** — `schema.ts:620-622`: _"a movement may legitimately appear twice in a day — warm-up + working — so the key is NOT movement_id."_ On an ambiguous match, **emit empty `prescribed`**. A silent arbitrary pick is the one option ruled out: the column's entire purpose is being _not_ reconciled with actuals. Resolving it properly is GAP-1 P1-2, out of scope.                                                        |
| **`prescribed` source**    | Reuse **`queries/program-day.ts`**, which already selects `{idx, movementName, sets, targetReps, load, reps}` household- and profile-scoped, soft-delete-guarded, `idx`-ordered. My draft omitted `prescription_targets.reps` (the V1-10 per-kid override), which would have exported Liam's pull-up as `4x4-5` instead of `4x4`.                                                                                                                                            |
| **Numeric formatting**     | **One shared `formatNumeric`, used by `load` AND bodyweight.** Drizzle returns `numeric` as a **string**, so every mass reads back `70.000` — without trimming, _every load value in the file is wrong_, not just `weight_lb`. Must be decimal-aware: a naive `replace(/0+$/,'')` turns `90` into `9`.                                                                                                                                                                       |
| **Non-ASCII**              | Pass `notes` through **byte-for-byte**; no transliteration of anything. The contract names only the em dash (×21), but the corpus also carries **`→` U+2192 ×2**. An acceptance criterion written to the letter of "em dash preserved" passes while an ASCII-folding sanitiser eats the arrow.                                                                                                                                                                               |

## Resolved by Ray (2026-09-24)

### 1. The athlete directory is backed by `profiles.slug` — a real column, not a derived string

Ray asked the right question: _"why do we need an athlete directory? Should this not be something in
the database?"_ Both halves have an answer.

**Why a directory:** it is not our choice. The legacy layout is `data/<type>/<athlete>/<YYYY-MM>.csv`,
and the contract's _"no `athlete` column — the kid is the directory"_ (L21) **describes those files**.
Emit a different shape and the workflow does not recognise it.

**Why a column:** because the identity behind that path must be stable. **My "avoid a migration in the
MVP's last PR" reasoning was backwards** — deriving the slug from `profiles.name` makes a filesystem
path a function of a _mutable display string_. Rename "Liam" → "Liam B" and the entire tree relocates;
the workflow sees a new athlete with no history. That is permanent damage to the thing this feature
exists to protect, traded for a scheduling convenience.

**And it is not a novel design — it is the third instance of a documented precedent.** `movements.slug`
(`schema.ts:388`, `.notNull().unique()`) and `program_blocks.slug` already exist, and the schema states
the rule outright (`schema.ts:591-593`): _"`slug` (not raw `name`) is the identity so a re-seed can't
duplicate a block on whitespace/casing."_ A profile is the same case with higher stakes, because its
slug is a **path segment**.

**Shape:** `profiles.slug text`, unique per household (the `(household_id, slug)` partial-unique idiom
the schema already uses for `ramp_targets`/`day_readiness`). NOT NULL, arrived at via the house
sequence — add nullable → backfill the two seeded rows → `SET NOT NULL` — because
`drizzle-kit generate` emits `ADD COLUMN … NOT NULL` with no default, which fails on a populated table
([lessons.md](../lessons.md), migration 0010).

**Sequencing: a small precursor PR** (`db(v1-13): profiles.slug`) rather than folding a migration into
13a. One concern, its own Squawk/forward-only pass, and it unblocks the path shape 13a needs.

### 2. Bodyweight: trim trailing zeros, accept the loss

**Ray: _"that is fine, we can assume .0 if no tenth or decimal is used."_** So `92.000` → `92`, and a
reader takes a bare integer to mean `.0`. Decided on the **correct** premise this time: the corpus
really does contain `92.0` and `74.0` (2 of 14 rows, deliberately preserved by the scrub), and the
precision is already gone at the form boundary (`bodyweight.ts:22` is `z.coerce.number()`), so no
export-layer or column choice could have recovered it anyway.

⚠️ The trim must be **decimal-aware** — a naive `replace(/0+$/,'')` turns `90` into `9`.

### 3. `calisthenics-log` is cut from V1-13 → fast follow

**Ray took the recommendation and asked for a fast-follow row.** It is the one file _the app defines_
rather than matches, and defining it is its own decision with three unanswered questions: the daily
program prescribes **`leg_raises`**, which has no column; it tracks `reps_per_set` across up to 10 sets
against a **single daily scalar**; and `vsit_skill_step` (1–5) has **no representation in the data model
at all**. Backlog: **V1-13a-fu**.

## Scope: 13a = strength-log end-to-end · 13b = the rest

My draft split pure-vs-plumbing. The panel priced 13a at **~750–800 lines with its golden vectors —
already 2× the budget**, and the seam left the whole feature blocked behind the `prescribed` decision.

Better seam, **one file at a time**:

- **13a — `strength-log` end to end.** The only hard file: aggregation, all 12 `load` shapes, the
  `movement`/`session_type` mappings, the unit tripwire, ordering, `prescribed`. Ships a working
  export for the file that carries every difficulty.
- **13b — `bodyweight` + `checkins`, plus zip delivery.** Trivial formatters; the work is the route,
  ownership, and packaging.

## Delivery

A **Route Handler** returning a zip of the `data/…` tree (reads/batch → Route Handler, never a Server
Action). Profile-scoped and ownership-checked, with the AGENTS.md boundary tests.

**Dependency, priced.** `fflate` (~8KB, sync) vs a hand-rolled **STORED-only zip** (~60 lines, no
compression, small CRC table). SECURITY.md says minimise dependencies and this is the MVP's last PR,
so the hand-rolled path is the default unless the panel's estimate proves optimistic. If `fflate`
lands, pin it exactly and keep it server-only so it never enters a client bundle.

## Home: a subpath export, not the barrel

`packages/shared/src/csv/`, exported as **`@mat-plan/shared/csv`** — _not_ added to the
`export *` barrel, which 8 `'use client'` components import. CSV formatting has no business in a
client bundle. Reuse `hasCommaOrLineBreak`/`hasLineBreak` from `text.ts` (their docblocks are already
written against this contract) rather than re-deriving the predicates.

## Acceptance

- Golden vectors for all **12** shapes, transcribed from the contract's own real rows — including
  `sub-failure`, a partial skip, a two-a-day, `30" box` (the RFC-4180 tripwire), and the `→` row.
- `sets` == slash-list element count, asserted independently of the golden bytes.
- Uniform lists collapse to a scalar; a 1-set movement is scalar, never a 1-element list.
- `movement` is kebab-case — vector `bulgarian_split_squat` → `bulgarian-split-squat` **and** the
  already-hyphenated `bent-over_rows` → `bent-over-rows`.
- A non-lb/in/sec quantity **fails the export and names the rows**; vectors for kg and cm.
- **Re-exporting the same month twice is byte-identical.**
- LF endings, trailing newline, no BOM, trailing empty fields written, `notes` byte-for-byte.
- `prescribed` is never rewritten to match actuals; ambiguous match → empty.
- Ownership-checked; unauth → reject, wrong-owner → forbid.

## Risks

| Risk                                                                                                                                                                                                                              | Mitigation                                                                                                                                                                                                                                            |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The exporter is provable only against fixtures we wrote** — no importer exists and prod held zero rows as of #139, so the "byte-faithful diff against the legacy corpus" the row and contract lean on **cannot be run at all**. | Vectors are transcribed from the contract's own examples, which are real rows. The independent check is **V1-14b** — log a day through the UI, export, diff — which is exactly why 14b exists downstream. Stop claiming the legacy diff.              |
| A CSV library sneaks in later and re-quotes the inch marks.                                                                                                                                                                       | A comment at the joiner plus the `30" box` vector — it fails loudly the moment someone "fixes" it.                                                                                                                                                    |
| `prescribed` reconstruction reads today's program, not the program as it was.                                                                                                                                                     | Safe while prescriptions are seed-immutable; **V1-22 breaks it** (an edited load retroactively rewrites history). Recorded on the V1-22 row as a blocker it must solve.                                                                               |
| Two `load` shapes (`BW (unassisted)`, `30 (2x 15 DB)`) are unrepresentable; two more (`BW+8 (vest)`, `123 (50ft)`) need GAP-3 PR 4b.                                                                                              | The 4b pair describes data the app **cannot currently create either**, so vectors cover them and 4b turns them on with no export change. The other two are qualitative prose bound for `entries.notes` via V1-9a — an input gap, not an exporter bug. |
| `bodyweight.context` is `morning` on 100% of real rows and the app **can never write it** (`logBodyweightSchema` has no such field).                                                                                              | Exports empty forever. Stated explicitly so it reads as a known regression of a populated column, not an export defect.                                                                                                                               |

## Out of scope

An importer · GAP-1 P1-2 (`entries.prescription_id`) · V1-9a notes · V1-14b's round-trip ·
`calisthenics-log` (**V1-13a-fu**, per Ray).

## Review-response log

Two panels before implementation: engineering (correctness · scope · architecture · reuse) and a
dedicated **contract-fidelity** lens that read the real sample bytes. Both went to the files rather
than the plan's prose, which is why nine findings were blocking.

### Blocking — all accepted

| Finding                                                                                                                                             | Response                                                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **`movement` must be kebab-case** (contract lens). App emits `front_squat`; legacy is `front-squat`. Every movement silently forks into two series. | Accepted. `movements.slug` with `_`→`-`, a new read (EntryDTO has no slug), two golden vectors.                           |
| **A kg load exports as a bare number meaning lb** (contract lens) — a 2.2× error in the load column.                                                | Accepted. Exporter **refuses** rather than converts; incidence is ~0 today, so it is a tripwire.                          |
| **`SKIPPED` comes from `entries.status`, not `entry_sets.status`** (engineering). `shared/enums.ts` already documents why.                          | Accepted; the aggregator branches on the entry before counting.                                                           |
| **`sub-failure` — the 12th shape — was missing entirely** (engineering).                                                                            | Accepted; emitted via the existing `ENTRY_STATUS_LABELS`.                                                                 |
| **`prescribed` corrupts the row: 38% of seeded prescriptions contain a comma** (engineering + contract lens).                                       | Accepted; quote `prescribed` too, guarded by the existing `text.ts` predicate.                                            |
| **`20s` cannot come from `${value}${unit}`** — the unit code is `sec` (engineering).                                                                | Accepted; an exhaustive `Record<Unit, string>` CSV-suffix map so a new unit is a compile error.                           |
| **Trailing-zero trimming is a `load` problem, not just bodyweight** (engineering) — numeric returns a string, so every mass is `70.000`.            | Accepted; one shared decimal-aware `formatNumeric`.                                                                       |
| **Row order is unspecified and there is no ordinal** (contract lens).                                                                               | Accepted; the V1-17 clause, plus the insertion-order limitation stated out loud and a byte-identical-re-export criterion. |
| **`<athlete>` directory has no defined source** (contract lens).                                                                                    | Accepted as an **open question for Ray** — derive-and-fail-loudly recommended over a migration.                           |

### Major — accepted

`prescribed` missed `prescription_targets.reps` and should reuse `program-day.ts` · `session_type`
reads `day_role`, not `session_type`, and both are nullable · aggregation grain is `(session,
movement)` · partial-skip rule stated · `context` can never be written · the DISTINCT-vs-all-four
contradiction · `calisthenics-log` needs its own decision · the scope reseam to one-file-at-a-time ·
`@mat-plan/shared/csv` as a subpath, not the barrel · `→ U+2192` in the non-ASCII rule.

### Corrected — my errors

- **The bodyweight `.0` justification was false.** "Nobody will type it" — the corpus has two, 14% of
  rows, deliberately preserved by the scrub. And the precision is already lost at the form boundary,
  so no export decision recovers it. Ray was about to decide on a false premise.
- **My 13a/13b split was at the wrong seam** and put the larger half first, blocked behind an
  unresolved decision.
- **I claimed a byte-faithful legacy diff was the gate.** It cannot be run — there is no importer.
