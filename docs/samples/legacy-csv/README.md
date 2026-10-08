# Legacy CSV samples — the GAP-3 evidence set

**Provenance: SYNTHESISED from real files.** Derived from Ray's workflow repo
(`bakers-wrestling-context/data/`) on 2020-09-18, then scrubbed before merge — athlete names, dates and
bodyweight _values_ are replaced. **Every measurement shape is verbatim and every row is preserved**
(44 strength rows, 14 weigh-ins), because the shapes are the entire point.

**What was kept, and why exactly:** a taxonomy of 68 distinct shapes across `load`, `reps`, `sets`,
`prescribed` and `session_type` was extracted **before** the scrub and diffed **after** — byte-identical.
The `load` column still carries `BW`, `BW (unassisted)`, `BW+8 (vest)`, `30in`, `20s`, `123 (50ft)`,
`30 (2x 15 DB)`, `65/65/65`, `band` and `SKIPPED`; `reps` still carries `4/3/4/2` and `sub-failure`; the
weigh-ins still carry all three numeric formats (`92`, `92.0`, `91.7`). Frequency was preserved too —
ADR 0004's stated worry was _"a `distance_unit` for one sled row while missing something that appears
thirty times,"_ which a shape list alone would not answer.

**Why scrubbed:** the real files were a named minor's bodyweight time series plus complete training
logs, in a repo headed for public release. See the OSS-1 audit revision in
[plan.md](../../plan.md). The evidentiary value lives in the shape vocabulary, not in which child
weighed what on which date — so synthesis costs nothing and removes the exposure.

These are the **four legacy CSV samples** that [ADR 0004](../../decisions/0004-typed-measurements.md)
and [csv-export-contract.md](../../csv-export-contract.md) are blocked on:

> _"The implementation plan is deliberately not written yet. It waits on the four legacy CSV samples
> that block V1-13 — those samples are the evidence for **which shapes actually occur**, and designing
> columns without them risks building a `distance_unit` for one sled row while missing something that
> appears thirty times."_

> _"Sequencing: legacy CSV samples → GAP-3 plan + panels → GAP-3 → V1-13. The samples are currently
> the highest-leverage unblock in the backlog, and they are a 'find four files' task, not
> engineering."_

**This directory clears that blocker.**

## What is here

| Type                                   | Files                              | State                                              |
| -------------------------------------- | ---------------------------------- | -------------------------------------------------- |
| `strength-log/<athlete>/<YYYY-MM>.csv` | 4 (two athletes × June, July 2026) | **Synthesised** — shapes verbatim, values replaced |
| `bodyweight/<athlete>/<YYYY-MM>.csv`   | 2 (July 2026)                      | **Synthesised** — shapes verbatim, values replaced |
| `checkins/<athlete>/<YYYY-MM>.csv`     | 2                                  | **Header-only** — zero rows ever written           |
| `calisthenics-log/…`                   | —                                  | **Does not exist.** Proposed only                  |

<sub>These two cells read **"Real data"** until PRIV-1 (2026-10-07), which contradicted the
provenance paragraph at the top of this file and made it impossible to tell, from this README alone,
whether the committed weigh-in rows are a child's actual measurements. They are not; the shapes are
real and the values are replaced. The wording now agrees with the provenance.</sub>

The fourth type is absent on purpose, and that absence is itself the finding the contract records:
with no real rows to match, **calisthenics-log is the one schema the app gets to define rather than
match.**

## Why these matter — the shapes are already visible

Six rows of `strength-log/athlete-a/2020-06.csv` contain the entire argument for typed measurements. The
`load` column alone holds:

- `BW` — a bodyweight marker, not a number
- `20`, `15` — a weight in pounds
- `30s` — **a duration**, in the same column as the weights

That is ADR 0004's central claim as raw evidence: one `load` string is being asked to encode
different physical quantities, and no numeric column can hold all three.

The `prescribed` column carries shapes that must never reach `load`: `3x10 (5/5) @ 20` — sets, reps,
a per-side split, and a target weight in one string. The contract already flags `~`/range values
belonging to `prescribed` as "the single most likely column mix-up."

`notes` uses the em dash `—` (U+2014) in running prose.

## What these are NOT for — no historical import

**Decision (Ray, 2020-09-18): importing a family's historical logged data is not a product goal.** A
new household onboards by entering their program going forward; they already know the loads their
child uses, so there is nothing they must retrieve from an old app or spreadsheet to get started.

**Do not conflate this with ONB-1.** Two different imports, and only one of them exists:

| Import                                                         | Direction                        | Status                                                          |
| -------------------------------------------------------------- | -------------------------------- | --------------------------------------------------------------- |
| A **program** — prescriptions, targets, the plan going forward | ONB-1's "bring-your-own-program" | **A goal.** Structured plan shape only; refuses free-form prose |
| **History** — sets someone already performed in another tool   | —                                | **Not a goal.** No path, not planned                            |

**What that deletes:** the split-on-import problem. The `65/65/65` and `4/3/4/2` shapes below pack N
sets into one cell, and the app's `entry_sets` is one row per set — so an import path would have had to
**split** them. Without an import path, that code is never written, and these files stay what this
README says they are: evidence for column design, never an input.

**What it does NOT delete:** the _export_ side. See below.

## The packing rule is not deterministic — a V1-13 finding

The legacy row grain is **movement-per-day**, not per-set:

```
2020-06-02,trainer,back-squat,3,3,65/65/65,5x3 progressive,SUBMAX — could have done 70 cleanly …
```

One row, `sets=3`, three loads. So **CSV export is an aggregation, not a column projection** —
`entry_sets` rows must be re-packed into one cell to keep the row grain the `/retro` workflow reads.

And the legacy packing is **inconsistent**, because a human maintained it by hand:

| Row                          | Uniform?     | Written as |
| ---------------------------- | ------------ | ---------- |
| `sets=3 reps=3`              | reps uniform | scalar `3` |
| `sets=4 reps=4/4/4/4`        | reps uniform | **list**   |
| `sets=4 load=55/55/55/55`    | load uniform | **list**   |
| `sets=5 load=70/75/75/75/80` | load varies  | list       |

A uniform value is _sometimes_ a scalar and _sometimes_ a repeated list. **So a byte-faithful
round-trip of these historical files is impossible** — nothing in normalized data records which form a
human would have chosen. Two consequences for **V1-13**:

1. The export contract must **choose a canonical rule** (the obvious one: list when it varies, scalar
   when uniform) and state it, rather than inheriting "match the legacy bytes."
2. The golden-file test must compare against **generated** expected output under that rule — **not**
   against these sample files, which would fail on rows like `4/4/4/4` through no fault of the code.

**Consequence for the Claude workflow, not the app:** history stays hand-written and inconsistent while
new exports are canonical, so the reading skill will see both forms and must tolerate both. That is a
skill-side note, recorded here so it is not discovered as an export bug.

## Handling

✅ **Cleared for public release.** No real athlete names, no real dates, no real bodyweight values. The
scrub happened **before this ever reached `main`**, so nothing identifying entered the history of the
default branch — which was the whole reason to do it at this moment rather than during OSS-1, when the
only remaining fix would have been a `git-filter-repo` rewrite.

**Do not "restore" the real values.** If a future question needs the originals, they live in Ray's
private workflow repo; consult them there and bring back only the shape, never the row.

**Not fixtures.** Nothing here should be used as seed or test-fixture data, and — per the decision
above — nothing here is ever imported. Its only job is to be evidence for the GAP-3 column design.

**Verifying a future edit.** If these files are ever regenerated or extended, re-run the shape diff
that guarded this scrub: extract the distinct values of `load`, `reps`, `sets`, `prescribed` and
`session_type` before and after, and require them byte-identical. That check caught a real truncation
bug during the original scrub — the row counts looked plausible while four files had silently emptied.
