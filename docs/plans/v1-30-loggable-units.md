# V1-30 — every unit the log form offers is one the server accepts and the export can write

> Backlog: [plan.md](../plan.md) → V1-30, and AUDIT-1 row 1 (P0-1, plus P2-1 and P2-2 in the
> [baseline audit](../audits/2026-09-30-baseline.md)). Branch: `fix/v1-30-loggable-units`.
> **Split after the panel:** this plan is **V1-30a**, the P0 (server, shared schema, export). The form
> ergonomics the UX lens found are **V1-30b**, its own UI PR (§V1-30b).

## Goal

The strength form's "Measuring" picker offers **9 units** (`lb kg in cm ft m yd sec min`;
`strength-form.tsx:596-636`). The server accepts only **`lb` and `kg`** (`strength-session.ts:45`,
`unit: z.enum(BODYWEIGHT_UNITS)`), so a timed hold or a distance fails the **whole session**. This
has been broken since #141.

Widening that one line moves the failure downstream, three ways:

1. **The export.** It can write only `lb` (bare), `in`, `ft` and `sec` (as `s`). For every other unit
   `assertExportableUnit` **throws** (`csv/value.ts:37-83`), and the export route has no try/catch,
   so one `m` set would 500 the profile's whole export. **`kg` strength sets already do this today.**
2. **The tripwire was load-bearing elsewhere.** An auxiliary mass is written **bare**
   (`csv/load.ts:75`, `+${formatNumeric(q.value)} (${q.slot})`), so once `kg` stops throwing, an 8 kg
   vest exports as `BW+8 (vest)`, which reads as **8 lb**. It's latent (the writer writes only
   `primary` until GAP-3 4b), but 4b was promised to turn it on "with no change to the exporter"
   (`load.ts:38`). Probed by the correctness lens.
3. **New bad shapes become savable.** The server's rejection was the only thing stopping a non-mass
   movement from saving with **BW/band and no number** (`3 × BW` on a timed hold: the set refine
   passes, `strength.ts:104-110`), or with **BW + a time or distance** (`BW+30s`, `BW+20m`, shapes
   the contract never had). Both are **uneditable** once saved (`isEditableSet` and the SQL guard are
   mass-only), and there's no delete.

**Ray's decision (2026-10-01): all 9 units, each with a CSV spelling.** After V1-30a:

- every unit the form offers is accepted;
- every accepted unit exports;
- no accepted shape exports as a misread number;
- a non-mass set must carry its number and can't be a mode.

## Acceptance

- plan.md V1-30: _"the log form offers units the server rejects … the fix PR starts by writing the
  failing test."_ AUDIT-1 row 1: _"the server accepts every unit the form offers; boundary tests,
  `db:verify`, guide invariant 4b"_.
- Done when:
  1. A session with movements in `lb`, `kg`, `sec` and `m` **saves**. The action test asserts the DAL
     received those units, and that `count` is rejected with `Movement 1: …` and **no DAL call**.
  2. Each of the 9 units **exports** with the spelling in §Spellings. **The `CSV_UNIT_SUFFIX` map is
     pinned literally, once**, replacing today's `EXPORTABLE_UNITS` pin (`strength-log.test.ts:246`).
     `count`, `bool` and `timing` still throw.
  3. **An auxiliary `kg` mass exports suffixed** (`BW+8kg (vest)`); an `lb` one stays bare
     (`BW+8 (vest)`).
  4. **The chain test exercises the wired field.** Every unit the form can put in state, through the
     Unit select, the default, or a catalog default, is accepted by `sessionMovementSchema.shape.unit`,
     and every option of that field is in `EXPORTABLE_UNITS`. Reverting line 45 to
     `BODYWEIGHT_UNITS` turns it red.
  5. **Non-mass sets:** a set in a non-mass movement with `isBodyweight`/`isBand` is **rejected**
     ("Turn off BW / band — they don't apply to a time."). A blank one is already rejected by the set
     check. **Every bad set gets exactly one message, with its set number.**
  6. `declaredUnit` accepts only loggable units; `declaredLoaded` means "has a mass unit" (P2-1, P2-2).
  7. Set-level copy no longer says "weight" where the field may be a time or distance.
  8. Guide invariant 4b, the export contract (with a dated change entry), ADR 0004, CSV-1's row and
     the stale comments are corrected. V1-30b and the deferred rows are filed.

## Spellings (the contract change)

Value + unit, no space, lowercase, as the corpus writes `30in`, `50ft` and `20s`. The suffix is the
unit code; `sec` → `s` already exists. **Corpus-observed** spellings are marked; the rest are
**app-defined** (nothing was ever logged in them), and the contract says so.

| Unit  | Today      | After     | Example | Source                                                                                    |
| ----- | ---------- | --------- | ------- | ----------------------------------------------------------------------------------------- |
| `lb`  | bare       | bare      | `80`    | corpus                                                                                    |
| `kg`  | **throws** | `kg`      | `85kg`  | app-defined. **Never bare, never converted.**                                             |
| `in`  | `in`       | unchanged | `30in`  | corpus                                                                                    |
| `cm`  | **throws** | `cm`      | `75cm`  | app-defined                                                                               |
| `ft`  | `ft`       | unchanged | `50ft`  | corpus                                                                                    |
| `m`   | **throws** | `m`       | `20m`   | app-defined. **`m` = metres** (stated in the contract, because `20m` can read as minutes) |
| `yd`  | **throws** | `yd`      | `40yd`  | app-defined. The corpus's only yard spelling is `40 yd` in `prescribed`, not `load`       |
| `sec` | `s`        | unchanged | `30s`   | corpus                                                                                    |
| `min` | **throws** | `min`     | `3min`  | app-defined. **`min` = minutes**                                                          |

Auxiliary mass follows the primary rule: `BW+8 (vest)` for `lb`, `BW+8kg (vest)` for `kg`.

⚠️ **The workflow that reads the CSVs is outside this repo.** Its spec for this column is the
external `strength-log/README.md` (`load` bullet; scrubbed copy at
`docs/samples/legacy-csv/strength-log/README.md`, which already calls `load` "free-form" with
`30in`, `50ft`). **Ray updates that bullet before merge**, which is a checkbox in the PR description.
The change is **additive**: every row that exports today keeps its bytes, and the new rows used to
500 (AGENTS.md → Backend "Contract": no BREAKING footer).

## File-by-file changes (V1-30a)

| Path                                                          | Change | What & why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared/src/units.ts`                                | EDIT   | `export const loggableUnitSchema = z.enum(LOGGABLE_UNITS)`. zod 4.6.5 accepts a `readonly Unit[]`, and `z.infer` is `Unit` (probed with `tsc --strict`). It keeps `.options`, unlike `z.custom`. Also `isLoggableUnit(x: string): x is Unit` (`loggableUnitSchema.safeParse(x).success`), the one predicate, and `loggableUnitsOf(d)`: the loggable units of a dimension, which the form's Unit select and the scaffold both use, so "offerable" is defined in code.                                                                                                                                                                                                                          |
| `packages/shared/src/strength-session.ts`                     | EDIT   | `unit: loggableUnitSchema`. **In the existing session `superRefine`**: for each movement whose unit's dimension isn't `mass` (`UNIT_DIMENSION_BY_CODE[u] !== UNIT_DIMENSION.mass`), a set with `isBodyweight` or `isBand` gets **one** issue at `['movements', i, 'sets', j, 'weight']`: "Turn off BW / band — they don't apply to a <dimension>.", where the wording comes from `LOGGABLE_DIMENSION_LABELS` in lower case (`time`, `height or distance`), so the select and the message can't drift. Only modes are checked: a blank set with no mode is already rejected by the set check (`strength.ts:104-110`), so a blank set never gets two messages. Fix the stale docblock at `:22`. |
| `packages/shared/src/strength.ts`                             | EDIT   | **Copy only.** The set check can't see the unit, so its blank message stops recommending BW: `:108` becomes "Enter a number." (BW is still a visible chip for mass, and on a time it is now rejected). `:65` becomes "Enter a plain number like 62.5." and `:70` becomes "That number looks too high." Per-dimension wording ("Enter the time.") is V1-30b.                                                                                                                                                                                                                                                                                                                                   |
| `packages/shared/src/csv/value.ts`                            | EDIT   | `CSV_UNIT_SUFFIX`: `kg:'kg'`, `cm:'cm'`, `m:'m'`, `yd:'yd'`, `min:'min'`. `count`, `bool` and `timing` stay `null`. Docblocks: the false "`lb` is … the only mass unit the form offers" (`:69-70`) is rewritten; the tripwire now guards units no form offers.                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `packages/shared/src/csv/load.ts`                             | EDIT   | **B1:** the auxiliary-mass branch writes `+${magnitude} (${slot})` (the suffixed value `formatQuantity` already returns) instead of the bare `formatNumeric`. `lb` stays bare (suffix `''`), so existing golden vectors don't change. Add `BW+8kg (vest)` to the docblock table.                                                                                                                                                                                                                                                                                                                                                                                                              |
| `packages/shared/src/units.test.ts`                           | NEW    | **The chain test** (colocated with the code it covers): every unit in `LOGGABLE_DIMENSIONS.flatMap(loggableUnitsOf)`, plus `DEFAULT_BODYWEIGHT_UNIT` and `BODYWEIGHT_UNITS`, passes `sessionMovementSchema.shape.unit`, and every `.options` member is in `EXPORTABLE_UNITS`. `NON_LOGGABLE = UNIT_CODES.filter(u => !isLoggableUnit(u))` is derived once and pinned literally once (`['bool','count','timing']`); each is rejected and is not exportable.                                                                                                                                                                                                                                    |
| `apps/web/app/p/[profileId]/strength-session-schema.test.ts`  | EDIT   | **Red on `main`:** `it.each(LOGGABLE_UNITS)` → `logStrengthSessionSchema` accepts a one-movement session; `it.each([...NON_LOGGABLE, 'furlong'])` → rejected. Non-mass rules: `sec`+BW, `m`+band and `sec`+BW+30 each give **exactly one** issue at the set's `weight` path; `sec`+30 is accepted; a blank `sec` set gives exactly one (the set check's).                                                                                                                                                                                                                                                                                                                                     |
| `apps/web/app/p/[profileId]/actions.ts` (+ `actions.test.ts`) | EDIT   | The issue mapping (`:300-306`) adds the set number when the path has one: `Movement 2, set 3: …`. Three bad sets then give three distinct lines (identical strings also collided as React keys at `strength-form.tsx:438`). Test, in "logStrengthSessionAction — boundary": a session with `lb`, `kg`, `sec` and `m` movements → `ok`, and `mock.calls[0][0]` `toMatchObject({ movements: [{unit:'lb'},{unit:'kg'},{unit:'sec'},{unit:'m'}] })`; a `count` movement → a `Movement 1:` error, and `logStrengthSession` is **not called**; `sec`+BW → `Movement 1, set 1: Turn off BW / band…`.                                                                                                 |
| `apps/web/lib/csv/strength-log.test.ts`                       | EDIT   | **Red on `main`:** `kg` → `85kg`, and `m` sets 20/25/25 → `20m/25m/25m` (a suffixed slash-list). The `kg` tripwire case (`:233-243`) moves to `count`. **Replace** the `EXPORTABLE_UNITS` pin (`:246`) with one literal pin of the whole `CSV_UNIT_SUFFIX` map (the AGENTS.md contract-test exception, used once). Aux mass: a `kg` vest → `BW+8kg (vest)`, an `lb` vest → `BW+8 (vest)`.                                                                                                                                                                                                                                                                                                     |
| `apps/web/app/p/[profileId]/strength-form-scaffold.ts`        | EDIT   | P2-1: `declaredUnit` uses `isLoggableUnit` (this drops the `in`-operator prototype hole and the cast). P2-2: `declaredLoaded` requires `UNIT_DIMENSION_BY_CODE[u] === UNIT_DIMENSION.mass`, the idiom `set-display.ts:69` and `csv/load.ts:73` already use.                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `apps/web/app/p/[profileId]/strength-form-scaffold.test.ts`   | EDIT   | A `count` default falls back to the default unit; a `sec` default isn't "declared loaded".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `apps/web/app/p/[profileId]/strength-form.tsx`                | EDIT   | **Behaviour-neutral.** The Unit select calls `loggableUnitsOf(dimension)` instead of `unitsOfDimension` (the same list for every loggable dimension), so the chain test's "offerable" is the form's real source. Fix the comment at `:588-594`, which calls squat-in-seconds "unreachable".                                                                                                                                                                                                                                                                                                                                                                                                   |
| `packages/db/scripts/verify.ts`                               | EDIT   | **One new proof, ~10 lines:** `updateStrengthSetById` on the existing `durationSet` (`sec`) returns `null`, because non-mass is uneditable by design. No new round trip: the writer accepts any `Unit`, and `sec`/length FK coverage already exists.                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `apps/web/lib/entries/format-value-unit.ts` (+ `.test.ts:21`) | EDIT   | Comments only: "kg throws in the CSV" becomes "the CSV spells it `5kg`; the screen shows `5 kg`".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `docs/features/strength-logging.md`                           | EDIT   | Invariant 4b: names the chain test as the enforcement, and states that **the athlete picks the dimension; the catalog only seeds it** (the server doesn't check `unit_default`). Non-mass rules. The `:189-192` "throws on `kg`" text. New trap: a non-mass set is uneditable and **recovery means writing a correction** (none is generic), with a link to the filed row.                                                                                                                                                                                                                                                                                                                    |
| `docs/decisions/0004-typed-measurements.md`                   | EDIT   | A one-line dated addendum to §6.2: the movement's declared dimension is a default the athlete can change; the server enforces dimension ↔ unit consistency, not catalog ↔ dimension.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `docs/csv-export-contract.md`                                 | EDIT   | The `load` shapes table gains the new spellings, marked app-defined, with `kg` never bare, `m` = metres, `min` = minutes, and `BW+8kg (vest)`. It cites `CSV_UNIT_SUFFIX` as the authority. A new dated **"Contract changes"** section with the V1-30 entry.                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `docs/plan.md`                                                | EDIT   | V1-30 → ✅ 30a, linked; AUDIT-1 row 1 ✅. **CSV-1's row:** its planned fix ("call `assertExportableUnit` in `buildBodyweight`") stops refusing `kg` after this PR, so it now needs an **lb-only guard for the `weight_lb` column**. **New rows:** V1-30b (below); editing non-mass sets (sequenced after 30b); catalog `unitDefault` for Box Jump / Broad Jump / Hollow-Body Hold (a correction or migration); the export route's whole-file 500 on any tripwire.                                                                                                                                                                                                                             |
| `docs/changelog/2026-10-01-fix-v1-30-loggable-units.md`       | NEW    | The fragment.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

**No migration.** The `units` table already has all 9 codes with their dimensions, and the composite
FKs on `entries.unit` and `entry_set_quantities (unit, dimension)` already accept them.

## V1-30b (filed, not in this PR): the form stops inviting the bad shapes

UX findings that are visible changes, so they go in their own PR, with screenshots at three widths
and a single UX reviewer:

- **Hide `SetModeToggles`** when the dimension isn't mass, keep the field `required`, and **clear
  `isBodyweight`/`isBand` when Measuring changes** (otherwise hidden flags get submitted). V1-30a's
  server rule already rejects these shapes, with clear copy. 30b stops the form from offering them.
- **Placeholder and aria-label per dimension** (`set-fields.tsx:75-77`): `weight` / `distance` /
  `time`, and `UNIT_LABELS[unit]` in the label, e.g. "time in Seconds" rather than "weight in in".
  `distance` (~62px) fits the `w-24` field; "Height / distance" (~135px) does not.
- **Per-dimension blank copy** ("Enter the time." / "Enter the height or distance.") instead of
  30a's neutral "Enter a number.", which needs the unit at the set level, or a client-side check.
- **A mis-tap hint** when the chosen dimension differs from the catalog's ("Back Squat is usually
  logged as Weight."), using the V1-26 `role="status"` idiom.
- `step="0.5"` blocks `6.25 ft` / `1.25 min` in the browser while the server accepts 3 decimals
  (`set-fields.tsx:70`; this predates V1-30).

## Test plan

- **Red first (commit 1, on `main`'s code):** the session-schema `it.each` and the non-mass rules,
  the action boundary case, and the CSV `kg`/`m`/vest cases. All fail on an **assertion**, not a
  missing import: the chain test, which imports new helpers, lands in commit 2.
- **Commit 2:** the fix and the chain test, then green.
- **`db:verify`:** the one new proof, the non-mass edit refusal.
- **e2e:** no new spec (V1-30a has no visual change). Run `pnpm e2e:local` because the log flow is
  smoke-covered.
- `pnpm verify`, `guides:check`, `status:check`, hold-the-bar.

## Risks / rollback

| Risk                                                          | Mitigation                                                                                                                                                                                       |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The external workflow misreads a new suffix                   | It's suffixed, never bare, never converted, so the failure is a parse miss, not a ×2.2. `m`/`min` are defined in the contract. **Ray updates the external README before merge** (PR checkbox).   |
| A unit drifts between the form, the server and the export     | The chain test runs the wired field. Reverting the bug turns it red.                                                                                                                             |
| An auxiliary `kg` mass exports bare (×2.2)                    | Suffixed now, with a golden vector.                                                                                                                                                              |
| BW/band on a time or distance saves an uneditable shape       | Rejected by the server (30a). The form stops offering it in 30b.                                                                                                                                 |
| A typo in a valid non-mass set (`300 sec`) can't be corrected | **Accepted for now:** the edit guard is mass-only (invariant 3 keeps client and SQL identical). Recovery today means writing a correction; this is filed as its own row and sequenced after 30b. |
| A Measuring mis-tap saves `3 × 185 sec` on Back Squat         | Reachable after this PR, where `main` rejected it. The 30b hint mitigates it. The guide says plainly that the catalog only seeds the dimension.                                                  |
| CSV-1's fix silently stops refusing `kg` bodyweight           | CSV-1's row is rewritten in this PR to need its own lb-only guard.                                                                                                                               |

Rollback: revert. There's no schema or data change.

## Out-of-scope / deferred

- **V1-30b** (above).
- **Editing non-mass sets.**
- **Catalog unit defaults** for the jumps and holds (a seed won't update existing rows).
- **The export route's whole-file 500** on any tripwire unit (pre-existing; a per-row failure is its
  own row).
- **CSV-1** (bodyweight `kg` under `weight_lb`): its own P0, with its row updated here.
- Per-unit upper bounds.
- **V1-31**.

## For Ray (before merge)

1. Update the external `strength-log/README.md` `load` bullet: `85kg`, `75cm`, `20m` (metres),
   `40yd`, `3min` (minutes) and `BW+8kg (vest)` can now appear. A bare number is still pounds.
2. Confirm the spellings in §Spellings.

## Open questions

None.

## Review-response log

### Engineering panel + UX reviewer (round 1): correctness, scope, architecture, reuse, UX

| #   | Lens                        | Critique (short)                                                                                                | Verdict               | Resolution                                                                                                                                                                            |
| --- | --------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | Correctness · Arch          | Auxiliary mass is written bare, so a `kg` vest exports `BW+8 (vest)` (8 lb) once the tripwire goes (probed)     | **accepted**          | `load.ts` writes the suffixed magnitude; golden vectors for `kg` and `lb` vests.                                                                                                      |
| B2  | Correctness · Reuse · Scope | The chain test is tautological: it tests the helper, not the wired field, and "offerable" isn't defined in code | **accepted**          | It runs `sessionMovementSchema.shape.unit` over every unit the form can put in state, through a shared `loggableUnitsOf` that the form uses. Reverting the bug turns it red.          |
| U1  | UX · Correctness (S2)       | BW/band on a time or distance saves `3 × BW` with no number, or `BW+30s`/`BW+20m`; uneditable                   | **accepted**          | The server rule is in 30a (session refine: non-mass needs a number, no modes). The form-side hiding is in 30b.                                                                        |
| R1  | Reuse                       | The existing `EXPORTABLE_UNITS` pin (`:246`) would go red and duplicate the new map pin                         | **accepted**          | Replaced by the one map pin.                                                                                                                                                          |
| S1c | Correctness                 | The zod typing premise is zod-3 lore; plain `z.enum(LOGGABLE_UNITS)` works on 4.6.5 (probed)                    | **accepted**          | Prescribed. `z.custom` dropped.                                                                                                                                                       |
| R2  | Reuse                       | Two "is loggable" predicates                                                                                    | **accepted**          | One `isLoggableUnit`, used by the scaffold.                                                                                                                                           |
| R3  | Reuse                       | The non-loggable list is re-typed in 4 tests                                                                    | **accepted**          | Derived once and pinned once.                                                                                                                                                         |
| R4  | Reuse · Scope               | `verify.ts` would copy a 25-line block twice for little value                                                   | **accepted**          | Helper; one `m` pin; the edit refusal reuses `durationSet`. `min` dropped.                                                                                                            |
| R5  | Reuse (NIT)                 | `declaredLoaded` should use the existing mass idiom                                                             | **accepted**          | `UNIT_DIMENSION_BY_CODE[u] === UNIT_DIMENSION.mass`.                                                                                                                                  |
| A2  | Arch                        | The contract has no version or change record; Ray's update is untracked                                         | **accepted**          | A dated "Contract changes" section; a pre-merge checkbox that names the external README. No versioning machinery.                                                                     |
| A3  | Arch                        | The spellings overstate the corpus; `m` is ambiguous to an LLM reader                                           | **accepted**          | A source column; `m` = metres and `min` = minutes stated.                                                                                                                             |
| A4  | Arch                        | The chain test belongs in `packages/shared`                                                                     | **accepted**          | `packages/shared/src/units.test.ts`.                                                                                                                                                  |
| A5  | Arch · UX (5)               | The server never checks the catalog dimension; ADR 0004 §6.2 is silently departed from                          | **accepted (b)**      | A guide note and an ADR addendum: the athlete chooses, the catalog seeds. Enforcing catalog ↔ dimension would block legitimate choices; the 30b hint covers mis-taps.                 |
| A6  | Arch · UX (7) · Corr (N1)   | Stale "kg throws" comments outside the table                                                                    | **accepted**          | `format-value-unit.ts` (+ test) and the guide `:189-192` added. The applied V1-24 plan is left as is.                                                                                 |
| S3c | Correctness                 | CSV-1's planned fix silently stops refusing `kg`                                                                | **accepted**          | CSV-1's row is rewritten here.                                                                                                                                                        |
| S4c | Correctness                 | Some "red first" tests are red for the wrong reason, or not red at all                                          | **accepted**          | Commit 1 holds only assertion-red tests; `verify` additions are labelled pins.                                                                                                        |
| S5c | Correctness                 | The action test must assert DAL args and "no write"                                                             | **accepted**          | `toMatchObject` on `mock.calls[0][0]`; `not.toHaveBeenCalled()`.                                                                                                                      |
| U2  | UX                          | The field is labelled "weight" and the aria-label reads "weight in in"                                          | **moved to 30b**      | A visible change: screenshots and a UX reviewer in its own PR.                                                                                                                        |
| U3  | UX                          | Set-level copy says "weight"                                                                                    | **accepted**          | Neutral copy in `strength.ts` (shared, no layout change).                                                                                                                             |
| U4  | UX · Scope (2)              | "Recovery is `db:correct`" is overstated; the deferrals have no rows                                            | **accepted**          | Rows filed. The guide says "write a correction".                                                                                                                                      |
| U5  | UX                          | A Measuring mis-tap now saves silently                                                                          | **partly accepted**   | The comment is fixed here; the hint is in 30b.                                                                                                                                        |
| U6  | UX                          | The jumps and holds still open as Weight / Pounds                                                               | **accepted as a row** | Needs a correction or migration; out of 30a.                                                                                                                                          |
| S1s | Scope                       | "Accepted" is tested three times                                                                                | **partly accepted**   | The chain test now checks something new (the wired field plus exportable). The `it.each` (red-first) and the action test (wiring, mandatory) stay, and each covers a different layer. |
| A7  | Arch (NIT)                  | Cite constraints by name, not `schema.ts` line numbers                                                          | **accepted**          | Done.                                                                                                                                                                                 |
| —   | Arch (outside)              | The export route 500s on any tripwire                                                                           | **row filed**         | Pre-existing.                                                                                                                                                                         |

### Round 2 (light pass): correctness, UX, scope

| #    | Lens        | Critique (short)                                                                                                                             | Verdict                       | Resolution                                                                                                                                                                                                                                                                                                                                             |
| ---- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C2-1 | Correctness | The set-check/session-check split can't be built as written (probed: a blank `sec` set gets two messages; the set schema can't see the unit) | **accepted, via Scope's fix** | Correctness proposed moving the blank check into the session refine. Scope's smaller fix satisfies the same "exactly one" requirement: the session refine checks **modes only**, the set check keeps blank (neutral copy). Every bad shape gets one message (blank → set check; BW/band ± number → session). `strengthSetSchema` stays self-contained. |
| C2-2 | Correctness | The type-error short-circuit: the refine doesn't run when a sibling field has a type error                                                   | **noted**                     | Nothing bad saves; at most one extra round trip.                                                                                                                                                                                                                                                                                                       |
| S2-1 | Scope       | Drop the skip machinery; the non-mass rule only needs the mode check                                                                         | **accepted**                  | As above.                                                                                                                                                                                                                                                                                                                                              |
| S2-2 | Scope       | Cut the `verify.ts` `m` pin and the helper refactor; keep the edit refusal                                                                   | **accepted**                  | Done.                                                                                                                                                                                                                                                                                                                                                  |
| S2-3 | Scope (NIT) | `loggableUnitsOf` adds little                                                                                                                | **rejected**                  | It is what makes "offerable" a code fact the chain test can use (Correctness B2), and it costs ~3 lines.                                                                                                                                                                                                                                               |
| U2-1 | UX          | "…enter the time" is wrong when the time is typed; name the actual fix                                                                       | **accepted**                  | "Turn off BW / band — they don't apply to a time."                                                                                                                                                                                                                                                                                                     |
| U2-2 | UX          | "distance" is wrong for a box jump                                                                                                           | **accepted**                  | The wording comes from `LOGGABLE_DIMENSION_LABELS` ("height or distance").                                                                                                                                                                                                                                                                             |
| U2-3 | UX          | Identical per-set messages with no set number (also duplicate React keys)                                                                    | **accepted**                  | The action prefixes `Movement N, set M:` from the issue path.                                                                                                                                                                                                                                                                                          |
| U2-4 | UX          | Is shipping 30a before 30b acceptable?                                                                                                       | **yes (UX)**                  | Nothing is written in the gap, typed state survives the rejection, and the fix is two taps.                                                                                                                                                                                                                                                            |

**Split rationale:** the panel's UX findings would make this a UI PR (screenshots, a UX re-review)
and push it past ~400 lines. The P0 is the server and the export; the server-side non-mass rule
already makes the bad shapes unsavable. So 30a stays non-visual and 30b follows.
