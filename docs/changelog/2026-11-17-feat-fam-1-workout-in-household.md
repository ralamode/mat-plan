# A read tells whether a workout id is one of the household's

FAM-1, lane P, ahead of step 6a-iii: `workoutInHousehold(exec, scope, workoutPublicId)` answers
whether an id names a live workout in any of the household's live programs. It is for callers that
have a workout's id but not its program's: the copy action's report of which id missed (7a-ii) and
the day page's (12b). Every miss, from another household, a hidden workout or program, an unknown or
a malformed id, is the same `false`.

- `db:verify` proves each case; three new `db:mutations` patches (300–302) show the proof fails when
  the read stops leaving out hidden workouts, stops checking the household, or takes a block that is
  not a program.
- `program-tables-stay-dark.test.ts` lets the day DAL (`lib/dal/day/`) import this read, and no other
  of lane P's, alongside the program DAL; neither DAL may re-export a lane P name.
