# GAP-3 — typed measurements

> Backlog: [plan.md](../plan.md) row GAP-3. Evidence:
> [docs/samples/legacy-csv/](../samples/legacy-csv/). Decision context:
> [ADR 0004](../decisions/0004-typed-measurements.md).

**Status: inventory only.** This file currently holds the shape census that
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

## 7. Plan

_Not written yet — see the status note at the top._
