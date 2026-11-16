- **2026-11-16** — **FAM-1 step 8: the workout editor, built on the preview route**
  ([plan](../plans/fam-1-family-program.md) §5 "Lane B", §8). Each item is a card with its fields
  by tracking type (sets, reps, and a weight, time or distance with a unit select limited to the
  type's units), its instructions, Up, Down and Remove; the workout has its name (a counter to 30),
  a description and one Save, in a save bar that stays in view. Every refusal the writer would make
  is caught on its field before Save calls, and that field takes focus; Enter never saves. Moving or
  removing a card keeps supersets well formed, so a group left with one item ends with its rest.
  Leaving with unsaved changes asks first. When the route passes the program, the back link names
  it and the editor says who a change applies to. Linking supersets arrives at 8b, adding items at
  9, the real page at 7b. Nothing is mounted outside `/design/program`; no schema change, no new
  dependency.
