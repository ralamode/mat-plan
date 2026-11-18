- **2026-11-18** — **The day's data carries the coach label, and says which program ends today**
  ([guide](../features/program-contract.md), invariants 19, 30, 32 and 33). A movement the
  library marks "learn with a coach" now carries that label in the day's data, so the day page
  can show it beside the movement. A program whose last day is today is listed last among an
  athlete's programs and is marked, so the Reorder dialog can show it without arrows. A copy onto
  a weekday that already holds 30 workouts is refused in the preview as it is in the app, and a
  second tap on Take off answers the same as the first. These are the rules and test data; the
  day page shows the label and the dialog change in their own PRs.
  The day's reader fills both: it reads each library movement's label from the library it is handed
  (the real one in the app), only for library movements and never a household's own item, and marks
  a program ending today with the same rule that sorts it last (`programEndsToday`, which lane P's
  reorder writer will import). Mutations 373 to 375.
