- **2026-11-17** — **FAM-1: one shared starting point for an empty week**
  ([guide](../features/program-contract.md); contract change C26, from the review of the week
  writer). "A week with nothing on any day" was being written out in each place that needed one.
  It is now one helper, `emptyWeek()`. The fixtures and one test use it today; the week's read and
  its proofs are to use it when step 6b merges (#522). No behaviour changes.
