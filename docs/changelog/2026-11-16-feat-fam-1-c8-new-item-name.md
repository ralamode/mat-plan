- **2026-11-16** — **FAM-1 contract change C8: adding an item that already exists answers with its
  name, and an alias counts** ([plan](../plans/fam-1-family-program.md) §4, steps 6a and 9;
  [contract](../features/program-contract.md) invariant 15). `ProgramActions.newItem` now resolves
  `name` on every success: the item's stored name, so the editor's card shows "Push-ups" when
  `push ups` was typed. `existingItem(options, name)` in `@mat-plan/shared` is the one rule for
  "this item exists": the typed name matches an item's name by the picker's key, or one of its
  aliases (`RDL` is Romanian Deadlift). Either selects that item and adds nothing; it is not a
  refusal. It is the same two cases in which the picker already withholds "add as new", so the
  server and the picker cannot disagree. The preview's fake uses it; the real writer (step 6a) and
  the picker's guard (step 9) are held to it by the plan. A name the rule cannot match on at all
  (`S`: the fold drops a lone `s`) is refused as `invalid`. Preview route only; no production screen,
  schema or stored data changes; no new dependency.
