- **2026-11-17** — **One rule for "the day is open"**
  ([guide](../features/program-contract.md), invariant 24; FAM-1 contract change C34). Whether an
  athlete's day can be written to (today or yesterday, and the athlete not archived) is now one
  shared function, `dayOpenFor`. The contract's test data uses it; the day page's read, the row
  writer and the day's clear switch to it in their own PRs. Nothing changes for a person using
  the app.
