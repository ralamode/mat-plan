- **2026-10-01** — **V1-27: doing some of a movement's sets submits** ([plan](../plans/v1-27-partial-sets.md)).
  A kid who did 2 of 3 prescribed sets used to hit "Please fill out this field" on the row they left
  blank on purpose, with no way out but a Remove button nobody was told about. Now the empty rows **after
  the last entered set** are not `required` and are not sent, and a line above **Log strength** ("Logs 4
  movements, 11 sets.") says exactly what the tap will log — the safeguard for the trade-off Ray accepted:
  a forgotten last set is logged short instead of blocking the session. A gap, a half-entered set and a
  named movement with no sets still block, now with "Fill in this set, or tap Remove if you didn't do
  it." The "touched" rule lives in one module (`strength-form-untouched.ts`), so the collapsed counter
  agrees with what is sent, and a renamed scaffolded card is never silently dropped. No server
  validation or wire change. Planned and panelled first; filed V1-35 and a V1-24 follow-up.
