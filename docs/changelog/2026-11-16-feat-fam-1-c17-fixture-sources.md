- **2026-11-16** — **FAM-1: the day fixtures can be seeded, and their builder keeps the contract's own
  rules** ([guide](../features/program-contract.md); contract change C17, for step 12a). The world
  each `DayPlan` fixture was built from is exported as `DAY_PLAN_FIXTURE_SOURCES`, so the day
  resolver's proof can seed it and compare. Three things the fixture builder had differently from
  the contract's text now match it: a gap below an extra logged set is not a row; a day's programs
  and its workouts share one order, current programs first; and where only logged rows show, a
  workout has the name it was logged under. One new fixture, `closed-day-program-since-left`, holds
  the last two. No existing fixture changed. The day resolver, not the page's data layer, sets
  whether a day is writable, future, or can go forward. No schema change, no new dependency.
