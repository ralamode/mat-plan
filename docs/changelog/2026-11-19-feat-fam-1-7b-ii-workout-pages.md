- **2026-11-19** — **A parent writes and edits a program's workouts on real pages** (FAM-1 7b-ii,
  [plan](../plans/fam-1-7b-builder-pages.md)). `/programs/[programId]/workouts/[workoutId]` and
  `/workouts/new` mount the workout editor with the real actions and "How to"; the program page's
  workout rows and "+ New workout" are links. A new workout's id is minted on the device when the
  editor opens, and every way out of the editor replaces its history entry, so Back after a Save
  never reopens it. The editor says when a program is full; "+ New item" stops when the household
  has 500 items of its own (a name that is already an item still selects it); a full workout's
  "+ Add items" looks stopped. A workout opened under another of the household's own programs is a
  404 and is no longer reported as a cross-household miss. The privacy notice no longer says these
  screens are coming.
