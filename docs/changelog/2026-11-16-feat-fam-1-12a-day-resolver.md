- **2026-11-16** — **FAM-1 step 12a-i: the day resolver builds an athlete's day from the database**
  ([plan](../plans/fam-1-12a-day-resolver.md), [FAM-1](../plans/fam-1-family-program.md) §5 step
  12a). `resolveDayPlan` (`packages/db/src/queries/day/day-plan.ts`) turns an athlete and a day into
  every `DayPlan` field but `athletes`: the programs and workouts on the day in the athlete's order,
  each item's rows and progress, what each logged row stored and was logged against, and PREVIOUS
  (`previous.ts`, one query). What is on the day is read from the athlete's assignments on live
  template blocks of the household; what was logged is read from the athlete's own program rows,
  and a row whose workout or prescription belongs to another household is dropped. A weigh-in, a
  practice or a check-in never enters the day. An archived athlete's day reads like a closed day.
  The row writer now takes its conjuncts and its prescription's unit, target and text from the same
  `queries/day/` modules the resolver reads (no behaviour change; eleven mutation patches
  regenerated). `db:verify` seeds the ten fixtures with no `before`, deep-equals each with ids mapped
  exactly, and round-trips the returned ids through the row writer; new proofs cover ownership
  (planted runbook (f), (g) and (h) rows), hidden rows, superset and program order, look-ahead and
  PREVIOUS, the hidden-program ids (C21) and an entry in another profile's session (runbook pre-flight
  (i), added), with eighteen new mutations (230–247). Of the five fixtures with a `before`, 12a-i
  proves `archived-athlete-today` (its only change is the archive); the other four are 12a-ii's.
