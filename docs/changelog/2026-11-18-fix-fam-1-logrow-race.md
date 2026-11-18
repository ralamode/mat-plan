- **2026-11-18** — **FAM-1 11b: a ✓ on a set another phone un-ticks in the same instant is saved,
  not an error.** `logRow`'s insert skips when the set is held. Its re-reads then explain why, but the
  holder can be un-ticked or cleared between those statements, leaving nothing to explain the skip,
  and the writer threw "neither inserted nor held" to the error page. It now re-runs the insert once
  for exactly that case, as lane S's #578 does for practice and weigh-ins; a second miss still
  throws. Found in #578's review. Mutation 372.
