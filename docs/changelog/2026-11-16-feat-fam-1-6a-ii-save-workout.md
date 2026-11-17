# The program writers can save a workout, and the editor's read loads it back

FAM-1 step 6a-ii, lane P's second PR: the database side of the workout editor's Save. Nothing in the
app calls it yet; step 7a wires it.

- `saveWorkout` stores the editor's whole draft: the workout's name and description, and its items in
  order with their sets, reps, instructions, superset places, rest and prescribed quantities. Each
  item card keeps its row across saves and reorders, so what was logged against it stays attached. A
  removed card is hidden with its quantities, and a swapped item gets a new row. Saving the same draft
  again adds no row. Two saves of one program run one after the other, so a double tap of a new
  workout answers as one save.
- It refuses, before writing anything: a draft that breaks the contract's rules (`invalid`), a
  program, workout or item the household does not have (`not_found`), and another workout's name in
  the program, compared folded (`name_taken`).
- `readWorkoutDraft` loads a saved workout the way the editor expects it. `db:verify` proves it
  deep-equals the contract's `heavy-a-draft` fixture. `programIn` and `workoutIn` say whether an id
  is one of the household's live programs or workouts, for the actions' DAL.
- `@mat-plan/db` now exports the program writers by name, and a test keeps the app from importing
  them before 7a.
- Ten new `db:mutations` patches (132–141) show the proofs fail when the reorder, the card matching,
  the household or program check, an edit, the read's hidden-card filter, the superset rule, the name
  fold or the quantity matching is broken.
