# GAP-3 — typed measurements

> Backlog: [plan.md](../plan.md) row GAP-3. Evidence:
> [docs/samples/legacy-csv/](../samples/legacy-csv/). Decision context:
> [ADR 0004](../decisions/0004-typed-measurements.md).

**Status: inventory (§§1–6) + column design (§7). NOT yet panelled.** This file currently holds the shape census that
[ADR 0004](../decisions/0004-typed-measurements.md) said the column design was blocked on — _"which
shapes actually occur"_. Nothing here proposes columns. The plan sections (goal, file-by-file,
panels, review-response log) come after, and are deliberately empty so the count is read on its own
terms rather than as support for a design that was already chosen.

## 1. Corpus and counting grain

Six real files ship in `docs/samples/legacy-csv/` (plus two header-only check-in files). **Only four
of the six carry `load` and `prescribed` at all** — the two `bodyweight/` files have the columns
`date,weight_lb,context,notes` and neither measurement column exists in them. So this census is over
the four `strength-log/` files. (The bodyweight numeric shapes are recorded in §5 for completeness.)

| Grain                                  |  Count | What it means                                                           |
| -------------------------------------- | -----: | ----------------------------------------------------------------------- |
| Files with a `load`/`prescribed`       |      4 | `strength-log/{athlete-a,athlete-b}/{2020-06,2020-07}.csv`              |
| Rows                                   |     44 | The raw census population                                               |
| Distinct sessions                      |      2 | `2020-06-02` (`trainer`, 15 movements) · `2020-07-20` (`strength-a`, 7) |
| Athletes                               |      2 | Both athletes train the **same session**, so most rows have a twin      |
| **Movement-slots** (`date`+`movement`) | **22** | One authored programming decision, before athlete duplication           |
| Distinct `load` strings                |     22 | → **12 shapes**                                                         |
| Distinct `prescribed` strings          |     23 | → **12 shapes**                                                         |

**Read the slot column, not the row column.** The two athletes share a session, so a shape written
once by a human usually lands in two rows. A row count of 2 is one authored decision; a row count of
10 is five. Both columns are given below because the export contract operates on rows while the
design question ("is this shape a real thing or a one-off?") operates on slots.

**The frequency question does not have the answer ADR 0004 hoped for.** Its stated worry was building
_"a `distance_unit` for one sled row while missing something that appears thirty times."_ **Nothing
here appears thirty times.** The most common shape in `load` occupies 5 of 22 slots; seven of the
twelve `load` shapes rest on **exactly one authored cell each**. This corpus is two sessions wide. It
is strong evidence for _which shapes exist_ and weak evidence for _how often_ — and that limit is a
finding, not a caveat to skip.

## 2. `load` — 12 shapes, 44 rows

| #   | Shape                              | Rows | Slots | Distinct values | The values                                                                                                 |
| --- | ---------------------------------- | ---: | ----: | --------------: | ---------------------------------------------------------------------------------------------------------- |
| L1  | Bare bodyweight marker             |   10 |     5 |               1 | `BW`                                                                                                       |
| L7a | Per-set slash list, integers       |    9 |     5 |               6 | `55/60/60` · `65/65/65` · `80/85/85` · `100/105/105` · `55/55/55/55` · `70/75/75/75/80` · `75/80/85/90/95` |
| L2  | `BW` + parenthetical qualifier     |    4 |     2 |               2 | `BW (unassisted)` · `BW (modified)`                                                                        |
| L4  | Bare integer, unit implied (lb)    |    4 |     2 |               2 | `15` · `20`                                                                                                |
| L5  | Duration, `Ns`                     |    4 |     2 |               2 | `20s` · `30s`                                                                                              |
| L3  | `BW+N (equipment)`                 |    2 |     1 |               1 | `BW+8 (vest)`                                                                                              |
| L6  | Height, `Nin`                      |    2 |     1 |               2 | `30in` · `36in`                                                                                            |
| L8  | Number + parenthetical distance    |    2 |     1 |               1 | `123 (50ft)`                                                                                               |
| L9  | Number + implement breakdown       |    2 |     1 |               1 | `30 (2x 15 DB)`                                                                                            |
| L10 | Sentinel, not a measurement        |    2 |     1 |               1 | `SKIPPED`                                                                                                  |
| L11 | Equipment word, no magnitude       |    2 |     1 |               1 | `band`                                                                                                     |
| L7b | Per-set slash list, decimal member |    1 |     1 |               1 | `67.5/65/75/70`                                                                                            |
|     | **Total**                          |   44 |  22\* |              22 |                                                                                                            |

\* Slot counts sum to 23, not 22, because one slot holds two different shapes: `bb-bench` on
`2020-07-20` is `55/55/55/55` for athlete A (L7a) and `67.5/65/75/70` for athlete B (L7b). The only
decimal in the corpus and the only same-slot shape split are the same cell.

**Distribution, stated plainly:** two shapes (L1 + L7a/b) cover **20 of 44 rows** and 10 of 22 slots.
The remaining ten shapes cover the other half between them, and **seven of them occupy a single slot
each** (L3, L6, L8, L9, L10, L11, L7b). There is no long tail of thirty-occurrence shapes hiding
behind the rare ones; there is a short head and a flat floor of singletons.

**14 of 44 rows (32%) would survive a plain numeric column** — the bare integers (L4) and the
slash-list members (L7a/b), and the latter only if the column can hold N values. **30 of 44 rows
(68%) are not a number.**

## 3. `prescribed` — 12 shapes, 44 rows

| #   | Shape                                 | Rows | Slots | Distinct values | The values                                                  |
| --- | ------------------------------------- | ---: | ----: | --------------: | ----------------------------------------------------------- |
| P1  | `SxR`, plain                          |   12 |     6 |               4 | `1x6` · `3x3` · `3x10` · `3x50`                             |
| P2  | `Sx<duration>`                        |    4 |     2 |               2 | `3x20s` · `3x30s`                                           |
| P4  | `SxR (per-side) @ load`               |    4 |     2 |               2 | `3x10 (5/5) @ 15` · `3x10 (5/5) @ 20`                       |
| P8  | `SxR @ ~<range>`                      |    4 |     2 |               2 | `3x5 @ ~85-90` · `4x6 @ ~65-70`                             |
| P9  | `SxR` per-limb suffix                 |    4 |     2 |               2 | `2x6/leg` · `3x12/side`                                     |
| P11 | `SxR` + terminal-set instruction      |    4 |     2 |               3 | `4x4 last AMRAP` · `4x5 last AMRAP` · `4x5 last to failure` |
| P3  | `Sx<distance>`                        |    2 |     1 |               1 | `3x50ft`                                                    |
| P5  | `SxR @ <load>`                        |    2 |     1 |               1 | `3x8 @ 25`                                                  |
| P6  | `SxR @ <height>`                      |    2 |     1 |               2 | `4x3 @ 30in` · `4x3 @ 36in`                                 |
| P7  | `SxR @ ~<approx>` + the word `target` |    2 |     1 |               2 | `5x5 @ ~70 target` · `5x5 @ ~75 target`                     |
| P10 | `SxR` + free-text qualifier           |    2 |     1 |               1 | `5x3 progressive`                                           |
| P12 | Prose, no `SxR` at all                |    2 |     1 |               1 | `2 sets sub-failure`                                        |
|     | **Total**                             |   44 |    22 |              23 |                                                             |

**`SxR` is near-universal but not universal.** 42 of 44 rows (21 of 22 slots) start with `<sets>x`.
The one that does not — `2 sets sub-failure` — is prose, and it is the same movement (`pull-ups`) that
produces the only non-numeric `reps` value.

**The `@` suffix carries four different things.** It appears in 14 rows / 7 slots, and what follows it
is a weight (P4, P5), a **height** (P6), or an approximate weight (P7, P8). The separator is the same;
the quantity is not.

**`~` and ranges are prescribed-only.** `~` occurs in 6 rows of `prescribed` and **0 rows of `load`**;
the hyphen ranges `~85-90` and `~65-70` likewise never appear in `load`. The contract's claim that
range values reaching `load` would be "the single most likely column mix-up" is consistent with this
corpus: the mix-up has not happened yet in the data.

## 4. Cross-column facts

1. **The same physical quantity changes columns between the two months.** Box-jump height is in
   `load` in June (`30in` / `36in`, `prescribed` = `3x3`) and in `prescribed` in July (`load` = `BW`,
   `prescribed` = `4x3 @ 30in` / `4x3 @ 36in`). One quantity, two columns, eight weeks apart, same
   movement, same author.
2. **Distance appears in both columns on the same row.** `sled-push`: `load` = `123 (50ft)`,
   `prescribed` = `3x50ft`.
3. **`prescribed` is not derivable from `load`, and the disagreement is routine.** June `back-squat`
   is `sets=3` against `5x3 progressive`; `db-rdl` is `30 (2x 15 DB)` against `3x8 @ 25`;
   `db-step-back-lunge` is `15` against `3x10 (5/5) @ 15` with the note "cut from @20". Deviation from
   prescription is the normal case in this data, not the exception.
4. **The em dash is not a `load`/`prescribed` shape.** `—` (U+2014) appears in **21 of 44 rows, every
   one of them in `notes`** — and in zero cells of `load`, `prescribed`, `sets`, `reps` or
   `session_type`, and nowhere in the bodyweight files. It is a prose-encoding concern for the export
   contract, not a measurement shape.
5. **Nothing is blank.** 0 empty `load` cells and 0 empty `prescribed` cells across all 44 rows.
   Absence is written as the sentinel `SKIPPED` (with `sets=0, reps=0`), not as an empty cell.
6. **Weight units are never written; other units always are.** Not one weight value carries `lb` — it
   is convention. The only units that appear as characters are `s` (duration), `in` (height) and `ft`
   (distance).

## 5. Adjacent columns, for reference only

Not part of the ask, recorded because a `load` list is uninterpretable without its `sets`, and because
the bodyweight files are two of the six.

- **`sets`** — always a bare integer: `3`(28) `4`(8) `1`(2) `0`(2) `2`(2) `5`(2).
- **`reps`** — bare integer in 40 rows; **per-set slash list** in 2 (`4/3/4/2`, `4/4/4/4`); the word
  `sub-failure` in 2. Note `4/4/4/4` — a uniform value written as a list, the inconsistency the
  samples README flags as making a byte-faithful round-trip impossible.
- **`bodyweight/*.weight_lb`** (14 rows, the other two real files) — three numeric spellings of the
  same quantity: one decimal place `91.7`(10), trailing-zero decimal `92.0`(2), bare integer `92`(2).

## 6. Method

Counts produced by parsing the four files with `csv.DictReader` and classifying each cell with a
regex-per-shape, asserting the shape counts sum to 44 in both columns (they do) and that no cell falls
through to `UNCLASSIFIED` (none do). "Slots" is the count of distinct `(date, movement)` pairs. To
re-derive after any edit to the samples, re-run the shape diff described in
[the samples README](../samples/legacy-csv/README.md#handling).

## 7. Plan — the column design

Written 2026-09-23 against §§1–6, which is the order ADR 0004 insisted on: _"designing columns without
them risks building a `distance_unit` for one sled row while missing something that appears thirty
times."_ **Not yet panelled** — the engineering panel (with a DB-safety reviewer, since this is a
migration) and the UX panel come next.

### 7.1 What the census changes about ADR 0004's design

Four of the ADR's assumptions survive; three need correcting, and one piece of scope disappears.

**A. Weight units are never written; other units always are.** Not one of 44 rows carries `lb` — it is
convention — while `s`, `in` and `ft` always appear as characters (§4.6). So the unit column **cannot be
parsed out of the string**; it must be **resolved from the movement's declared dimension** and stored on
the row. That is what ADR 0004 §6 already argued for on the _correctness_ grounds that a
household-preference-only design silently reinterprets history (45 lb → 45 kg); the census adds that
there is no alternative — the data simply does not carry the unit.

**B. The same physical quantity changes columns between months.** Box-jump height is in `load` in June
(`30in`) and in `prescribed` in July (`4x3 @ 30in`), same movement, same author, eight weeks apart
(§4.1). **So the design must not key off which column a value appeared in.** Height is a property of the
movement-as-performed regardless of where the sheet happened to record it — which is exactly ADR 0004
§5's placement (prescription, with a nullable set-level override), now with evidence rather than
inference.

**C. Absence is a sentinel, never a blank.** 0 empty `load` and 0 empty `prescribed` cells in 44 rows;
`SKIPPED` carries absence, with `sets=0, reps=0` (§4.5). GAP-1 P1-1a already moved that to
`entry_sets.status`, so **the typed load columns must stay NULL-able and must never encode a status** —
the CSV's sentinel does not become a column value.

**D. `prescribed` is not derivable from `load`, and deviation is routine** (§4.3) — three of the census's
own rows disagree with their prescription, one annotated "cut from @20". This is the strongest available
support for ADR 0004 §2's refusal to unify prescribed and performed, and it means the export must never
reconstruct one from the other.

### 7.2 The scope that disappears — multi-slot loads need no columns

**YDP-2 (Stance in Motion: `duration_minutes` + independent `vest_lbs` / `ankle_lbs` / `wrist_lbs`) was
filed as needing new columns. It does not.** Verified: `entries` already carries `unit` (FK →
`units.code`) and `value_num`, and `brush_teeth` already stores **seven** sub-metrics as separate entries
under one activity type (`activity-metric-map.ts:38-46`). Stance in Motion is the same shape — a timed
activity with measured attributes — not a strength movement with sets.

So it is **four `metric_definitions` and one `activity_type`: catalog rows, no migration.** All four units
already exist in `UNIT_CODES` (`min`, `lb`). This is the V1-7 generality proof applying exactly as
intended, and the earlier framing's mistake was assuming a worn load must live on `entry_sets.weight_num`
because that is where a barbell's load lives.

**One weight per _set_ remains the right model for strength**, because that is the thing that varies per
set. Nothing here reopens it.

### 7.3 Columns

**`entry_sets`** — gains two, per the varies-per-set test:

| Column        | Type                                                   | Why                                                                                                                                                                                                  |
| ------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `weight_unit` | text FK → `units.code`, NULL when `weight_num` is NULL | Resolved from the movement's dimension + the household's magnitude preference, **stored on the row** so a later preference change cannot reinterpret history.                                        |
| `is_band`     | boolean NOT NULL DEFAULT false                         | Not a quantity and **not exclusive with bodyweight** (a band-assisted pull-up is both), so its own boolean rather than a `load_kind` enum (ADR 0004 §7). Which band goes in `entries.notes` (V1-9a). |

`weight_num` already exists. `seconds` already exists and gains its first writer.

**`prescriptions`** — gains the dimensions that do not vary per set, each with a nullable `entry_sets`
override (ADR 0004 §5): `height_num`/`height_unit`, `distance_num`/`distance_unit`, `per_side` boolean.
Prescription-only would break ad-hoc logging (ONB-1 R20); folding into movement identity would fragment
history the way ONB-1 R12a spends a migration to prevent.

**`units`** — gains `dimension` (`mass` | `length` | `time` | `count`), and the length codes
`in`/`cm`/`ft`/`m`/`yd`, which **do not exist at all today**. The dimension column is what makes `lb` in a
box-jump height **unrepresentable** rather than merely discouraged — an FK + CHECK, not a convention.

**`movements.is_bodyweight`** starts being read. It covers `BW` (14 rows), and with `weight_num` it makes
`BW+8 (vest)` representable — the shape ADR 0004's own mapping table flags as impossible today and which
the youth daily program needs on four movements.

### 7.4 What this does NOT do

- **It does not narrow `prescriptions.target_reps` or `prescription_targets.load`.** Those stay verbatim
  TEXT — they carry `AMRAP`, `~145-150`, `3 (top triple, then 2 back-offs)`, which is the coach's cue.
  ADR 0004 §2 is explicit that prescribed may legitimately be a range; `parseLoad`'s `PRESCRIPTION_SHAPE`
  guard keeps those shapes out of the _log_ path and stays.
- **It does not solve the per-set slash lists** (`65/65/65`, `4/3/4/2`). Those are a **row-shape** problem
  — the legacy grain is movement-per-day while `entry_sets` is per-set — and they belong to V1-13's
  exporter, which must re-pack. Recorded so the column design is not blamed for them later.
- **It does not add an entry→prescription link** (GAP-1 P1-2), which remains unbuilt and, per V1-22's
  panel, carries its own constraint when it lands.

### 7.5 Migration shape

Expand → backfill → contract, across separate deploys, per AGENTS.md:

1. **Expand** — add the columns and the `units` rows; `weight_label` untouched. New NOT NULLs arrive as
   `CHECK … NOT VALID` → backfill → `VALIDATE`. Every new ref column gets a covering index. `SET
lock_timeout` + `statement_timeout`.
2. **Backfill** — parse the existing `weight_label` rows into the typed columns in bounded batches.
   `BW` → `is_bodyweight`; `band` → `is_band`; `30in` → height; `123 (50ft)` → weight + distance.
3. **Contract, in a LATER deploy** — drop `weight_label`, and `parseLoad` loses its label branch. Squawk
   hard-fails a `DROP COLUMN` alongside app code, which is the rule working as intended.

`CANONICAL_LOAD_LABELS` / `LoadChips` are superseded by the booleans — but the chips' _ergonomic_
argument survives (a one-tap affordance beats typing on a phone, and iOS's numeric pad has no letters),
so it carries over to the new controls rather than being deleted.

### 7.6 Open questions for the panel

1. Does the **household magnitude preference** (lb/kg, in/cm) exist anywhere yet, or does this PR create
   it? Nothing reads `movements.unit_default` today.
2. Backfill of `123 (50ft)` writes a **prescription-level** distance from a **set-level** string — which
   prescription, when the row has none?
3. Is `per_side` on the prescription enough, given `3x10 (5/5) @ 20` puts it in `prescribed` text?
4. Does §7.2's metric-model route for Stance in Motion need a UX panel of its own (it is a new logging
   surface), or does it ride V1-5's shipped check-in form?

### 7.7 File-by-file

_Written after the panel — the design above is what the panel should attack first, and a file list would
imply a settledness it has not earned._
