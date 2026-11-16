- **2026-11-16** — **FAM-1 contract change C13: one rule for the unit an item logs in**
  ([plan](../plans/fam-1-family-program.md) steps 11b and 12a;
  [contract](../features/program-contract.md), the helpers table). `itemUnit(trackingType,
quantities)` in `@mat-plan/shared` is what `DayItem.unit` holds: nothing for a Check or Reps, the
  type's fixed unit for a Duration or Time per set, else the unit the prescription names. The row
  writer (step 11b) and the day's read (12a) will both call it, because the shared fill rule refuses
  a number in any other unit, so two definitions that disagreed would turn a correctly typed number
  into a refusal. Every day fixture's items already agree with it (a test checks). Also `asDb(tx)`
  in the database proofs' harness, a cast written inline three times in the schema proofs and once
  more in the row writer's open PR; the proofs adopt it in their own lanes' PRs. From step 11b's
  code review. No production behaviour, schema or stored data changes; no new dependency.
