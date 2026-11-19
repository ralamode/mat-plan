# CAT-3 P11-ii — the picker lists library movements, with their taxonomy from the database

> Backlog: [plan.md](../plan.md) row `CAT-3`. Spec: [cat-3-movement-library](../specs/cat-3-movement-library.md),
> criterion P11, K22, K23, S6, rule 2 and the P11-ii row of "Chunks, in order". Lane P. Mutations
> `590`–`609` (the board, 2026-11-19).

## Where this sits

- **Pillar:** the movement library (shared reference data; no pillar in roadmap.md's table).
- **Milestone:** [Beta 0](../milestones/beta-1.md), `CAT-3`'s node in its step chart.
- **This PR:** the plan only. **The code is two PRs** (panel S2, below):
  - **P11-ii-a, the rows:** the read lists every catalog row, with its aliases, supervision label
    and `hasInstructions` from the library in effect, so `newItem`, Enter and search agree on it.
    It waits for **A2-i** (lane A: `movementIsCatalog()` and the catalog writer) and comes **before
    A2-ii** (the switch to `CATALOG_MOVEMENTS`). Without it, A2-ii would put catalog rows on
    production that only `newItem`'s slug step can find, and a re-spelled name would make a
    household duplicate (the ⚠️ in `new-item.ts`, step 2).
  - **P11-ii-b, the taxonomy:** a catalog row's modality, pattern, equipment and muscles come from
    the tables instead of the const; the payload is measured.
- **Before it:** P11-i (#571, #586), A1 (#581: the tables), K22 (#587: every old built-in stays
  listed until the fresh start).
- **After it:** B3's tree reads these fields unchanged; R2 has P11 as a precondition.
- _Roadmap alignment (2026-11-19): advances `CAT-3` (P11-ii); touches the movement catalog, so it
  answers `ID-1`'s six keep-open items below; checked against the private roadmap, nothing to add
  here._

## Goal

Today the option read (`packages/db/src/queries/program/movement-options.ts`) lists the global rows
whose slug `MOVEMENT_PICKER_ENTRIES` names. The web DAL (`apps/web/lib/dal/program/picker.ts`)
attaches each one's taxonomy from `CATALOG_MOVEMENTS` by slug. `newItem` matches over the read
directly (`new-item.ts:88`), so it never sees what the DAL attaches.

After this chunk:

1. **The read lists every catalog row** (rule 2, `movementIsCatalog()`), as well as the old built-ins
   (K22, unchanged).
2. **The read takes the library as an argument** (`movementOptions(exec, scope, library)`), as the day
   resolver already does (`queries/day/day-plan.ts:99`). A catalog row's aliases, supervision label
   and `hasInstructions` come from that list's entry on its slug, so `newItem` and the picker match
   over the same aliases (K23).
3. **(P11-ii-b) A catalog row's taxonomy comes from the tables**: `modality` and `pattern` from
   `movements`, the equipment set from `movement_equipment`, the primary and secondary muscles from
   `movement_muscles`. An old built-in still gets the library's taxonomy by slug (P11-i's path), or
   none.
4. **The DAL only builds the DTO**, field by field, and adds `group`.

## The predicate, written out (panel P1-1)

```ts
// catalog arm
and(
  movementIsGlobal(),
  isNull(movements.deletedAt),
  or(inArray(movements.slug, PICKER_SLUGS), movementIsCatalog()),
);
```

The `or` sits inside the global and live conjuncts. A household row on a picker slug never enters the
catalog arm. `isCatalog` is selected as a column through `movementIsCatalog()` (rule 2's one
predicate, never re-derived as `modality !== null` in TypeScript). Only rows with `isCatalog` true
get table taxonomy, so an old built-in is never given `equipment: []` (which means "No equipment",
`movement-option.ts`'s 🔴).

## Acceptance

### P11-ii-a

- (a1) **Every catalog row is listed**, as `catalogOptionOf(entry, publicId)` with the row's identity
  (name, tracking type, unit, bodyweight flag) written over it, for the library the seed used.
- (a2) **Old built-ins are unchanged.** The 35 legacy rows give exactly the options they give today:
  the expected options are a snapshot taken on main before the change. No table taxonomy is attached
  to any of them.
- (a3) **No other household changes what the caller sees.** Another household owns items on a
  `PICKER_SLUGS` slug, on a catalog-only slug and on a catalog alias. The caller's list is the same
  with or without them. Mutations drop `movementIsGlobal()` and `isNull(deletedAt)` from the catalog
  arm, and each conjunct of the household arm.
- (a4) **A household item a catalog row shadows is left out**, for a catalog-only slug too.
- (a5) **`newItem` selects a catalog row by its alias** (step 1, `existed: true`). A mutation that drops
  the library's aliases from the read turns it red. The ⚠️ in `new-item.ts` step 2 is closed.
- (a6) **K23 pairs.** These are planted on purpose; the fixture is disjoint from the legacy rows, so it
  never makes a pair:
  - the old "Dips" beside a catalog "Dip";
  - a catalog row with the alias `OHP` beside the old Overhead Shoulder Press.

  `newItem` returns the row the picker's search lists first.

- (a7) **No catalog rows at all** (production right after A2-i deploys): the read is today's, and
  `inArray([])` is never sent.
- (a8) **The internal `movements.id` never reaches `MovementOption`.** It stays local to the read, and
  `picker.test.ts` pins the option's keys, slug excluded, as today.

### P11-ii-b

- (b1) **The taxonomy is the tables'.** The proof edits one catalog row's `movement_equipment` and
  `movement_muscles` and the option follows. A mutation that takes the library entry's taxonomy
  instead turns it red. This runs in `db:verify`, because the mapping is in the read now (panel
  correctness 3).
- (b2) **The join reads take listed catalog ids only.** They live in one exported helper,
  `catalogTaxonomyRows(exec, ids)`. The proof asserts its raw rows: no `movement_id` outside `ids`. A
  household-owned join row is planted by hand inside a transaction that is rolled back, so the
  "no household join row" proof stays green. The assembly throws on a join row for an unlisted id. A
  mutation that drops the id filter turns the proof red.
- (b3) **Order:** the order the roadmap thread decides (Q2 below), pinned on an entry whose authored
  order differs from the code order (`incline_dumbbell_press`, `['dumbbell','bench']`). A mutation
  reorders it. The primary muscle and the secondaries are separate selects, never ordered "by role".
- (b4) **Values are parsed** through `modalitySchema`, `equipmentSchema`, `muscleSchema` and
  `movementPatternSchema`, as `declared()` parses the unit. A parse failure means a broken schema,
  not drifted data. The foreign keys to the reference tables and the modality CHECK hold every
  value, so a code can only fail if it leaves the shared vocabulary while rows still hold it. A code
  leaves only after A3 rewrites its rows, which is a note for A3's plan.
- (b5) **Payload measured:** the bytes of `getItemPickerData()`'s result over the real
  `CATALOG_MOVEMENTS` plus the 35 old rows, and at 500. The figures go in the PR body. JSON length
  stands in for the RSC payload. Never measured on production, where household item names are free
  text.

## Files

| File                                                                            | PR   | Change                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/db/src/queries/program/movement-options.ts`                           | a, b | The predicate above; the `library` argument; the catalog arm's aliases, supervision and `hasInstructions` from it; `group` optional; (b) `catalogTaxonomyRows` and the assembly; `taxonomy` a required key on the catalog arm, `Pick<CatalogOptionTaxonomy, 'modality' \| 'pattern' \| 'equipment' \| 'primaryMuscle' \| 'secondaryMuscles'> \| null` (panel S4), reusing the shared type. |
| `packages/db/src/writers/program/new-item.ts`                                   | a    | Takes the library and passes it to the read; docblock step 2 closed. Its one caller (the DAL's write) passes it.                                                                                                                                                                                                                                                                           |
| `apps/web/lib/dal/program/picker.ts`, `writes.ts`                               | a, b | Pass the library in effect (Q1); `pickerOptionOf` copies fields one by one and adds `group`.                                                                                                                                                                                                                                                                                               |
| `apps/web/lib/dal/program/picker.test.ts`                                       | a, b | The three arms, the keys, (b5).                                                                                                                                                                                                                                                                                                                                                            |
| `packages/db/scripts/verify/program.ts`                                         | a, b | (a1)–(a7), (b1)–(b4).                                                                                                                                                                                                                                                                                                                                                                      |
| `packages/db/scripts/mutations/590…`                                            | a, b | One per conjunct and source above, each with its README row.                                                                                                                                                                                                                                                                                                                               |
| `apps/web/test/program-tables-stay-dark.test.ts`                                | b    | Q4 below.                                                                                                                                                                                                                                                                                                                                                                                  |
| `packages/db/src/schema.ts`                                                     | b    | The `movementEquipment` docblock's "nothing in `apps/` reads them until P11-ii" (a board guest edit).                                                                                                                                                                                                                                                                                      |
| `docs/privacy/data-inventory.md`                                                | b    | A one-line re-read: the picker's options carry more catalog rows and the tables' taxonomy, all reference data on global rows (the CHECK holds), no new category.                                                                                                                                                                                                                           |
| `docs/features/program-writers.md`, `program-builder.md`, `movement-catalog.md` | a, b | Which rows the read lists; where an option's fields come from; that the tables are read.                                                                                                                                                                                                                                                                                                   |
| changelog fragment each PR                                                      | a, b |                                                                                                                                                                                                                                                                                                                                                                                            |

## For the roadmap thread (spec owner)

- **Q1. Which library a fixtures database is annotated from** (panel B2). From A2-ii, CI, e2e and
  preview databases hold `CATALOG_FIXTURE` rows (E4), but every reader looks slugs up in
  `CATALOG_MOVEMENTS`. 13 of the 24 fixture slugs are real entries with different aliases, equipment
  and instructions, and 11 have none, so the supervised fixture entry loses its label. Recommended:
  one server-only value in `lib/dal/env.ts` that names the library in effect. It is set beside
  `SEED_FIXTURES` in `ci.yml` and `migrate-preview.yml` (and the preview's Vercel env), and defaults
  to `CATALOG_MOVEMENTS`. Every reader takes it: this read, `newItem`, `getHowTo`, and lane E's
  `dal/day/day.ts:60`, which has the same gap today. Alternative: make the fixture's slugs disjoint
  from the real catalog. Rejected, because every batch PR could then break the fixture.
- **Q2. Equipment and secondary-muscle order** (panel S1). `option.ts:33` says "in the entry's
  authored order"; the tables have no ordinal. A3 writes by difference, so a reorder writes nothing
  and an added item goes last.
  - Recommended: the vocabulary's order (`EQUIPMENT`, `MUSCLES`), in the read and in
    `catalogOptionOf` alike. That is a contract change to `option.ts`.
  - Alternatives:
    - id order, plus a line on A3's row that it rewrites a movement's whole set when the order
      differs;
    - an ordinal column, which is a migration.
- **Q3. Spec cells.**
  - The P11-ii row: "After P11-i and **A2-i**".
  - The A2-ii row: "after P11-ii-a is deployed".
  - The P11-ii row's "`apps/web/lib/dal/program/` maps it" becomes "the read maps it; the DAL builds
    the DTO", which matches criterion P11.
  - The split into P11-ii-a and P11-ii-b is recorded.
- **Q4. The stays-dark `describe`** (`program-tables-stay-dark.test.ts:418-460`). S6 holds it only
  "until P11-ii", and 0032's deploy window has closed. Recommended: P11-ii-b retires it, with lane
  A's agreement, rather than growing an allowlist that A2-i and A3 must each edit.

## Not in this chunk

- Hiding any old built-in (K22: not until R2).
- A household item's taxonomy (rule 11; Beta 0 has none).
- Loading options when the picker opens (only if the measured payload says so).
- B3's tree, which reads these fields unchanged (`cat-3-b3-browse-by-kind.md` § "Compatibility with
  P11-ii").

## ID-1's six keep-open items

1. **The principal is a login:** not touched; no profile or login column.
2. **Every access goes through `getHouseholdScope()`:** still true, through `householdMovementRows`
   (`picker.ts`). The write path's `newItem` takes the scope as today.
3. **Nothing relies on one household per person:** nothing new depends on it; `cache()` is per
   request.
4. **Nothing pins an athlete to a household:** no `(household_id, profile)` key or cache key is
   added. This is movement data, not profile data.
5. **No age logic.** The read adds no muscle word and parses through `muscleSchema`, so the `MUSCLES`
   list kept stable for a later body map is untouched. The read is per movement and never joined to
   `entries`. A per-athlete muscle summary would be derived data that needs its own inventory row.
6. **Roles stay a const plus a CHECK:** not touched.

A household's own items keep travelling with their join rows when a household takes its history.
That rule is the `movementEquipment` docblock's, not an `ID-1` item.

## Review-response log

Panel on the first draft (2026-11-19): correctness, privacy and architecture, on Opus.

| #                | Lens                      | Finding                                                                                                                                                                    | Response                                                                                                                            |
| ---------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| B1               | architecture, correctness | `newItem` matches over the read, which gives a catalog row no aliases, so (g) could not pass and the server and picker could choose different rows ("Strict press", "OHP") | **accepted**: the read takes the library and attaches the const fields (Goal 2, a5, a6)                                             |
| B2               | architecture, correctness | Fixtures databases hold `CATALOG_FIXTURE`, but the DAL reads `CATALOG_MOVEMENTS`: wrong aliases, labels and "How to"; decision 1's premise is false there                  | **accepted** as Q1 for the spec owner; decision 1 is replaced by it                                                                 |
| P1-1             | privacy                   | The `or` read literally drops the global conjunct for the picker slugs; (d) planted nowhere that would show it                                                             | **accepted**: the predicate is written out; (a3) plants on all three kinds of slug, with mutations on the global and live conjuncts |
| P1-2, C4         | privacy, correctness      | (f) cannot go red: unlisted join rows are discarded in assembly                                                                                                            | **accepted**: (b2), a helper asserted on its raw rows, the assembly throws on an unlisted id, the plant is rolled back              |
| C3               | correctness               | (b)'s mutation targets the DAL, which `db:verify` never runs                                                                                                               | **accepted**: the mapping moves into the read (B1), so (b1) runs in `db:verify`                                                     |
| C5               | correctness               | Taxonomy must follow `movementIsCatalog()`, or old built-ins get `equipment: []`; cover zero catalog rows                                                                  | **accepted**: `isCatalog` column, (a2), (a7)                                                                                        |
| C6               | correctness               | K23 (Enter and `newItem` pick the same row) is not tested, and this is the first PR where a pair can exist                                                                 | **accepted**: (a6)                                                                                                                  |
| S1, C7           | architecture, correctness | Ordering by id cannot survive A3's by-difference write (architecture); id order is fine if a proof pins it (correctness)                                                   | **Q2** for the spec owner, recommending the vocabulary order; (b3) pins whichever is chosen                                         |
| S2               | architecture              | Split: the rows (unblocks A2-ii) and the taxonomy                                                                                                                          | **accepted**: P11-ii-a and P11-ii-b                                                                                                 |
| S3               | architecture, correctness | The gate on A2-ii is on neither spec row                                                                                                                                   | **accepted**: Q3                                                                                                                    |
| S4               | architecture              | An optional `taxonomy` invites a placeholder; reuse the shared type                                                                                                        | **accepted**: a required key, `Pick<CatalogOptionTaxonomy, …> \| null`                                                              |
| P2-1             | privacy                   | The ID-1 section cited a non-item                                                                                                                                          | **accepted**: the six items answered                                                                                                |
| P2-2             | privacy                   | The inventory and the schema docblock were missing from Files                                                                                                              | **accepted**                                                                                                                        |
| P2-3             | privacy                   | Keep `movements.id` off `MovementOption`                                                                                                                                   | **accepted**: (a8)                                                                                                                  |
| N1, C-decision 3 | architecture, correctness | Parsing in `packages/db` can take the picker down; say why that is acceptable                                                                                              | **accepted**: (b4)                                                                                                                  |
| N2               | architecture              | The stays-dark allowlist would grow each chunk; S6 ends at P11-ii                                                                                                          | **Q4**                                                                                                                              |
| N3, C8           | architecture, correctness | The payload was measured at the wrong size and asserted nothing                                                                                                            | **accepted**: (b5), on the real library and at 500, figures in the PR                                                               |
| —                | architecture              | Muscles "by role" relies on alphabetical order                                                                                                                             | **accepted**: separate selects (b3)                                                                                                 |
| —                | architecture              | Outside this plan: `dal/day/day.ts:60` has B2's gap                                                                                                                        | folded into Q1 (lane E owns that file)                                                                                              |
