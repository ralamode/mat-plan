- **2026-11-17** — **CAT-3 B2-i: every picker row says how it is logged and what it needs, shows a
  supervision label, and can open "How to"** ([spec](../specs/cat-3-movement-library.md) P13, P14,
  P16; [guide](../features/movement-picker.md) invariant 14). In both picker modes a row's second
  line reads its tracking type and its equipment ("Weight × reps · Barbell, Bench"), "No
  equipment" for none, or "Custom item" for a household's own item. A movement marked for
  supervision shows "Learn with a coach present" on its row at full contrast. A library row with
  instructions carries a "How to" button that opens its steps under the row, the label first; the
  steps come through a loader the caller passes, and no production caller passes one until the
  option read carries the slug. In multi mode the check box moves to the left. The near-miss
  headings are now "Did you mean" and "Has some of your words", and the household section is "Your
  custom items". A library option now requires its equipment, muscles and other library fields. No
  schema change, no new dependency.
