- **2026-10-01** — **V1-27 planned: doing some of a movement's sets will submit**
  ([plan](../plans/v1-27-partial-sets.md)). Untouched sets **after the last entered set** stop being
  `required` and are not submitted, and a line above **Log strength** ("Logs 4 movements, 11 sets.")
  says exactly what the tap will log. A gap, a half-entered set and a named movement with no sets still
  block, now with a message that names the way out. No server validation or wire change. Revised after
  independent correctness, architecture/scope and UX panels; filed V1-35 (an ambiguous movement name in
  an error) and a V1-24 follow-up (add a set to a logged entry). Implementation lands after #201 (V1-30).
