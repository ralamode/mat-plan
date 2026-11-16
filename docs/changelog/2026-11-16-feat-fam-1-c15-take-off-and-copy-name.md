- **2026-11-16** — **FAM-1 contract change C15: a same-day Put on can be undone, and a copy can be
  named** ([plan](../plans/fam-1-family-program.md) steps 6c, 6d, 6a-iii, 10b and 15;
  [contract](../features/program-contract.md) invariants 19 to 21). Four decisions by the maintainer
  from the review of the Copy and Put-on dialogs. Take off now removes a start dated today when
  nothing is logged under it, as if Put on had not been tapped; it answers what it did (`lastDay`:
  today, or nothing when the start was removed), so the screen's message is true for a start dated
  today, which can be either. `CopyDraft` gains an optional `name`: the Copy dialog will show a Name
  field for a copy into the workout's own program, prefilled with its name and " (copy)", and a name
  already used there is refused. A copy into another program that already has a workout of that name
  is refused the same way, and the dialog then asks for a name, so no program ever holds two
  workouts with one name. And Put on undoes a Take off whose last day is today: the athlete stays on
  with no gap. The preview's fake follows all of it; the real writers are steps 6a-iii, 6c and 6d.
  Preview route only; no production behaviour, schema or stored data changes; no new dependency.
