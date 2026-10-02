# CSV export contract (V1-13)

The **authoritative** description of the four legacy CSVs the app must emit. Sourced from Ray's actual
workflow repo (2026-08-05), not inferred. Where a claim here contradicts [spec.md](./spec.md), **this
file wins** — spec.md was written from a stale internal spec.

> **The export must be byte-faithful.** These files are read by existing Claude skills. An export that
> looks plausible but differs by a column, a separator, or a trailing newline silently breaks that
> workflow. Every rule below exists because getting it wrong is invisible until something downstream
> misreads a training log.

## The four files

| #   | Path                                            | Header                                                            | Reality                                  |
| --- | ----------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------- |
| 1   | `data/strength-log/<athlete>/<YYYY-MM>.csv`     | `date,session_type,movement,sets,reps,load,prescribed,notes`      | **Real data.** 44+ rows                  |
| 2   | `data/bodyweight/<athlete>/<YYYY-MM>.csv`       | `date,weight_lb,context,notes`                                    | **Real data**                            |
| 3   | `data/checkins/<athlete>/<YYYY-MM>.csv`         | `date,stance,ladder,bridge,mobility,pressure,reaction,shot,notes` | **Header-only — zero rows ever written** |
| 4   | `data/calisthenics-log/<athlete>/<YYYY-MM>.csv` | `date,pushups,pullups,vsit_crunch,vsit_skill_step,notes`          | **Does not exist.** Proposed only        |

**One file per kid per month. No `athlete` column** — the kid is the directory. The same lift by two kids
on one day is two rows in two files. Rows are **chronological, append-only**; within a date, **session
order** (warm-ups → main lifts → accessories), **never sorted alphabetically**.

Files 3 and 4 have no real rows, so **file 4 is the one schema the app gets to define rather than match**
— including creating the directory and a README mirroring the other two.

## Corrections to earlier assumptions

Recording these because each would have shipped a broken export:

| I assumed                                         | Actually                                                                                                                                                                |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| checkins has 7 columns                            | **9** — `date` and `notes` were missed                                                                                                                                  |
| calisthenics has 4 columns                        | **6** — same omission                                                                                                                                                   |
| `~75-85`, `BW +5`, `35-45/hand` are `load` values | **They belong in `prescribed`.** `~` and ranges never appear in `load`. If the app emits `~` into `load` it is inventing a shape — the single most likely column mix-up |
| Session types are `strength_a`                    | **`strength-a`** — column _names_ use underscores, _values_ use hyphens                                                                                                 |
| A standard CSV writer is fine                     | **It is not** — see Quoting                                                                                                                                             |

## Formatting rules

- **Dates:** `YYYY-MM-DD`, no time component anywhere. The filename's month always matches its rows.
- **Delimiter:** comma. **Encoding:** UTF-8, no BOM. **Line endings:** LF only, never CRLF.
- **Trailing newline on every file** (last byte `0a`).
- **Non-ASCII:** the em dash `—` (U+2014) is in active use (23 occurrences in `notes`/`prescribed`).
  **Do not transliterate to `--`.**
- **Empty vs zero:** an absent value is an **empty cell** — never `-`, `NA`, or `null`. **Trailing empty
  fields are written, not dropped**: `2026-07-09,71.4,morning,` keeps its trailing comma.
  **`0` is meaningful and distinct**: `sets=0,reps=0` means attempted-and-logged-at-zero (skipped), not
  "unknown".

### Quoting — do NOT use a CSV library

**Zero quoted fields exist across all eight real files, and the files are not valid CSV:**

- A real row contains **bare double-quotes** in an unquoted field — `Liam at 30" box (Scarlett did 36")`
  — those are inch marks, not CSV quoting. Any RFC-4180 writer re-emits them as
  `"Liam at 30"" box (Scarlett did 36"")"` and the diff fails.
- One real row has an **unescaped comma** in `notes`, splitting it into 9 fields instead of 8
  (`...,3x10,warmup — shyperextension`, present in both kids' `2026-06.csv`).

→ **Join fields with `,` and write raw.** Going forward, quote a `notes` value containing a comma;
leave the two legacy rows untouched.

`notes` is free text, **single-line**. No newlines occur — do not allow them.

## strength-log — the hard one

```
date,session_type,movement,sets,reps,load,prescribed,notes
2026-07-20,strength-a,front-squat,5,5,70/75/75/75/80,5x5 @ ~70 target,ramped; top 80x5 clean
2026-07-20,strength-a,pull-up,4,4/3/4/2,BW+8 (vest),4x4 last AMRAP,reps declined across sets
2026-06-02,trainer,sled-push,3,1,123 (50ft),3x50ft,shared with Scarlett; heavy
2026-06-02,trainer,bulgarian-split-squat,0,0,SKIPPED,2x6/leg,acceptable — drop-if-yellow item
2026-06-02,trainer,pull-ups,2,sub-failure,BW (unassisted),2 sets sub-failure,max 4 clean unassisted
2026-07-20,strength-a,back-squat,3,5,80/85/85,3x5 @ ~85-90,solid
```

### One row per MOVEMENT, never per set

`sets` is the count. `reps` and `load` are **either a scalar (when uniform) or a slash-list with exactly
`sets` elements**. The app stores one row per `entry_set`, so it must **aggregate before export** — and
**collapse a uniform list to a scalar**, or `5/5/5` will diff against `5`.

### `load` shapes (the complete observed set)

| Kind            | Written as                                      |
| --------------- | ----------------------------------------------- |
| Bodyweight      | `BW`                                            |
| BW + implement  | `BW+8 (vest)` — **no spaces around `+`**        |
| BW qualified    | `BW (modified)`, `BW (unassisted)`              |
| Band            | `band`                                          |
| Per-set ramp    | `70/75/75/75/80` — length **must** equal `sets` |
| Flat            | `80`                                            |
| DB pair         | `30 (2x 15 DB)` — total, then breakdown         |
| Distance-loaded | `123 (50ft)` — weight, then distance            |
| Height          | `30in`, `36in` (no parens)                      |
| Duration        | `20s`, `30s`                                    |
| Skipped         | `SKIPPED` (uppercase, exact)                    |

**App-defined spellings (V1-30, 2026-10-01).** Nothing in the corpus was ever logged in these, so
the app defines them, following the corpus pattern (value + unit code, no space). The authority is
`CSV_UNIT_SUFFIX` in `packages/shared/src/csv/value.ts`, pinned by a test:

| Unit  | Written as              | Note                                                                |
| ----- | ----------------------- | ------------------------------------------------------------------- |
| `kg`  | `85kg`, `BW+8kg (vest)` | **Never bare**: a bare number in `load` is pounds. Never converted. |
| `cm`  | `75cm`                  |                                                                     |
| `m`   | `20m`                   | **Metres**, never minutes.                                          |
| `yd`  | `40yd`                  | No space (the `40 yd` in `prescribed` is free text).                |
| `min` | `3min`                  | **Minutes**.                                                        |

### Timed movements — easy to get wrong

**Duration goes in `load`; `reps` is `1`, not the seconds.**

```
2026-06-02,trainer,wall-sit,3,1,30s,3x30s,warmup — cut from 45s
```

### `reps` — only two non-integer shapes exist

A per-set slash-list (`4/3/4/2`) and the literal `sub-failure`. **`AMRAP`, `/side`, `/leg`, `40 yd`,
`30-40 s` never appear in `reps`** — they live in `prescribed`.

### `prescribed` vs actuals — never reconcile them

`prescribed` is the plan as one human string, `SETSxREPS [@ load]`: `5x5 @ ~70 target`, `4x3 @ 30in`,
`2x6/leg`, `4x4 last AMRAP`, `3x50ft`. `sets`/`reps`/`load` are the **actuals**. **The gap between them
is the entire point of the column** — if only 3 of 5 prescribed sets happened, `sets=3` and `prescribed`
still reads `5x3 progressive`. **Never rewrite `prescribed` to match what happened.**

### `session_type`

Observed: `trainer` (30 rows, retired) and `strength-a` (14 rows, current). README also allows
`home-pull`, `home-push`, `private`. The app's `strength_b`/`strength_c`/`conditioning` are plausible
extensions but have **never been written** — and must be emitted **hyphenated**.

## bodyweight

```
date,weight_lb,context,notes
2026-07-09,71.4,morning,
2026-07-10,71,morning,
2026-07-13,71.2,morning,after a big dinner
```

> ⚠️ **`weight_lb` must be exported as TEXT, not a number.** The real file mixes `71`, `71.0` and `71.4`
> in one column. A round-trip through a float normalises `71` → `71.0` and blows the golden diff. This
> is a **data-model consequence**, not just a formatting one — see Open questions.

> ⚠️ **`weight_lb` holds pounds (CSV-1, Ray 2026-10-02).** An `lb` weigh-in is written as logged. A
> `kg` weigh-in is **converted** — kg × 2.20462262185, rounded half-up to one decimal (the form's
> precision) — and `logged <value> kg` is appended to `notes` (joined with `; ` if notes were present),
> so the logged number is never lost. Never suffixed (`84.5kg` would break the column) and never bare
> (it would read as pounds). Any other unit refuses the export.
> e.g. `2026-09-30,186.3,,logged 84.5 kg`

`context` observed: `morning` only; README also allows `pre-practice` / `post-practice` / `random`.
Gaps are normal — **not every day has a row; do not backfill.**

## checkins (header-only in reality)

```
date,stance,ladder,bridge,mobility,pressure,reaction,shot,notes
2026-05-04,3min,4,10,5,5,7/10,15,
2026-05-06,,,,,,,,rest day
```

Header verbatim from the real (empty) files; rows constructed from the `/routine-checkin` skill spec.
**These are strings, not integers** — `stance` carries its unit (`3min`), `reaction` is `7/10`,
`pressure` is bare. `shot` counts toward the 10K goal. One row per day.

Rice-bucket, drill-your-moves, splits and Brain Rep have **no columns** — they ride in `notes` or nowhere.

## calisthenics (proposed; the app defines it)

```
date,pushups,pullups,vsit_crunch,vsit_skill_step,notes
2026-07-20,120,25,60,2,spread across the day
2026-07-22,100,22,45,3,earned step 3 — 3x20s support hold
```

`vsit_skill_step` is 1–5. Nothing exists on disk, so the app creating the directory plus a README
mirroring the other two is the intended path.

## CI must assert more than the diff

Beyond a byte-diff against golden files: **assert that `sets` equals the element count of any slash-list
in `reps`/`load`.** All eight real files would pass a golden diff while carrying a mismatched list — that
is the silent break the golden file cannot catch.

## Open questions / consequences for the data model

1. **Bodyweight precision.** `entries.value_num` is `numeric`; the CSV needs the operator's literal
   keystrokes (`71` vs `71.0`). `entries.raw_load`/`raw_reps` exist for exactly this on strength — an
   equivalent verbatim column (or reusing `raw_load`) is likely needed for bodyweight. **Decide in the
   V1-13 plan.**
2. **`session_type` mapping.** `strength_a` → `strength-a` is a presentation mapping; it belongs in the
   export layer, not the DB.
3. **Uniform-list collapse** is a real transform with an edge case: is a 1-set movement's `reps` ever a
   1-element list, or always scalar?
4. **The `~`/range loads Ray authored in V1-10's program seed map to `prescribed`, not `load`** — so the
   export's `prescribed` is built from `prescription.sets`/`target_reps`/`prescription_target.load`,
   while `load` comes from what was logged.

## Source-message truncations to confirm

A few lines of the source arrived truncated. The reading assumed here, to be confirmed:

- "…decide [what to do about] notes with a comma — the skill spec says quote it, the existing data
  doesn't. I'd quote going forward and leave the two legacy rows untouched." → **assumed: quote new,
  leave legacy.**
- "The `~` and ranges live [in `prescribed` —] that's the single most likely column mix-up."
- "Your app must aggregate per-set [rows b]efore export."
- One `notes` example ended mid-word (`ran 3 sets v…`) — not needed for the contract.

## Contract changes

Dated, additive changes to what the export can write. Every row that exported before a change keeps
its bytes. The reader is an external workflow, so each entry names what that workflow must learn.

- **2026-10-01 — V1-30:** `load` can now carry `kg`, `cm`, `m` (metres), `yd` and `min` (minutes),
  as above, and a `kg` worn mass is suffixed (`BW+8kg (vest)`). Before this, a set in any of those
  units made the export throw. **Workflow:** the external `strength-log/README.md` `load` bullet must
  list the new suffixes. A bare number is still pounds.
