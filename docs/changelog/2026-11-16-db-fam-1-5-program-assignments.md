# Which athlete is on which program, and erasing one athlete

FAM-1 step 5, migration `0027` (two new tables, dark: nothing reads or writes them until lane P's
put-on, step 6c).

- `program_assignments`: an athlete on a program, from `active_from` through `active_to` (the
  inclusive last day; NULL while open), with the athlete's program order (`idx`). One live row per
  athlete, program and start; one open row per athlete and program; one open program per place.
- `program_assignment_weekdays`: which days of the week an assignment is due (0 is Sunday).
- `queries/program-assignments.ts` spells "on day D" and "due on D" once, for every later reader.
- `db:verify` proves each key one column at a time, the inclusive last day, the weekday origin
  against literal dates, four audits (a legacy block, across households, overlapping rows, no
  weekday rows), and both erasure orders; mutations 98–109 prove the proofs can fail.
- The runbook gains household-delete steps 9c and 9d, pre-flight (h), and a new procedure to erase
  one athlete. The privacy inventory and notice say what is stored and how one athlete is removed.
