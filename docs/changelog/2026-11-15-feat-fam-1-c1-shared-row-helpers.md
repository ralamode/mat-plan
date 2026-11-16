- **2026-11-15** — **FAM-1 contract change C1: the contract exports the small helpers the first lane
  PRs each wrote for themselves, and one client-safe spelling of a quantity**
  ([guide](../features/program-contract.md) → "Helpers the lanes import";
  [plan](../plans/fam-1-family-program.md) §4). Five additions to `@mat-plan/shared`'s root barrel,
  no shape, schema or fixture changed: `quantityText(value, unit)`
  (`program/quantity-text.ts`), `slotQuantity(item, quantities)` (`program/pieces.ts`), the types
  `DayWorkout`, `DayItem` and `DayRow` (`program/day-shapes.ts`), `hasStarted(athlete, today)`
  (`program/program-shapes.ts`) and `MONDAY_FIRST` (`day.ts`). **The gap this closes:** a
  prescription's quantity was spelled by a private function in `prescribed-text.ts` that read the
  CSV's suffix map, so it was reachable only from a server-only subpath; the day screen spelled a
  logged value itself, and a logged `30 sec` sat beside a prescribed `30 s`. `prescribedText` now
  calls `quantityText`, which a `'use client'` component can import, so there is one spelling. Its
  two primitives (`formatNumeric`, and seconds written `s`) moved to
  `packages/shared/src/quantity-spelling.ts`, which imports nothing; `csv/value.ts` re-exports
  `formatNumeric` unchanged and reads the same `s` into `CSV_UNIT_SUFFIX`, and the CSV's own tests
  pass untouched. `quantity-text.test.ts` holds every unit against what `prescribedText` printed
  before, and scans every module `quantityText` reaches, and the root barrel's whole graph, for
  `csv/`. The contract's own callers use the exports: `prescribed-text.ts`, the preview's
  `fakes.ts`, and the fixture builder (which had a third copy of the day types and of the
  Monday-first order). The lanes swap their copies for these in their next steps. No schema change,
  no migration, no change to production behaviour.
- **2026-11-16** — **FAM-1 contract change C2: four more shared names, and `saveWorkoutSchema`
  holds a set count to the item's tracking type** ([guide](../features/program-contract.md) →
  "Helpers the lanes import" and "The sets rule on save"). `DEFAULT_TRACKING_TYPE`
  (`packages/shared/src/movements.ts`, `weight_reps`) names the type an item gets when none is
  given, which was a bare literal in the schema's column default;
  `packages/db/src/tracking-type-default.test.ts` holds the const and that default equal, and the
  tracking-type docblock, stale since step 3, now says the array is stored data and a change is a
  migration. `rolledBack(fn)` is exported from `packages/db/scripts/verify/harness.ts` for every
  proof module (lane A's private copy in `verify/schema.ts` is untouched; it swaps in its next
  step). `ProgramListEntry` names one program of a `ProgramList`. **The one rule added:**
  `saveWorkoutSchema` refuses an item logged set by set that has no set count, and a set count on
  a Check, Count or Duration; `workoutDraftSchema`, which the editor loads, is as tolerant as
  before. Every `WorkoutDraft` fixture and every workout in the prototype's world already kept
  the rule, so no fixture changed, and the preview's fake refuses the same drafts because it
  parses with the same schema. `prescribed-text.ts`'s note now says what is true: it is kept out
  of the root barrel, and a client component may import its subpath. Two more rules that two
  lanes had each written are exported once: `PLAIN_DECIMAL` and `isPlainDecimal(text)`
  (`packages/shared/src/units.ts`), the shape of a quantity typed into a text field, the same
  pattern byte for byte as the day page's; and `supersetLabels(items)`
  (`program/pieces.ts`), the A1, A2, B1 labels by `supersetSchema`'s rule (ordinal letters among
  the items shown, AA after Z). No schema change, no migration, no change to production
  behaviour.
