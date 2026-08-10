# CSV recording gaps — what the app cannot yet log

Companion to [csv-export-contract.md](./csv-export-contract.md). The contract says what the files must
contain; **this file says what the app can and cannot currently produce**, and in what order to close
the gaps.

**The headline:** V1-13's hard part is not the formatter. It is that the app **cannot record** several
shapes the CSVs express. An export written today would be structurally correct and semantically lossy.
Every claim below was verified against the schema and the zod contracts.

## Ray's normalisation decision (2026-08-10) — resolves the biggest one

> "If it is things like 72 vs 72.0 weight, we should always prefer the float. If existing data in the
> CSV needs to be converted, we should convert it."

**This removes the hardest constraint in the contract.** The plan had been to plumb the operator's raw
keystrokes through `z.coerce.number()` so `71` and `71.0` could round-trip distinctly. That is no longer
needed: the app's canonical numeric form wins, and the legacy files get normalised **once** to match.

Consequences:

- **No `raw_load` plumbing for bodyweight.** `value_num` is the source of truth. (`raw_load`/`raw_reps`
  remain unused and available for the genuinely-lossy strength cases below.)
- **The bodyweight golden fixture must be regenerated**, not copied verbatim — it currently mixes `71`,
  `71.0`, `71.4`. Pick one canonical rendering and apply it everywhere.
- **RESOLVED (Ray, 2026-08-10): exactly ONE decimal place, always. No snapping.**
  `71` → `71.0`, `71.4` → `71.4`, `71.5` → `71.5`. A 0.25 quantization was considered and **rejected**:
  Ray's real file records to 0.1 lb (`71.4`, `71.2`), so snapping would have rewritten genuine scale
  readings — a data change, not a formatting one. Plate-style 0.25 increments belong to strength LOADS,
  not to a bodyweight scale.
  Pleasingly, `bodyweight-form.tsx` already ships `step="0.1"`, so the input and the export now agree by
  construction rather than by coincidence — worth an assertion so they cannot drift.
- **A one-off conversion of the existing CSVs is in scope** and is now unambiguous: render every
  historical `weight_lb` with `toFixed(1)`.
- **This is a deliberate, narrow relaxation of byte-faithfulness**, applied to _numeric normalisation
  only_. It does **not** extend to the text shapes below: `BW`, `band`, `SKIPPED` carry meaning a number
  cannot, so those still require write-path work.

## The gaps

Legend — **P0** blocks a faithful export of data the kids generate _today_; **P1** is needed before
V1-14b can assert a clean diff; **P2** is real but rare.

### P0-1 — `session_type` can only ever be `strength`

- **Contract wants:** `strength-a`, `trainer` (and `home-pull`, `home-push`, `private`).
- **App produces:** literally `strength`, always.
- **Why:** `SESSION_TYPES` (`packages/shared/src/sessions.ts`) has no `strength_a` — that lives in
  `DAY_ROLES`, a deliberately separate concept that is **derived from the weekday at read time and never
  persisted**. Worse, `logStrengthSessionAction` **omits** `sessionType` so the zod default fires.
- **Fix options:** (a) persist `day_role` on `sessions` (migration + widen the CHECK), or (b) re-derive
  at export time via `resolveDayRole(activity_date)` — no migration, but silently wrong for a session
  logged off-schedule, and it can never produce `trainer`.
- **Recommendation: (a).** The export is not the only consumer — a persisted `day_role` is what lets the
  app ever answer "which day was this?" without recomputing a weekday map that is itself a documented
  stopgap.

### P0-2 — Text loads are unwritable (`BW`, `band`, `30in`, `20s`, `123 (50ft)`)

- **Contract wants:** 10 distinct `load` shapes; only 2 are numeric.
- **App produces:** a number. `strengthSetSchema` accepts **only** `{reps: positive int, weight: number}`.
  `entry_sets.weight_label` and `entry_sets.seconds` **exist in the schema with zero writers**.
- **Consequence today:** a bodyweight movement logs `weight: 0` and would export `0`, **not `BW`** — a
  silent lie in the training record, and the single most common shape in the kids' program (pull-ups,
  dips, hollow holds, ab rollouts are all `BW`).
- **Fix:** extend `strengthSetSchema` to accept a text load into `weight_label`, and surface it in the
  set input (a free-text field or a `BW`/`band` affordance). The read path already handles it —
  `formatSetLine`/`isEditableSet` were built for exactly this.
- **Note:** this is also the change that would unblock the **editable prefill** the V1-10 panel rejected
  ("only possible after a separate change letting the log store TEXT loads").

### P0-3 — Timed sets are unwritable (`20s`, `30s`)

- **Contract wants:** duration in `load`, `reps = 1`.
- **App produces:** nothing. `entry_sets.seconds` has no writer and no schema field.
- **Affects:** hollow-body hold, wall-sit, farmer carry — all in Ray's seeded program.
- **Fix:** rides along with P0-2 (same schema + same input).

### P1-1 — `SKIPPED` and `sub-failure` are unreachable

- **Contract wants:** `SKIPPED` in `load` with `sets=0,reps=0`; `sub-failure` in `reps`.
- **App produces:** neither. `entries.status` and `entry_sets.status` **can** hold `skipped`/`sub_failure`
  (both CHECK-constrained correctly) but **nothing writes them**, and `sets` is `.min(1)` so `sets=0` is
  unwritable.
- **Fix:** a "skipped" affordance on the movement card + a per-set sub-failure marker. Modest UI, no
  migration.
- **Why P1 not P0:** the kids' current logging habit is to omit a skipped movement entirely, so nothing
  is being _corrupted_ today — it's just absent. But the contract shows Ray records it, and it is
  training signal (`drop-if-yellow`), so it matters before the export is trusted.

### P1-2 — `prescribed` requires joining the programming tables

- **Contract wants:** the plan string (`5x5 @ ~70 target`), **never reconciled** with the actuals.
- **App has:** the data (V1-10's `prescriptions` + `prescription_targets`), but **no link from a logged
  entry to the prescription it fulfilled**.
- **Hard part:** matching needs `(day_role, movement_id)` — and `day_role` isn't persisted (P0-1). Even
  then, a movement prescribed **twice in one day** (warm-up + working) is ambiguous, a case
  `uq_prescriptions_block_day_role_idx` explicitly anticipates.
- **Fix:** P0-1 first; then either match on `movement_id` within the day (accepting the double-prescribed
  ambiguity) or persist a `prescription_id` on the entry at log time — which P0-1 + the V1-19
  "Start today's program" button would make natural, since that button already knows which prescription
  each form row came from.
- **Interaction worth noting:** **V1-19 is the cheapest path to a correct `prescribed` column.**

### P1-3 — `context` is never written (bodyweight `morning`)

- `entries.context` exists; `logBodyweight` never sets it and there is no UI field. Every real row in
  Ray's file has `morning`. Fix: a small select (morning / pre-practice / post-practice / random).

### P2-1 — `weight_lb` vs the app's `kg` support

`BODYWEIGHT_UNITS = ['lb','kg']` and the form offers both, but the column is literally `weight_lb`.
Exporting a kg entry into it is a silent fidelity bug. Fix: convert on export, or constrain the UI.

### P2-2 — Free-text movement names can inject a comma

`findOrCreateMovementId` slugs arbitrary text, and `movementName` has no charset restriction. A movement
called `Bench, Close Grip` becomes `bench,-close-grip` and **shifts every downstream field**. The files
have no quoting, so this corrupts the row. Fix: reject/sanitise `,` `"` and newlines at the movement-name
boundary — cheap, and it prevents a class of silent corruption.

### P2-3 — `notes` can contain a newline

`freeTextNoteSchema` is `.trim().max(500)`; an interior `\n` passes and would split a CSV row. The
contract says newlines never occur and must not be allowed. Fix: one line in the shared schema.

### P2-4 — checkins metric types don't match the contract's samples

`stance` is `bool` in the catalog but the contract's sample shows `3min`; `reaction` is `scale_10` but
shows `7/10`. **Low urgency:** the real checkins files are header-only (zero rows ever written), so there
is no historical data to be faithful to — but it means the checkins fixture cannot be treated as
observed truth. Also, the app has a `footwork` metric with **no column** in the 9-column header.

## Recommended sequencing

1. **P2-2 + P2-3** (input sanitisation) — tiny, prevents silent corruption, no dependencies. Do first.
2. **P0-2 + P0-3** (text + timed loads) — one schema change, one input change, unblocks the largest
   fidelity gap **and** the V1-19 prefill.
3. **P0-1** (persist `day_role`) — a migration; unblocks P1-2.
4. **P1-1** (skipped / sub-failure) — UI affordances.
5. **P1-2** (`prescribed`) — after P0-1; cheapest alongside V1-19.
6. **P1-3, P2-1, P2-4** — small cleanups.

**Then** V1-13's export, and **then** V1-14b's clean-diff assertion.

## What this means for V1-13

The export **can** be built now, but it should be honest about scope. Two viable orderings:

- **(A) Formatter first.** Ship the pure formatter + golden fixtures (`packages/shared/src/csv/`) with
  **no DB**. Fully specified today, small, testable against Ray's real files, and it locks the contract
  down while the write-path gaps are closed. **Recommended.**
- **(B) Wait.** Close P0/P1 first, then build the export end-to-end. Correct, but leaves the MVP's
  headline feature unstarted for several more PRs.

(A) also has the advantage that writing the formatter's input type **forces** the gap list to be
concrete — every field it needs that the DB can't supply is a gap made visible in code rather than prose.
