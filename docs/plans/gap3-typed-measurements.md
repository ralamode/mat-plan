# GAP-3 — typed measurements

> Backlog: [plan.md](../plan.md) row GAP-3. Evidence:
> [docs/samples/legacy-csv/](../samples/legacy-csv/). Decision context:
> [ADR 0004](../decisions/0004-typed-measurements.md).

**Status: inventory (§§1–6) + column design (§7) + panel (§8). Q1 unresolved — no file-by-file yet.** This file currently holds the shape census that
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

### 7.2 Stance in Motion — RETRACTED: the scope does not disappear

An earlier draft of this section claimed Stance in Motion's `duration_minutes` +
`vest_lbs`/`ankle_lbs`/`wrist_lbs` needed **no migration**, because `entries` already carries
`unit`+`value_num` and `brush_teeth` already stores seven sub-metrics. **The panel found that half-true,
and the half that fails is the half that matters.**

**What holds** (verified): `logCheckinEntries` really does write N metric rows in one insert
(`apps/web/lib/dal/entries.ts:345-372`); no uniqueness blocks four rows; `min` and `lb` are both in
`UNIT_CODES`; `entries_shape_check` is satisfied because every metric write sets `value_num`.

**What collapses:**

1. **A metric-modelled Stance in Motion can never be PRESCRIBED.** `prescriptions.movementId` is
   `.notNull()` FK → `movements` (`schema.ts:499-501`), so anything routed through
   `metric_definitions` cannot reach `prescriptions` or `prescription_targets` at all. But the YDP seed
   makes Stance in Motion a **program item with a progression rule** — _"Advance duration first, then add
   one load slot at a time"_ (`seed.json:95`). The metric route makes that rule unexpressible and
   invisible to the future engine, while V1-22 scope B is blocked on GAP-3 _for these very shapes_.
2. **"No migration" was read as "no work."** `CHECKIN_FIELDS` hard-codes two activity keys and its own
   docblock calls that _"a deliberate render scope, NOT a general seam"_; `metricField`'s bounds cover
   only `scale_10` and `count`; `accumulates` is a hard-coded set; and `activity-totals.ts` dispatches on
   an `aggregation` whose honest value here (`last`) is one `assertRollupAggregation` throws on.
3. **`vest_lbs: null` is explicit in the data** (`seed.json:147`) — "logged, and no vest" — but a metric
   model represents it as a _missing row_, indistinguishable from "not logged". That distinction is
   exactly what the progression rule reads.

**So the three worn loads are the strongest argument FOR a load-slot design, not evidence against needing
one.** The retraction is recorded rather than quietly edited: the original claim is the kind that looks
like a win precisely because it removes work.

**Decision deferred to §7.6 Q5**, because it is the plan's largest remaining fork.

### 7.2a DECIDED — the typed child table (Ray, 2026-09-24)

**Fixed columns per dimension have already overflowed on the second real program.** ADR 0004 sized them
against one program; YDP needs three worn-load slots on one activity, and a fixed-column design answers
that with three more columns the _next_ program overflows again.

**Taken: `entry_set_loads`** — a typed child table of `entry_sets`:

| Column         |                                     |                                                                               |
| -------------- | ----------------------------------- | ----------------------------------------------------------------------------- |
| `entry_set_id` | FK → `entry_sets`                   | the load belongs to the SET, which is what varies                             |
| `slot`         | FK → a `load_slots` reference table | `vest` · `ankle` · `wrist` · … — a **controlled vocabulary**, never free text |
| `value_num`    | `numeric`                           | typed, never a string                                                         |
| `unit`         | FK → `units.code`                   | keeps the dimension guard on every row                                        |
|                | `UNIQUE (entry_set_id, slot)`       | the arity rule — nothing can write fourteen vest rows                         |

**This is not EAV, and it is not novel here.** EAV is a `key`/`value` table whose value is untyped text
with no constraint on valid keys. This has a typed value, an FK'd unit, and a reference-table vocabulary
— and the repo already uses the same pattern twice: `entry_sets` is a child of `entries`, and
`prescription_targets` is a child of `prescriptions`. This is the third instance of an established shape.

**Performance is a non-argument at this scale** and should not be cited as one: two to a few dozen
athletes, one stance entry per session — a year is hundreds of rows, joined on an indexed FK. The child
table's real cost is **read-path scope**: every reader of a set decides whether to join, the DTO widens,
`formatSetLine` changes, and the form renders a variable field set.

**Why it was taken over the cheaper `weight_num` + `load_slot` single column** _(which this plan
recommended, on the evidence that all four sample sessions use at most one slot at a time)_:

1. **The population is a club, not two kids.** This is intended for the athletes at Mat Assassins. A
   four-session sample from one family does not describe that population, and the sample was the whole
   basis of the one-slot-at-a-time argument.
2. **Slots vary within a session** — "they take the weighted vest off after the first set." The parent is
   `entry_sets` precisely because the load is a property of the set, not the movement or the day.
3. **The data-loss window is open now.** Anything logged before the structure exists cannot be
   back-filled. The kids have not started logging yet, so the cheap moment is this one.

### 7.2b DECIDED — the child table holds ALL loads (Ray, 2026-09-24)

**(A), not (B).** A plain back squat's weight becomes a row in `entry_set_loads` like any other load;
`entry_sets.weight_num` / `weight_unit` are eventually dropped. One mechanism, no bifurcation — and since
this migration already rewrites every weight row, the marginal cost of doing it properly is smaller now
than it will ever be again.

**The split this forces, and it is a clean one:**

| Kind                                                                  | Home                     | Why                                                                                                                                                                 |
| --------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Quantities** — primary weight, vest, ankle, wrist, distance, height | `entry_set_loads` rows   | each has a value **and** a unit, so each needs the dimension guard                                                                                                  |
| **Qualitative flags** — `is_bodyweight`, `is_band`                    | booleans on `entry_sets` | neither is a quantity. A band has no number; bodyweight is a _mode_, not a load. Modelling them as rows with NULL values would be the EAV smell this design avoids. |

So `BW+8 (vest)` is `is_bodyweight = true` **plus** one `vest` load row — which is exactly the shape ADR
0004's mapping table calls "not representable today", now falling out rather than being special-cased.

**What (A) costs that (B) did not:**

1. **The join becomes universal, not exceptional.** Under (B) a normal strength set reads with no join.
   Under (A) every set read joins. Still free at this scale — club-sized is tens of thousands of rows on
   an indexed FK — but the honest cost is **code surface**: every query that filters or aggregates on
   weight now goes through the join. Relative strength, progression, CSV export.
2. **The backfill is over every set, not just stance sets.** That re-sizes §7.6a's split; step 4 is no
   longer a small script.
3. **⚠️ The contract deploy now drops `weight_num` — a column with live data in every logged set.** That
   is the most destructive step in this plan, and per the [CI audit](../tech-debt.md) **Squawk is not
   wired to catch it**, nor is the forward-only guard. **Choosing (A) makes that CI work a prerequisite
   rather than a nice-to-have.**
4. **V1-9's edit-a-set path changes shape.** It addresses a set by `public_id` and updates reps+weight
   together; weight now lives in a child row, so the writer's single-statement ownership guard has to
   span two tables.

**RESOLVED 2026-09-23 (Ray): the slot is `primary`** — it names the ROLE (the load the movement is
_about_), which is the only axis that separates it from `vest`/`ankle`/`wrist`. Rejected: `external`
and `implement` (a vest is both), `bar` (false for dumbbells, sled and machine).

**And the table is `entry_set_quantities`, not `entry_set_loads`** (Ray, same session): it holds a box
jump's height and a broad jump's distance, which are not loads — and `measure`/`measurement` was
rejected in turn because this repo already means two other things by those words (`metric_definitions`
and the `'measurement'` activity category). See
[the PR plan](./gap3-pr3-entry-set-quantities.md).

⚠️ **The adversarial panel then broke the slot's DIMENSION model**, which this section had implied was
one-per-slot: `broad_jump` and `hollow-body_hold` are already in the seeded catalog and their primary
quantity is a length and a duration. `quantity_slots` is therefore keyed on the **pair**
`(code, dimension)`, and `primary` is legal at mass, length and time.

### 7.2c The open UX question Ray raised — how does the editor express a slot set?

_"Not sure how we would specify this type of field combination or express it in the workout editor UX."_
Correct to flag it; it is the hard part, and it belongs to **V1-22**.

The design move that makes it tractable: **slots are declared by the MOVEMENT, never added per-set by the
athlete.** Stance in Motion declares `[vest, ankle, wrist]`; a back squat declares nothing and renders
today's single weight field. The log form then draws exactly the fields that movement declares — so the
child table is **invisible** to the kid, who sees three labeled number fields rather than a "slot"
concept, and there is no add/remove-slot UI on a 360px row.

That pushes the authoring question into the movement/program editor, where a coach picking from a
controlled list is a normal interaction. **V1-22's panel must see this** — it changes that editor's scope.

### 7.3 Columns — corrected after the panel

> ⚠️ **SUPERSEDED IN PART (2026-09-23).** The `entry_sets` height/distance COLUMNS below are dead —
> §7.2b's later decision puts every value+unit quantity in the child table, and Ray confirmed it. The
> `units.dimension` and `movements.dimension` rows still stand (the former shipped in #137). The
> invariant this section said was "not achievable as written" IS achieved: two composite FKs sharing a
> stored `dimension`, against two primary keys. See [the PR plan](./gap3-pr3-entry-set-quantities.md).

**The set is the primary home; the prescription is the plan.** An earlier draft had height/distance on
`prescriptions` with a nullable `entry_sets` "override" — but ADR 0004 §5 rejects prescription-only
_precisely because ad-hoc logging has no prescription_ (ONB-1 R20), and §7.6 Q2 admits the backfill has no
prescription to write into. So the set-level column is not an override; it is where the fact lives. That is
§7.1-D's own argument applied consistently: **the prescription is the plan, the set is what happened.**

That also fixes a self-contradiction: "`entry_sets` gains **two**" while the prescription row silently
added four more.

| Table           | Columns                                                                                  | Notes                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `entry_sets`    | `weight_unit`, `is_band`, **`height_num`/`height_unit`, `distance_num`/`distance_unit`** | `weight_num` and `seconds` already exist. Pairing CHECKs are **required, not prose**: `(weight_num IS NULL) = (weight_unit IS NULL)` and `weight_num >= 0` (today enforced only in `parseLoad`), in the `entries_value_source_check` idiom. Numeric precision must be stated — `weight_num` is `(7,3)`, `entries.value_num` is `(8,3)`; pick one and justify.                                    |
| `prescriptions` | the same dimensions, as the **plan**                                                     | plus `per_side`.                                                                                                                                                                                                                                                                                                                                                                                 |
| `units`         | `dimension`                                                                              | **Needs the full single-sourcing treatment**: `UNIT_DIMENSIONS` as-const + zod in `packages/shared`, the reference-table seed, and a `db:verify` parity assertion in **both** directions (the `assertCheckCoversConst` idiom). A migration that inserts `in/cm/ft/m/yd` directly is exactly the drift that rule exists to stop — they belong in `UNIT_CODES`/`UNIT_LABELS`, which feed the seed. |
| `movements`     | **`dimension`**                                                                          | **New, and the earlier draft had no home for it.** "Resolved from the movement's declared dimension" had no source: `movements` has only a nullable `unit_default` (a _unit_, and `null` for every bodyweight movement), and a sled has mass _and_ length so `unit_default` cannot stand in.                                                                                                     |

**`is_bodyweight` moves to `entry_sets`** — the UX panel's finding, and it overturns ADR 0004 §4's
"varies per set? No". Two independent reasons:

1. **The movement field is free text.** A kid typing "Pushups" (seed slug is `push_up`) creates a new
   movement that `findOrCreateMovementId` hardcodes `isBodyweight: false` — so the weight becomes required
   with **no chip left to escape with**, on a gym floor. The client cannot know the flag at typing time
   anyway; gating on it needs a movement _picker_, which does not exist.
2. **The vest.** Four YDP movements are bodyweight-**or**-loaded, sometimes in the same session. "Push-ups
   with the vest today" vs "push-ups plain" is the same movement on consecutive days, so bodyweight is
   genuinely a property of the _set_.

The movement flag can still drive the **default**, once a picker exists.

**The invariant claim needs weakening or a mechanism.** "An FK + CHECK, not a convention" is not
achievable as written — a CHECK cannot read another table, and an FK → `units.code` cannot constrain
dimension. Either add `UNIQUE (code, dimension)` on `units` plus a stored dimension column per measure and
a **composite FK**, or concede it is writer-enforced (the `prescription_targets` household precedent) and
drop the claim.

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

**The `weight_label` fallout, inventoried properly.** An earlier draft named only `parseLoad`,
`CANONICAL_LOAD_LABELS` and `LoadChips`. The panel found six more, and two are data-integrity issues
rather than cleanup:

- **`formatSetLine`** — `weightLabel ?? \`${weight} ${unit}\`` (`set-display.ts:14`). Drop the column
without shipping the backfill *and* a new formatter in the same deploy and every historical `BW`/`30in`
  set renders **"10 × ? lb"**.
- **`isEditableSet`** (`set-display.ts:34`) and **`updateStrengthSetById`**'s `isNull(weightLabel)`
  (`writers/strength-session.ts:373`) both gate on the label being null. After the drop, **every
  historical labeled set silently becomes editable** — including the `30in` and `20s` ones whose own
  docblock says a numeric edit would mask their value. That is a data-integrity regression wearing a UI
  hat, and it must be an explicit contract-deploy task.
- The writer's `'weightLabel' in s` branch · `set-fields.tsx`'s whole `mode: 'numeric' | 'load'` prop and
  its `inputMode="text"`, which exist _only_ for labels and should collapse · `db:verify`'s labeled
  fixtures · and **`entries.raw_load`**, a second verbatim column the plan had never mentioned.

### 7.5 Migration shape

Expand → backfill → contract, across separate deploys, per AGENTS.md:

1. **Expand** — add the columns and the `units` rows; `weight_label` untouched. New NOT NULLs arrive as
   `CHECK … NOT VALID` → backfill → `VALIDATE`. Every new ref column gets a covering index. `SET
lock_timeout` + `statement_timeout`.
2. **Backfill** — parse the existing `weight_label` rows into the typed columns in bounded batches.
   `BW` → `is_bodyweight`; `band` → `is_band`; `30in` → height; `123 (50ft)` → weight + distance.
3. **Contract, in a LATER deploy** — drop `weight_label`, and `parseLoad` loses its label branch.

⚠️ **An earlier draft justified step 3 by saying "Squawk hard-fails a `DROP COLUMN` alongside app code,
which is the rule working as intended." There is no Squawk in CI.** The panel checked; the audit is in
[tech-debt](../tech-debt.md) and AGENTS.md is corrected. Also absent: the Neon-branch apply and the
forward-only guard that blocks an edited migration. **This migration therefore has no mechanical
protection at all** beyond the drift guard and `db:verify` (which runs on PGlite and cannot prove lock
behaviour, `VALIDATE` timing or `CONCURRENTLY`). Wire the forward-only guard and Squawk **before** the
migration lands, or stop citing them.

**Backfill specifics the draft omitted:** it parses _prod_ `weight_label` rows, not the census corpus —
and prod holds whatever `parseLoad`'s permissive fallthrough accepted (`75 x 4`, `seventy five pounds`).
State that an unparseable label **keeps `weight_label` and leaves the typed columns NULL**, write the
backfill idempotently (`WHERE <col> IS NULL`, bounded by id), and **gate the contract deploy** on
`count(*) WHERE weight_label IS NOT NULL AND weight_num IS NULL AND NOT is_bodyweight AND NOT is_band` = 0.
Note DML inside a migration file runs in migrate's transaction, so "bounded batches" is fiction unless the
backfill is a separate script. Four of the census's twelve shapes (`BW (unassisted)`, `BW (modified)`,
`30 (2x 15 DB)`) still have **no destination** — say where they go.

`CANONICAL_LOAD_LABELS` / `LoadChips` are superseded by the booleans — but the chips' _ergonomic_
argument survives (a one-tap affordance beats typing on a phone, and iOS's numeric pad has no letters),
so it carries over to the new controls rather than being deleted.

### 7.6 Open questions — after the panel

1. ~~**Q1: fixed columns or a typed child table?**~~ **DECIDED 2026-09-24 — the child table** (§7.2a).
   ~~**Sub-fork (§7.2b): ALL loads or only auxiliary?**~~ **DECIDED — (A), all loads.** Remaining:
   **what the plain-barbell slot is called**, since ~every historical row backfills into it.
   **And §7.2c: how a coach declares a movement's slot set** — V1-22's problem, and it widens that plan.
2. **Stance in Motion: movement or metric?** §7.2. As a _movement_ its duration uses the `seconds` column
   this plan already activates and it becomes prescribable; as a _metric_ it is unprescribable and the
   YDP progression rule cannot be expressed. If the metric route is kept, **YDP-2 moves back out of GAP-3**
   into its own row with the app scope stated.
3. Does the **household magnitude preference** exist, or does this PR create it? Nothing reads
   `movements.unit_default` today, and `weight_unit` has no deterministic resolution without it.
4. `per_side` on the prescription, given `3x10 (5/5) @ 20` puts it in `prescribed` _text_?
5. Where do `BW (unassisted)`, `BW (modified)` and `30 (2x 15 DB)` land? (`entries.notes`, via V1-9a?)
6. Does the new logging surface need its own UX panel, or does it ride V1-5's check-in form?

### 7.6a Scope — six PRs, resized after decision (A)

(A) makes the backfill cover **every logged set**, not just stance sets, so step 4 is no longer small.

|     | PR                                                                             | Risk seam                                                                                                                                                                                               |
| --- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Wire the missing CI gates** — forward-only guard + Squawk                    | **Now a prerequisite, not a follow-on.** (A) ends in a `DROP COLUMN` on a column with live data in every set, and nothing in CI would stop it landing beside app code ([audit](../tech-debt.md), #132). |
| 2   | `units.dimension` + the length codes, **shared-const first**                   | No behaviour change.                                                                                                                                                                                    |
| 3   | `entry_set_loads` + `load_slots` + the `entry_sets` booleans — **expand only** | Nothing reads it yet.                                                                                                                                                                                   |
| 4   | Backfill every set into the child table                                        | A script, not a migration file — DML inside a migration runs in migrate's transaction, so "bounded batches" is fiction otherwise.                                                                       |
| 5   | The form/parse/read rewrite                                                    | **Needs its own UX panel** — the numeric keypad returns, `LoadChips` is replaced, and the set row changes shape.                                                                                        |
| 6   | Contract: drop `weight_num`/`weight_unit`/`weight_label`                       | Separate deploy, gated on a zero-unmigrated-rows check, shipping the `formatSetLine` and `isEditableSet` fixes in the same one.                                                                         |

### 7.7 File-by-file — see the per-PR plans

This arc doc holds the census and the design; the file-by-file lives with each PR, per
[plans/README.md](./README.md).

| PR                            | Plan                                                                   | State                   |
| ----------------------------- | ---------------------------------------------------------------------- | ----------------------- |
| 1a/1b CI gates                | [gap3-pr1-ci-gates.md](./gap3-pr1-ci-gates.md)                         | ✅ merged (#133, #135)  |
| 2 `units.dimension`           | —                                                                      | ✅ merged (#137)        |
| 3 the typed model + the drops | [gap3-pr3-entry-set-quantities.md](./gap3-pr3-entry-set-quantities.md) | in review               |
| 4 the form/UX rewrite         | _to be written_                                                        | needs the full UX panel |

**⚠️ §7.6a's six PRs became four.** PRs 4 (backfill) and 6 (contract) are **deleted**: their whole
justification was `weight_num` holding live data, and prod's `entry_sets` is **empty** (verified
2026-09-23 — sets 0, labeled 0, numeric_loads 0). Expand→contract protects data across a deploy
window; there is no data and no intervening deploy, so PR 3 creates the tables and drops the
free-text columns in one migration.

## 8. Review-response log (adversarial panel)

Three lenses run 2026-09-23 **before implementation**, with a **dedicated DB-safety reviewer** as
AGENTS.md requires for a migration, plus the UX panel ADR 0004 mandates. Every finding re-verified against
the tree before acceptance.

### Blocking

| #   | Lens        | Critique                                                                                                                                                                                                    | Response                                                                                                                                                                                                                          |
| --- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | DB-safety   | §7.5's safety argument cites **Squawk, which is not in CI** — nor are the Neon-branch apply or the forward-only guard.                                                                                      | **Accepted, and it is bigger than this plan.** Verified; AGENTS.md claimed five gates that do not exist. Audited and corrected separately (#132). §7.5 now says this migration has no mechanical protection until they are wired. |
| B2  | DB-safety   | "Resolved from the movement's declared dimension" **has no source** — `movements` has no `dimension` column, only a nullable `unit_default` that is NULL for every bodyweight movement.                     | **Accepted.** `movements.dimension` added to §7.3.                                                                                                                                                                                |
| B3  | DB-safety   | "An FK + CHECK, not a convention" is **not achievable** — a CHECK cannot read another table.                                                                                                                | **Accepted.** §7.3 now offers the composite-FK mechanism or concedes writer-enforcement; the unqualified claim is gone.                                                                                                           |
| B4  | Correctness | **§7.2's scope reduction is half-wrong.** A metric-modelled Stance in Motion is **unprescribable** (`prescriptions.movementId` is NOT NULL FK → `movements`), yet the YDP seed gives it a progression rule. | **Accepted — retracted, not edited.** Verified at `schema.ts:499-501` and `seed.json:95`. §7.2 now records the retraction, because a claim that _removes_ work is exactly the kind that should not vanish quietly.                |
| B5  | Correctness | §7.3 **contradicts its own column count**, and the set-level column should be **primary, not an override** — ad-hoc logging has no prescription.                                                            | **Accepted.** §7.3 inverted: the prescription is the plan, the set is the fact.                                                                                                                                                   |
| B6  | UX          | `movements.is_bodyweight` **cannot gate this form** — the movement field is free text, and a kid typing "Pushups" gets `is_bodyweight=false` with no chip to escape with.                                   | **Accepted.** `is_bodyweight` moves to `entry_sets`, overturning ADR 0004 §4.                                                                                                                                                     |
| B7  | UX          | **The vest.** Four YDP movements are bodyweight-or-loaded _in the same session_, which kills bodyweight-as-movement-property independently of B6.                                                           | **Accepted** — the second, stronger reason for the same move.                                                                                                                                                                     |

### Major — all accepted

`units.dimension` needs the full **shared-const → zod → seed → `db:verify` parity** treatment, and the
length codes belong in `UNIT_CODES`, not in a raw migration insert · the **backfill parses prod labels,
not the census corpus**, is non-total, and needs an explicit unparseable-row rule plus a gate on the
contract deploy · **six more `weight_label` consumers**, two of them data-integrity (`formatSetLine`
blanking history; `isEditableSet` silently making every labeled set editable) · the set-level override
columns had **no names, types or precision** · pairing CHECKs existed only in prose · **five PRs, not
one** · the seed's `onConflictDoNothing` would leave existing `units` rows with `dimension = NULL` forever.

### Pushed back — partially

| #   | Lens        | Critique                                                                  | Response                                                                                                                                                                                                                                                                                               |
| --- | ----------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P1  | Correctness | §7.1 overstates the census: A and C are _confirmations_, not corrections. | **Accepted on the facts, and §7.1 now says so** — one genuine correction (B), two confirmations. Recorded as a pushback only because the confirmations still earn their place: ADR 0004 argued A from first principles, and a census that independently confirms it is evidence, not filler.           |
| P2  | Correctness | Prefer the typed child table outright.                                    | **Not decided here.** It is now **§7.6 Q1, the plan's largest fork**, with the panel's argument stated in §7.2a — including the question the fixed-column design must answer. Deciding a schema shape inside a review-response row would be exactly the kind of quiet call this log exists to prevent. |
