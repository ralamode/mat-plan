# ADR 0004 — Typed measurements: kill the free-text load

**Status:** Accepted (shape) · **Date:** 2026-08-26 · **Scope:** GAP-3 · **Supersedes:** the free-text
half of GAP-1 P0-2

> **The implementation plan is deliberately not written yet.** It waits on the four legacy CSV samples
> that block V1-13 — those samples are the evidence for _which shapes actually occur_, and designing
> columns without them risks building a `distance_unit` for one sled row while missing something that
> appears thirty times. This ADR records the **decision and its rationale** so the reasoning survives;
> the file-by-file plan (with the engineering and UX panels AGENTS.md requires) follows the samples.

> ## ⚠️ Superseded in part — implemented 2026-09-23 (migration `0011`)
>
> The core decisions hold: a performed value is a typed measurement (§1), prescribed and performed
> diverge (§2), units are safe by construction with the resolved unit stored ON THE ROW (§6), and
> `band` is a boolean (§7). **Three things were overturned by the shape census and its adversarial
> panel** — see [the census](../plans/gap3-typed-measurements.md) and
> [the PR plan](../plans/gap3-pr3-entry-set-quantities.md):
>
> 1. **§4's "`is_bodyweight` varies per set? No" is WRONG.** The movement field is free text, so a kid
>    typing "Pushups" creates a movement with `isBodyweight: false` and no escape chip; and four YDP
>    movements are bodyweight-**or**-vested in the same session. It is a boolean on `entry_sets`.
> 2. **§5's "distance/height: prescription is the home, set-level is a nullable override" is DEAD.**
>    Fixed per-dimension columns had already overflowed on the second real program (three worn loads on
>    one movement). Every value+unit quantity is a row in `entry_set_quantities`, keyed by a controlled
>    ROLE vocabulary — and the set, not the prescription, is where the fact lives, because ad-hoc
>    logging has no prescription at all.
> 3. **The four dimensions in §6 were incomplete** (`bool` and `timing` fit none of them), and
>    `UNIT_CODES` had no length dimension whatsoever — which is most of why a box-jump height ended up
>    inside a string.

## Context

GAP-1 P0-2 made text loads writable — `entry_sets.weight_label`, a `type="text"` input, and
`parseLoad` interpreting one `weight` field as either a number or a label. It closed a real gap: a
bodyweight movement was exporting `0` instead of `BW`.

It also left a permissive fallthrough. `parseLoad` rejects the dangerous shapes explicitly — `~75`,
`35-45/hand`, `12-15` are blocked by `PRESCRIPTION_SHAPE` with _"Log what you actually lifted — not a
range or a target"_, and `1e3`/`0x10`/`SKIPPED` each have their own guard — but **anything else that
isn't a number becomes a text label**. So `75 x 4` and `seventy five pounds` are both storable, and a
single `load` string had to encode three different physical quantities: `30in` (a height), `20s` (a
duration), `123 (50ft)` (a weight _and_ a distance, joined by a parenthetical hack).

Ray's call (2026-08-26): **no free-text loads.** Normal typed form fields where a field makes sense.

## Decision

### 1. A performed value is a typed measurement, never a string

No field in the log path holds letters. Consequence worth stating plainly: the **numeric keypad comes
back everywhere**, which is what P0-2's `inputMode="text"` had to give up (the iOS decimal pad has no
letters, so `BW` was unenterable without it — see `load-chips.tsx`).

### 2. Prescribed and performed diverge, deliberately

A **prescription is a target and may legitimately be a range** (`75-85` means "work in this band"). A
**performance is a single fact.** So `prescription_targets.load` keeping range/approximation shapes is
not an inconsistency — it is the two things being different. Structuring prescribed loads into
`min`/`max`/`per_side` is a separate, later question, explicitly **out of scope here**.

`parseLoad`'s existing `PRESCRIPTION_SHAPE` guard already enforces this boundary and stays.

### 3. Import normalizes to our schema — never the reverse

_(Ray: "when they upload their CSV it could look any way; we need AI to scrape the data and normalize
it to fit our system, not the other way around.")_

The extractor's job is **conformance**, not accommodation. A value that cannot be normalized into a
typed field is surfaced for a human — it is **never** stored as a string "for later". This is what
stops import from silently re-widening the schema every time someone uploads an odd sheet, and it is
the reason a native user (who authors and performs in the app) can never produce these shapes at all.

Recorded as ONB-1 **R7a-1**.

### 4. Where a value lives — the varies-per-set test

> A value belongs on the **set** only if it can legitimately vary from the prescription in a way worth
> recording. Otherwise it belongs further up.

| Value        | Varies per set?                              | Home                                           |
| ------------ | -------------------------------------------- | ---------------------------------------------- |
| Weight       | Constantly                                   | **Set** — `weight_num` + `weight_unit`         |
| Reps         | Constantly                                   | **Set** — exists                               |
| Duration     | Yes (held 15s, not the prescribed 20s)       | **Set** — `seconds` exists, **zero writers**   |
| Band         | Yes (you drop the band as you get stronger)  | **Set** — `is_band` boolean                    |
| **Distance** | **Essentially never — you push to the line** | **Prescription**, set-level override           |
| **Height**   | Arguable — usually make-or-miss              | **Prescription**, set-level override           |
| Per-side     | No — it is how the movement is done          | Prescription / movement                        |
| Bodyweight   | No                                           | **`movements.is_bodyweight` — already exists** |

This test is what shrank the change: `entry_sets` gains **four** columns
(`weight_num` is already there; `weight_unit`, `is_band`, plus the distance/height overrides) rather
than the ten an earlier sketch proposed. A set row records **what varied**, not a constant restated on
every row.

Ray's framing, which produced the test: _"50ft sled push × 3 might be three rows with a numeric field
for weight (sled weight)"_ — the 50 ft is part of what the movement **is**, prescribed once; the sled
weight is what you actually did, three times.

### 5. Distance/height: prescription is the home, set-level is a nullable override

Two candidates were rejected:

- **Prescription-only.** Breaks ad-hoc logging — a movement performed with no prescription would have
  nowhere to record 50 ft, and "you can log without a plan" is a stated goal (ONB-1 R20). That is the
  _common_ case for a new household.
- **Fold it into movement identity** ("Sled push (50 ft)" as a catalog entry). Cheapest schema — zero
  new columns — but it **fragments history**: 50 ft and 100 ft become unrelated movements with
  separate progression lookups. That is precisely the defect ONB-1 R12a spends a migration to prevent
  (`RDL` vs `Romanian deadlift`); reintroducing it deliberately would be incoherent.

The override columns are almost always NULL. That is fine — "override only when it differs" is a
well-worn pattern, and the alternative costs either correctness or ad-hoc logging.

### 6. Units — safe by construction, not by care

1. **Never typed, never inferred.** Units come from the `units` reference table (exists;
   `movements.unit_default` FKs to it and **nothing reads it**).
2. **The movement declares the _dimension_.** Box jump → length. Sled → mass + length. Hold → time.
   The user is never asked "is this a weight or a height."
3. **The household sets the _magnitude_ preference once** — lb/kg, in/cm. Not per set.
4. **Store the resolved unit ON THE ROW, and never convert on write.**

Rule 4 is the one that prevents the dangerous failure. If only a household preference is stored and
that preference later changes, **every historical number silently reinterprets** — 45 lb becomes 45 kg.
That is the 2.2× error class from ONB-1 R9, and a per-row unit makes it unrepresentable. Storing what
was entered (rather than a converted canonical) also keeps CSV export byte-faithful.

**What makes this an invariant rather than a convention:** give `units` a **`dimension`** column
(`mass` / `length` / `time` / `count`). A height field then accepts only a length unit — putting `lb`
in a box-jump height is rejected by FK + CHECK, not merely discouraged.

`UNIT_CODES` is `['lb','kg','count','sec','min','bool','timing']` — **there is no length dimension at
all.** `in`, `cm`, `ft`, `m`, `yd` are all new. This absorbs what was briefly filed as UNIT-1.

### 7. `band` is a boolean, and the note says which one

`band` is not a quantity and is **not exclusive with bodyweight** (a band-assisted pull-up is both), so
it is its own boolean rather than a member of a `load_kind` enum.

A boolean alone is a half-answer — it records _that_ a band was used, not _which_. The detail lands in
**`entries.notes`**, which already exists (`schema.ts:142`) with **zero writers**; **V1-9a** is the
queued UI for it. **GAP-3 therefore depends on V1-9a.**

Granularity accepted: `entries.notes` is per-entry (per movement per day), not per set, so "band on
sets 3–4 only" is not representable. Judged not worth a per-set notes column.

## The mapping

| Shape today                     | Typed columns                                                                       |
| ------------------------------- | ----------------------------------------------------------------------------------- |
| `62.5`                          | `weight_num=62.5, weight_unit=lb`                                                   |
| `BW`                            | `movements.is_bodyweight` (already)                                                 |
| `BW+8 (vest)`                   | `is_bodyweight` + `weight_num=8, weight_unit=lb` — **not representable today**      |
| `band`                          | `is_band=true` (+ `entries.notes` for which)                                        |
| `30in`                          | prescription `height_num=30, height_unit=in`                                        |
| `20s`                           | `seconds=20`                                                                        |
| `123 (50ft)`                    | `weight_num=123, weight_unit=lb` + prescription `distance_num=50, distance_unit=ft` |
| `40/hand`                       | `weight_num=40` + prescription `per_side=true`                                      |
| Weighted box jump               | prescription `height_num=30, height_unit=in` + set `weight_num=20`                  |
| `75 x 4`, `seventy five pounds` | **Rejected.** No longer representable                                               |

The weighted box jump needs **no special case** — it is two dimensions on one row, which the single
string could not express. That is the tell that the model is right.

## Consequences

- **CSV export formats from typed columns.** `30in` and `123 (50ft)` become _generated_ output, not
  stored strings — so the format cannot drift and is unit-testable. This is strictly better than
  round-tripping a verbatim string, but it means **V1-13 should export from the new model**: doing
  V1-13 first means writing the formatter twice.
- **Sequencing:** legacy CSV samples → GAP-3 plan + panels → GAP-3 → V1-13. The samples are currently
  the highest-leverage unblock in the backlog, and they are a "find four files" task, not engineering.
- **Expand → contract.** `entry_sets.weight_label` has live rows; the migration adds columns,
  backfills, and drops the text path in a later deploy. Never in one step (AGENTS.md).
- **`parseLoad` loses its label branch** and becomes numeric-only. `CANONICAL_LOAD_LABELS` /
  `LoadChips` are superseded by the bodyweight/band booleans — the chips' _ergonomic_ argument (a
  one-tap affordance beats typing on a phone) survives and should carry over to the new controls.
- **GAP-1 P0-2 is partially reversed, on purpose.** Its diagnosis was right (a bodyweight movement
  must not export `0`); its remedy — one text field — is what this replaces. The `PRESCRIPTION_SHAPE`
  guard it introduced is kept and is load-bearing.
- **UI change ⇒ UX panel before implementation** (AGENTS.md), on top of the engineering panel the
  migration requires.
