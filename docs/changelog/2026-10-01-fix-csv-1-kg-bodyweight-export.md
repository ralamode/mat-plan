- **2026-10-01** — **CSV-1: a kg weigh-in can no longer export as pounds.** The bodyweight file's
  column is `weight_lb`, but the form also offers `kg`, and the export never read the unit — so a kg
  weigh-in would have been written as a bare number and read downstream as pounds, a silent 2.2× error.
  `bodyweightMonthRows` now selects `unit`, and `buildBodyweight` refuses anything but `lb`, failing the
  export loudly rather than converting (a converted number is one the athlete never logged). Production
  holds no kg weigh-in, so nothing changes for real data today. Proven in `db:verify` (the read carries
  the unit) and `csv/bodyweight.test.ts` (lb is byte-identical; kg is refused).
