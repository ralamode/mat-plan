- **2026-11-17** — **FAM-1: an id written in upper case is the same id as its lower-case spelling, everywhere the program shapes are read**
  ([guide](../features/program-contract.md); contract change C25, from the review of the workout
  writer). The database treats a uuid's two spellings as one id, but the shapes compared ids as
  written, so a workout could be sent with two cards under one id spelled two ways and pass the
  "each card has its own id" check. Every id in the program and day shapes is now handed back in
  lower case when it is parsed, so the shapes' own checks, the preview's fakes and the writers all
  compare one spelling. The workout writer's own lower-casing and its second check, which now did
  nothing, are removed, and the two tests that guarded them guard the shapes instead. Nothing
  changes for an id the app made itself, which is always lower case.
