- **2026-11-16** — **FAM-1 step 11b: a tick on any program row is stored once and answered with a
  typed result** ([plan](../plans/fam-1-11b-row-writer.md), [FAM-1](../plans/fam-1-family-program.md)
  §5 step 11b). `logRow`, `untickRow` and `retickRow` (`packages/db/src/writers/day/log-row.ts`)
  handle all seven tracking types, each in one transaction that answers a `RowResult`; a refusal after
  the first insert rolls back. A replay answers first and only for the same profile, day, set,
  prescription and workout; a mismatched workout and prescription, or another household's profile
  naming this household's workout, answers `not_found` with nothing written. The row's values come
  from contract step C10's shared rules. `hide.ts`'s restore gains the program row arbiter, so a
  re-tick onto a set ticked again answers `slot_taken`, and its matcher is now the shared
  `isUniqueViolationOn`. 34 `db:verify` proofs in `verify/day.ts` and mutations 110–119, 121–129 and 170–181
  (46–48 retargeted, 86 regenerated). **Owed:** the "on the program that day" check, which lands
  with step 5; until then this stays a draft (plan M7). No Server Action calls the writers yet (12b).
