- **2026-11-17** — **FAM-1 step 12b's prep: the day page can tell which id of a refused tick missed
  the household** ([FAM-1](../plans/fam-1-family-program.md) §5 step 12b). `prescriptionLiveIn(exec,
scope, prescriptionPublicId)` (`packages/db/src/queries/day/prescription-live-in.ts`) answers
  whether an id names a live prescription of one of the household's live programs; a malformed id is
  `false`. After the row writer answers `not_found`, 12b's day DAL checks the workout first (lane P's
  `workoutInHousehold`), then the prescription, and reports only the first miss, as the program
  builder's `reportProgramMiss` does. `db:verify` proves it against another household, an unknown id,
  a hidden prescription and a hidden program; mutations 251 and 252 drop its household and liveness
  conjuncts.
