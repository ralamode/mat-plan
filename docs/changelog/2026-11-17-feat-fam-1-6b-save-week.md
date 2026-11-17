# The program writers can save a program's week, and read it back

FAM-1 step 6b, lane P: the database side of the week editor. Nothing in the app calls it yet; step
7a-ii wires it.

- `saveWeek` stores the whole week: for each weekday, its workouts in order, each with an optional
  label. A slot keeps its row while its workout stays on that day, so moving or relabelling it
  changes only its place or label. A slot taken off a day is hidden, which frees its place, and the
  workout can go back on that day later. Saving the same week again writes nothing.
- It refuses, before writing anything: a week that breaks the contract's rules (`invalid`), a
  workout twice on one day (`once_per_day`, also when the two ids differ only in case), and a
  program or workout the household's program does not have (`not_found`).
- `readWeek` loads a program's week in the editor's shape: every weekday, a rest day as `[]`.
- Five new `db:mutations` patches (145–149) show the proofs fail when the band, the hiding of a
  removed slot, the slot matching, the id case or the program check is broken.
