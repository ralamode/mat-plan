# CAT-3 P11-ii — the picker lists library movements, with their taxonomy from the database

> Backlog: [plan.md](../plan.md) row `CAT-3`. Spec: [cat-3-movement-library](../specs/cat-3-movement-library.md),
> criterion P11, K22, S6 and the P11-ii row of "Chunks, in order". Lane P. Mutations from `590`–`609`.
> Branch (code): `feat/cat-3-p11-ii-option-taxonomy`, cut after A2-i merges.

## Where this sits

- **Pillar:** the movement library (shared reference data; no pillar in roadmap.md's table).
- **Milestone:** [Beta 0](../milestones/beta-1.md), `CAT-3`'s node in its step chart.
- **This PR:** the plan only. The code PR follows it, after **A2-i** (lane A) puts `movementIsCatalog()`
  and the catalog writer on main.
- **Before it:** P11-i (#571, #586: the read's slug and the DAL's const path), A1 (#581: the tables),
  K22's decision (#587: every old built-in stays listed until the fresh start).
- **After it:** B3's browse tree reads real taxonomy; A2-ii (the switch to `CATALOG_MOVEMENTS`) is safe
  to deploy without a movement going missing from search; R2 (the fresh start) has P11 as a
  precondition.
- _Roadmap alignment (2026-11-19): advances `CAT-3` (P11-ii); touches the movement catalog, so the
  household-ownership rule is checked against `ID-1` below; checked against the private roadmap,
  nothing to add here._

## Goal

Today the option read (`packages/db/src/queries/program/movement-options.ts`) lists the global rows
whose slug `MOVEMENT_PICKER_ENTRIES` names, and the web DAL (`apps/web/lib/dal/program/picker.ts`)
attaches each one's taxonomy from the library const by slug. After this chunk:

1. **The read also lists every catalog row** (rule 2: global and `modality IS NOT NULL`, through
   `movementIsCatalog()`), so a library movement A2-ii seeds is found by search, by browse, and by
   `newItem`'s "this item exists" check (`existingItem`, P1 and P8), not only by the resolver's slug.
2. **A catalog row's taxonomy comes from the tables**: `modality` and `pattern` from `movements`,
   the equipment set from `movement_equipment`, the primary and secondary muscles from
   `movement_muscles`. Its aliases, supervision label and `hasInstructions` stay from the const by
   slug (the spec's P11-ii row).
3. **The old built-ins are still listed** (K22), unchanged: one on a library slug keeps the const's
   taxonomy (P11-i's path), one with no entry is `BuiltInWithoutLibrary`.
4. **The option payload is measured** (the spec's assumption "a few hundred entries is acceptable"):
   the bytes of `getItemPickerData()`'s result at the catalog fixture's size and at 500 entries,
   recorded in the PR.

Nothing changes for a household's own items.

## Acceptance

- (a) **A catalog row is listed**, compared with `catalogOptionOf(entry, publicId)` after
  `normalizeFixture`, for every entry of `CATALOG_FIXTURE` seeded through A2-i's writer.
- (b) **Its taxonomy is the tables'**, not the const's: a proof edits one row's `movement_equipment`
  and `movement_muscles` in the database and the option follows; a mutation that reads the const
  instead turns it red.
- (c) **Old built-ins are unchanged**: the 35 legacy rows give exactly today's options (a snapshot
  taken before the change, kept as the proof's expectation).
- (d) **No other household changes what the caller sees**: two households, one owning an item on a
  catalog slug and one on a catalog alias. The caller's list is the same with or without the other
  household. A mutation drops each conjunct of the household arm and of the join reads.
- (e) **A household item a catalog row shadows is still left out**, now for catalog slugs too (the
  existing `notExists` already covers every global row; a proof plants one).
- (f) **The join tables are read only through listed movements** (the schema's docblock on
  `movementEquipment`): the join reads take the listed catalog ids, never select by code alone. A
  mutation that drops the id filter turns a planted household-owned join row (inserted by hand in
  the proof, as no writer makes one) into a red assertion.
- (g) **`newItem` selects a catalog row by its alias** (step 1, `existed: true`), where today only
  step 2 reaches it by slug. The new-item.ts step 2 note ("the chunk that seeds them owes that") is
  closed in the same PR.
- (h) **The stays-dark guard** (`apps/web/test/program-tables-stay-dark.test.ts`) allows
  `packages/db/src/queries/program/movement-options.ts` by name, and nothing else in `apps/`.
- (i) **Payload measured**: a test in `apps/web/lib/dal/program/picker.test.ts` builds 500 options
  through `pickerOptionOf` and records the JSON length; the figure goes in the PR body. No budget is
  enforced (the spec's "if false" is "the picker loads options when it opens", a later decision).

## Files

| File                                                                                                                                                            | Change                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/db/src/queries/program/movement-options.ts`                                                                                                           | The catalog arm's WHERE becomes `slug in PICKER_SLUGS OR movementIsCatalog()`. Two more selects, by the listed catalog ids: `movement_equipment` (ordered by id) and `movement_muscles` (by role, then id). `MovementOption`'s catalog arm gains an optional `taxonomy` (present exactly when the row is a catalog row), and `group` becomes optional (a library row has none, as the DTO already says). |
| `apps/web/lib/dal/program/picker.ts`                                                                                                                            | `pickerOptionOf`: a row with `taxonomy` takes it from the read, and aliases, supervision and `hasInstructions` from the const by slug. A row without one keeps today's two paths. The docblock's ⏳ notes are updated.                                                                                                                                                                                   |
| `apps/web/lib/dal/program/picker.test.ts`                                                                                                                       | The three arms, the payload figure, the slug still never leaving the DAL.                                                                                                                                                                                                                                                                                                                                |
| `packages/db/src/writers/program/new-item.ts`                                                                                                                   | Docblock only: step 2's ⚠️ is closed.                                                                                                                                                                                                                                                                                                                                                                    |
| `packages/db/scripts/verify/program.ts`                                                                                                                         | Proofs (a)–(g).                                                                                                                                                                                                                                                                                                                                                                                          |
| `packages/db/scripts/mutations/590…`                                                                                                                            | One patch for each conjunct and each source (b, d, e, f, the `movementIsCatalog()` arm).                                                                                                                                                                                                                                                                                                                 |
| `apps/web/test/program-tables-stay-dark.test.ts`                                                                                                                | (h).                                                                                                                                                                                                                                                                                                                                                                                                     |
| `docs/features/program-writers.md` (owns `queries/program/`), `docs/features/program-builder.md` (owns `lib/dal/program/`), `docs/features/movement-catalog.md` | Invariants: which rows the read lists; where an option's taxonomy comes from; the tables are now read.                                                                                                                                                                                                                                                                                                   |
| changelog fragment; `docs/specs/cat-3-movement-library.md`                                                                                                      | The P11-ii row marked ✅, through the spec owner (lane P does not edit the spec's text).                                                                                                                                                                                                                                                                                                                 |

## Open decisions (for the panel)

1. **A catalog row with no const entry.** After A2-ii every catalog row is seeded from the const, so
   this should not happen. Recommended: the DAL lists it with the tables' taxonomy, no aliases,
   `supervision: null` and `hasInstructions: false`, and `db:verify` proves the seed writes no
   catalog row without an entry. Alternative: throw. Rejected because a drift would then break the
   whole picker. ⚠️ The cost: a supervised movement in that state would lose its label, which is why
   the seed proof matters.
2. **Equipment order.** The contract says "in the entry's authored order", and the tables have no
   ordinal. Recommended: order by `movement_equipment.id`, which A2-i's writer inserts in authored
   order. A proof pins it. A3's by-difference write (later) owns keeping it, and its plan gets a
   note. Alternative: re-order by the const where an entry exists, which hides a table that is
   wrong.
3. **Where the taxonomy is mapped.** Recommended: the read returns raw codes, parsed through the
   shared zod enums (`modalitySchema`, `equipmentSchema`, `muscleSchema`), so a bad value fails in
   `packages/db`, and the DAL only assembles. This keeps "`apps/web/lib/dal/program/` maps it" (the
   spec row) to assembly.

## Not in this chunk

- Hiding any old built-in (K22: not until R2).
- A household item's taxonomy (rule 11; Beta 0 has none).
- Loading options when the picker opens (only if the measured payload says so).
- B3's tree, which reads these fields unchanged (`cat-3-b3-browse-by-kind.md` § "Compatibility with
  P11-ii").

## ID-1 check

The read's household arm is unchanged, and no household-scoped data gains a new reader. The join
tables have no `household_id`, so ownership stays derived through `movement_id` (keep-open item: a
household's own taxonomy, when there is one, travels with its movement). Nothing here forecloses a
household's own taxonomy: the read takes the join rows only for listed catalog rows, and a later
chunk can widen that to the caller's own rows.

## Review-response log

_The panel runs on this draft; findings and responses go here._
