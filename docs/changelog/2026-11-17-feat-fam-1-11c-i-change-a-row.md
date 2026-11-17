- **2026-11-17** — **FAM-1 step 11c-i: Change corrects a logged row's numbers**
  ([plan](../plans/fam-1-11c-change-and-revive.md), [FAM-1](../plans/fam-1-family-program.md) §5
  step 11c-i). `amendRow` (`packages/db/src/writers/day/amend-row.ts`) changes a logged program row
  in place, on today or yesterday, for every tracking type. It finds the entry in one scoped, locked
  read (this athlete's, in their own session), and runs the ✓'s own checks: the steps they share
  move to `writers/day/row-steps.ts`, unchanged. A number must be in the unit the row was logged in,
  so a program later edited from lb to kg cannot relabel a stored load. Nothing is filled in, so a
  blank keeps the number that is there. The write is `updateEntrySetRows`
  (`writers/session-rows.ts`): the one live set and its quantities, matched on slot and stored unit,
  each UPDATE asserting one row, with `updated_at` advanced. `db:verify` proves each refusal and the
  in-place write, and mutations 348–356 and 358–363 each turn one of them red. An un-tick now reads
  the numbers it answers after it has locked the row, so one racing a Change answers what it hid. The Server Action that calls it is 12d's.
