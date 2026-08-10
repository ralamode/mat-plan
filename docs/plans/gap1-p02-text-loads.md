# GAP-1 P0-2 — text loads (`BW`, `band`, `30in`, `30s`)

> Backlog: [plan.md](../plan.md) row GAP-1 · analysis: `csv-recording-gaps.md` (PR #86, unmerged).
> Branch: `feat/gap1-text-timed-loads` (off `main`). **No migration** — the column already exists.
> Significant (changes a shared write contract + the log form) → committed plan + panel before code.

## Goal

**Today the app records a lie.** A pull-up, a dip, a hollow-body hold — every bodyweight movement in
Ray's seeded program — logs as `weight: 0`, because `strengthSetSchema` accepts only a number. The kid
did bodyweight work; the record says zero.

`entry_sets.weight_label` exists for exactly this (`'BW', '50ft', etc.`) and the **read path already
handles it**: `formatSetLine` gives `weightLabel` priority over `weight`, and `isEditableSet` already
excludes labeled sets from the V1-9 inline edit. **Only the write side is missing.**

## Acceptance

- A set can be logged as `BW`, `band`, or free text (`30in`, `30s`, `BW+8 (vest)`), and reads back as
  `Pull-Up — 5 × BW`.
- **The numeric path is byte-identical to today**, including its error messages.
- **The V1-9 edit form is untouched** and still numeric-only.
- A blank load is still rejected — never stored, never rendered as an empty label.
- Entering a label is possible **on an iPhone** (see B2 — this is not a given).

## What the panel changed (5 BLOCKING; full log at the end)

The first draft proposed one `type="text" inputMode="decimal"` field with "parses as a number → numeric,
otherwise → label". Every part of that was wrong:

### B1 — `inputMode="decimal"` makes labels UNENTERABLE on iOS

The iOS decimal pad has **no letters and no ABC toggle**. The single thing this PR exists to enable —
typing `BW` on a phone on the gym floor — would have been impossible on the primary device, while
technically satisfying AGENTS.md's numeric-keypad rule. **This alone invalidated the design.**

### B2 — the fix: keep the numeric input, add chips

`type="number" inputMode="decimal" min step required` stays **exactly as it is**. A small chip row per
set offers **`BW` · `band` · `other…`**. A chip writes a canonical label from a shared const (so casing
can never drift); `other…` swaps in a text input with `inputMode="text"` (letters available). Numeric
keypad preserved for the ~90% numeric case; labels reachable everywhere.

### B3 — `editStrengthSetSchema` would not compile

`strength.ts:33` is `strengthSetSchema.extend({...})`. `.extend` exists on `ZodObject` only — it is
`undefined` on the result of `.transform()`, `z.union()`, or `z.preprocess()`. Turning
`strengthSetSchema` into any of those breaks V1-9 at the type level.
→ **Today's object is preserved as `numericSetSchema`, unchanged.** `editStrengthSetSchema` extends
_that_. The log-path schema is built alongside it.

### B4 — the stated discriminator turned `''` into a label, re-opening the confirm-gate hole

"Otherwise → label" maps `''`/`'   '` to `weightLabel: ''`. That is silently unrecoverable:
`formatSetLine` uses `??`, so an empty label **wins** over the weight and the set renders `5 × ` with the
load hidden; `isEditableSet` returns false and `updateStrengthSetById`'s `isNull(weightLabel)` guard
refuses the fix. It is the V1-10 confirm-gate failure in a new costume.
→ **Order is pinned:** trim ends → **blank ⇒ zod issue, before any label branch** → strict numeric ⇒
`weight_num` → else label (`min(1)` after trim). Never write `''`; write NULL.

### B5 — `z.union` destroys the form's error messages

A nested union failure yields one `invalid_union` issue with message `"Invalid input"`, and
`actions.ts:299` renders **"Movement 1: Invalid input"** — replacing today's "Weight can't be negative."
→ **No `z.union` on the wire.** One object over `{reps, weight: string}` + `superRefine` emitting one
authored message; the union appears only in the **output** type.

## Design decisions

**D1 — Wire shape stays ONE key.** `{reps: string, weight: string}` — unchanged from what
`strength-form.tsx` already emits. A crafted body therefore cannot set both `weight` and `weightLabel`;
an extra key is stripped by zod. The union is an output type only.

**D2 — `parseLoad` in `packages/shared`** (cross-boundary: the log schema and, later, the CSV export both
need "what counts as numeric"). Rules, in order:

| Input                                               | Result                                                                                             |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `''`, `'   '`                                       | **issue** — "Enter a weight, or pick BW / band."                                                   |
| `/^-?\d+(\.\d{1,3})?$/` after trim                  | numeric → today's `min(0).max(2000)` (scale 3 matches `numeric(7,3)`)                              |
| `'-5'`                                              | matches the pattern → routed to today's "Weight can't be negative." (keeping `-?` is load-bearing) |
| `'1e3'`, `'0x10'`, `'Infinity'`, `'NaN'`, `'12abc'` | **reject** — numeric-_intent_ typos. Never label: a labeled typo is unrecoverable until V1-9b      |
| `~…`, `12-15` ranges                                | **reject** — see D5                                                                                |
| `SKIPPED` (any case)                                | **reject** — it is a `status`, not a load (D6)                                                     |
| contains `,` `\n` `\r`                              | **reject** — the CSV joins raw; a comma splits the row                                             |
| anything else, ≤ `LOAD_MAX_LENGTH`                  | label, verbatim                                                                                    |

**D3 — Normalisation: trim ENDS ONLY.** No internal-whitespace collapse (`30 (2x 15 DB)`,
`BW (unassisted)` depend on it), no case folding (`BW` upper, `band` lower). `"` is **allowed** — inch
marks are in active use. `LOAD_MAX_LENGTH = 32` drives both the schema and the input's `maxLength`.

**D4 — `weight_num` and `weight_label` may COEXIST; no mutual-exclusion CHECK, ever.** A future slice may
store `123 (50ft)` as `weight_num = 123` **plus** the label, so volume charts aren't blind to it. The read
seam already prefers the label and `updateStrengthSetById` already refuses to edit any labeled set, so
coexistence is pre-defended. **This PR does not implement prefix extraction** — it only refuses to
foreclose it. Deciding here because a CHECK added later would be a breaking migration.

**D5 — Guard the prescribed-text laundering path NOW (injury-safety adjacent).** The seeded targets are
`BW ~30"`, `BW +5-10`, `15/DB`. The export contract is explicit that `~` and ranges **never** appear in
`load` — "the single most likely column mix-up". This PR is the stated enabler for the deferred editable
prefill, whose mechanism is copying `prescription_target.load` into this very field. Rejecting `~` and
ranges here means that even if the prefill lands, a _prescribed_ string cannot become a _performed_ load.
**The follow-up prefill slice must still leave the field empty and `required`** — the reference card
stays the display surface.

**D6 — `SKIPPED` is out of scope and rejected.** `entries.status`/`entry_sets.status` already carry
`'skipped'` under a CHECK. Letting a coach type `SKIPPED` into the load field would create a second,
contradictory representation the export must then reconcile. The skip affordance is P1-1.

**D7 — `seconds` stays unwritten.** The CSV puts duration in `load` as `30s`, so `weight_label = '30s'`
reproduces it exactly and the column's own comment already covers non-weight loads (`'50ft'`). Two
caveats: the CSV requires `reps = 1` for a timed set and `reps` is `required`/positive, so the input needs
help text saying so; and a tech-debt entry records that `30s` is not structurally queryable, with V1-16
charts as the promotion trigger.

## File-by-file changes

| File                                                     | Change                                                                                                                                                                                                                                                                             |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared/src/strength.ts`                        | keep today's object as **`numericSetSchema`** (unchanged); add `parseLoad`, `LOAD_MAX_LENGTH`, `CANONICAL_LOAD_LABELS`, and the new `strengthSetSchema` (object + superRefine + transform → output union). `editStrengthSetSchema` extends `numericSetSchema`                      |
| `apps/web/app/p/[profileId]/strength-set-schema.test.ts` | **new** — `parseLoad` truth table (vitest root is `apps/web`; a test under `packages/` would never run)                                                                                                                                                                            |
| `packages/db/src/writers/strength-session.ts`            | `ResolvedSessionMovement.sets` **and** `writeSessionStrengthEntry`'s own inline `sets` type (a separate declaration at ~:144) take the union; the insert branches `weightNum` vs `weightLabel`. Numeric branch keeps the `weight` key name so `verify.ts`'s ~8 literals stay valid |
| `apps/web/app/p/[profileId]/set-fields.tsx`              | `mode: 'numeric' \| 'load'` (default `'numeric'`). `'numeric'` renders exactly today's markup — the V1-9 form is untouched                                                                                                                                                         |
| `apps/web/app/p/[profileId]/load-chips.tsx`              | **new** — `BW` · `band` · `other…`, log form only                                                                                                                                                                                                                                  |
| `apps/web/app/p/[profileId]/strength-form.tsx`           | render the chips; set state stays strings                                                                                                                                                                                                                                          |
| `packages/db/scripts/verify.ts`                          | a labeled set round-trips (`weight_label` set, `weight_num` NULL); a numeric set unaffected; **no row has `weight_label = ''`**; a labeled set on a **superset member** (that path has no other coverage)                                                                          |
| `docs/tech-debt.md`                                      | a labeled set can't be edited until V1-9b; `30s` isn't structurally queryable                                                                                                                                                                                                      |
| `docs/plan.md` · `docs/status.md`                        | GAP-1 row + status                                                                                                                                                                                                                                                                 |

## Test plan

- **Unit:** the `parseLoad` truth table above, including `''`/`'   '`/`'\t'` → issue.
- **Boundary:** the log action accepts a labeled set, rejects a blank one, and still returns
  field-level messages for `-5` (not "Invalid input").
- **`db:verify`:** labeled round-trip; numeric unaffected; no empty-string labels; labeled superset member.
- **Regression:** every existing strength test green, and the **V1-9 edit tests unchanged**.
- **Screenshots:** tri-viewport of the chips and a logged `5 × BW`.

## Risks / rollback

- **The `required` confirm-gate is the highest-risk line.** A blank must stay invalid. B4 is the failure
  mode to guard.
- `editable-set.tsx:95` renders only `state.error`, never `fieldErrors` — a pre-existing gap, and the
  reason `mode` defaults to `'numeric'` rather than changing that form.
- Rollback: revert; no migration, existing numeric rows untouched.

## Out of scope

`seconds` (D7) · `SKIPPED`/sub-failure (P1-1) · numeric-prefix extraction (D4) · editing a labeled set
(V1-9b) · the editable prefill (its own slice, and D5 constrains it).

---

## Panel review log — reconciled

Single-pass, three lenses. **Five BLOCKING findings; the plan above is the rewrite.**

- **BLOCKING — `inputMode="decimal"` has no letters on iOS.** The feature would have been unenterable on
  the primary device. → chips (B1/B2). The panel's "third option" answer to Q1 is adopted wholesale.
- **BLOCKING — `.extend` doesn't exist on a union/transform**, so `editStrengthSetSchema` wouldn't
  compile. → `numericSetSchema` preserved (B3).
- **BLOCKING — `''` → label was silently unrecoverable** and re-opened the V1-10 confirm-gate hole. →
  order pinned, blank rejected first (B4).
- **BLOCKING — `z.union` collapses errors to "Invalid input"**, destroying the form's messages. →
  superRefine, union only in the output type (B5).
- **BLOCKING — `SetRepsWeightFields` is SHARED with the V1-9 edit form**, so the draft silently changed
  it too. → explicit `mode` prop, default numeric.
- **Q2 answered, and my premise was wrong**: today `'Infinity'`/`'NaN'` are already _rejected_, `'1e3'`
  → 1000 and `'0x10'` → 16 are silently accepted. The new risk was the reverse — turning typos into
  permanent labels. → strict decimal pattern; numeric-looking-but-not-plain rejects.
- **Q3 answered:** trim ends only; no case folding; allow `"`; reject `,`/newline; cap length.
- **Q4/Q5 confirmed:** deferring `seconds` is right (with two caveats now in D7); supersets inherit free,
  but need a `db:verify` probe since that path has no other coverage.
- **Accepted, VALUABLE:** the type change reaches an inline `sets` declaration the table had missed;
  `packages/shared/**/*.test.ts` would never run (vitest root is `apps/web`); "both keys rejected" was
  incoherent with a single-key wire; `SKIPPED` is a status not a load; numeric-prefixed labels discard a
  recoverable number → D4 refuses to foreclose it.
- **Accepted, PROCESS:** added Acceptance / Out-of-scope / this log; the GAP-1 backlog row and
  `csv-recording-gaps.md` live on the unmerged PR #86, noted in the header.
