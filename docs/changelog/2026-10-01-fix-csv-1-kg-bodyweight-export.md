- **2026-10-01** — **CSV-1: a kg weigh-in exports as pounds, correctly, with what was logged kept.**
  The bodyweight file's column is `weight_lb`, but the form also offers `kg`, and the export never read
  the unit — so a kg weigh-in would have been written bare and read downstream as pounds, a silent 2.2×
  error. `bodyweightMonthRows` now selects `unit`; `buildBodyweight` writes `lb` as logged and converts
  `kg` (× 2.20462262185, one decimal, half-up), appending `logged <value> kg` to notes. Ray chose
  converting over refusing (2026-10-02): a kg tap is ordinary and unrepairable in the app, so a refusal
  would have broken the whole export. Any other unit still throws. Production holds no kg weigh-in, so
  real exports are byte-identical today. Proven in `db:verify` (the read returns a kg row as `kg`) and
  `csv/bodyweight.test.ts` (lb byte-identical; kg converted with rounding edges; unknown unit throws).
