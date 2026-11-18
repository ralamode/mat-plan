# Athletes can be put on a program, and the test database holds the fixture family's programs

FAM-1 step 6c-i, lane P: the database side of "Put someone on". Nothing in the app calls it yet; step
15 wires it.

- `putOn` puts one or more athletes on a program from today or tomorrow. Each goes last in their own
  order of programs and is due all seven days. Someone already on it is left as they are. Someone
  taken off it today is put back on the same stretch, with no gap, whatever start day was picked.
- With `SEED_FIXTURES=1` (CI's e2e job, the preview database and the local harnesses, never
  production), the seed now writes the fixture family's three programs, built with the real program
  writers, and puts Athlete One and Athlete Two on them from the fixtures' days. A program the
  database already has is left alone on a later seed. Items the catalog already has are the
  catalog's (the fixture's "DB bench press" is seeded as the catalog's Dumbbell Bench Press).
- Sixteen new `db:mutations` patches (402–417) show the proofs fail when `putOn` takes a wrong day, an
  archived or another household's athlete or a legacy program, skips the same-day reopen, leaves a gap
  in the order or writes six days, and when the seed reorders or rewrites its programs, puts an archived athlete on, or uses an item of the wrong type. The seed skips an archived seed athlete, or a program whose item the household has under another type, with a warning rather than failing the preview seed.
- Four `db:verify` assertions elsewhere, which assumed the seed writes no template program, now say
  what they meant: the catalog count counts catalog rows, the seeded-program count counts the
  authored block, the household-delete rehearsal deletes quantities before prescriptions, and the
  "every seeded block is legacy" and "the seed writes no program without fixtures" proofs name the
  fixture programs and count their workouts and assignments too.
