# V1-13 — CSV export (the MVP's whole point)

> Backlog: [plan.md](../plan.md) row V1-13. Branch: `feat/v1-13-csv-export` (off `main`).
> **Contract: [csv-export-contract.md](../csv-export-contract.md)** — authoritative, sourced from Ray's
> real workflow repo. Significant PR → committed plan + adversarial panel before implementation.

## Goal

`docs/status.md` states the MVP as "kids log a full day online **+ CSV export keeps the Claude workflow
alive**". Everything else in v1 exists to make the first half true; this PR is the second half. Until it
ships, adopting the app means abandoning the `/retro` workflow that reads these files.

The bar is **byte-faithfulness**, not "a reasonable CSV". These files are parsed by existing skills; an
export that differs by a column, a separator, or a trailing newline breaks them **silently**.

## What the contract changed (read it first — this plan assumes it)

Five assumptions were wrong; each would have shipped a broken file. The two with **schema consequences**
are the reason this needs a plan rather than a straight implementation:

### C1 — RESOLVED by Ray (2026-08-10): prefer the float, convert the legacy data

The contract's bodyweight column mixes `71`, `71.0`, `71.4` — the operator's literal keystrokes — and
`entries.value_num` is `numeric(8,3)`, so `71` reads back `71.000`. The plan had been to plumb the raw
string past `z.coerce.number()` so the keystrokes could round-trip.

**Ray's call:** _"we should always prefer the float. If existing data in the CSV needs to be converted,
we should convert it."_

So: **`value_num` is the source of truth, and the legacy files are normalised once to match.** No
`raw_load` plumbing, no migration, no keystroke fidelity. This is a deliberate, narrow relaxation of
byte-faithfulness applied to **numeric normalisation only** — it does not extend to `BW`/`band`/`SKIPPED`,
which carry meaning a number cannot (see [csv-recording-gaps.md](../csv-recording-gaps.md)).

**Still open, and it must be settled before the fixtures are frozen:** what is the canonical rendering?
`71` → `71.0` (always one decimal, matching the 0.1 lb recording granularity) is the obvious choice, but
it changes every existing bodyweight row, so **Ray confirms it, not the panel.** The bodyweight golden
fixture is therefore _generated_, not copied verbatim — the one fixture that isn't a byte-copy.

### C2 — `~`/range loads live in `prescribed`, not `load`

`~75-85`, `BW +5`, `35-45/hand` — the exact strings Ray authored in the V1-10 program seed — **never
appear in the `load` column**. They belong in `prescribed`. So:

- `load` ← what was **performed** (from `entry_sets`)
- `prescribed` ← the **plan**, built from `prescription.sets` / `target_reps` /
  `prescription_target.load`, formatted `SETSxREPS [@ load]`

This is the single most likely column mix-up, and it means the export **joins to the programming tables**
(V1-10), not just to entries. **Open Q:** what does `prescribed` contain for a logged movement with no
matching prescription — empty, or omitted? (Most logged rows today have no program row at all.)

## Design decisions

**D1 — A Route Handler, not a Server Action.** AGENTS.md: reads/external/batch → Route Handlers.
`GET /api/export/csv?kind=…&athlete=…&month=…`. `runtime = 'nodejs'` (pg). Returns `text/csv`.

**D2 — The formatter is PURE and lives in `packages/shared`.** `(rows) => string`, no DB, no IO — so the
golden-file tests are fast unit tests, not integration tests, and a later Python port has a reference.
The DAL supplies rows; the formatter owns every byte.

**D3 — Write raw; never use a CSV library.** The contract is explicit and the reason is concrete: a real
row carries bare `"` inch marks (`Liam at 30" box`) and another an unescaped comma. RFC-4180 writers
re-escape both. Join with `,`, `\n` line endings, trailing newline, UTF-8 no BOM, em dash preserved.
**A lint/test must assert no CSV library is imported by the formatter** — this is the rule most likely to
be "helpfully" undone later.

**D4 — Aggregate per-set rows → one row per movement.** `sets` = count; `reps`/`load` are a scalar when
uniform, else a slash-list of exactly `sets` elements. **Uniform lists collapse** (`5/5/5` → `5`). Pure,
heavily unit-tested — this is where the subtle bugs live.

**D5 — Golden fixtures are committed verbatim** at `packages/shared/src/csv/__fixtures__/`, byte-for-byte
from the contract. The test diffs the formatter's output against them. Any change to a fixture is a
deliberate contract change and must be reviewed as such.

**D6 — Plus the arity assertion the golden diff cannot make.** Ray's point: all eight real files would
pass a byte-diff while carrying a slash-list whose element count disagrees with `sets`. So the test
asserts `sets === splitList(reps).length` (and `load`) independently of the diff.

**D7 — Value mappings, all in the export layer (never the DB):**

- `session_type`: `strength_a` → `strength-a` (column names use `_`, values use `-`)
- `movement`: `movementSlug(name).replace(/_/g, '-')` — our slugs are `front_squat`, the CSV wants
  `front-squat`. **Open Q:** verify against every seeded movement; `trap-bar_deadlift` →
  `trap-bar-deadlift` looks right but `pull-up` must not become `pull--up`.
- `SKIPPED` (uppercase) into `load` with `sets=0,reps=0` when `status='skipped'`
- `sub-failure` into `reps` when `status='sub_failure'`

**D8 — Scope: one athlete, one month, one kind per request.** Matches the file layout
(`data/<type>/<athlete>/<YYYY-MM>.csv`). No zip, no all-kinds endpoint — the skills read one file at a
time. `calisthenics` is the app's to define (nothing exists on disk), so it ships as specified.

**D9 — Tests.** Unit: the formatter against the golden fixtures (all four kinds), the aggregation
transform (uniform collapse, arity, skipped, sub-failure, timed), the value mappings. Boundary: unknown
`kind`/`athlete`/`month` → typed rejection, not a 500; a month with no rows → **header-only file with a
trailing newline** (the real checkins files are exactly this). Rate limiting is out of scope (reads;
see V1-14a's tech-debt entry).

## Out of scope (→ later)

The V1-14b full-day E2E (its own PR, needs this); writing files to disk (this returns a response body —
how it reaches the repo is Ray's workflow); the 5 no-legacy-CSV activities (wake, wrestling_practice,
rice_bucket, splits, brain_rep) which stay app-only until the v3 API; auth on the endpoint (v1.5/Clerk).

## Open questions for the panel

1. **C1 is fully resolved** — prefer the float, exactly one decimal (`toFixed(1)`), no snapping. Nothing
   left for the panel here beyond confirming the input/export granularity assertion is worth having.
2. **C2** — `prescribed` for a movement with no matching prescription: empty string, or is the whole
   column only populated when a program row exists?
3. Should the endpoint stream (`ReadableStream`) or buffer? A month is ~40 rows — buffering seems
   obviously right, but confirm nothing in the contract implies otherwise.
4. `movement` slug → hyphen mapping: is a blanket `_`→`-` safe across the whole seeded catalog?
5. Does `athlete` in the path come from the profile's **name** (`liam`) or its public id? The contract
   shows `data/strength-log/<athlete>/` — a human-readable directory. Exposing a name is fine (it is
   Ray's own repo), but the endpoint parameter should probably still be the public id, mapped at the
   edge.
