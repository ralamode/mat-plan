- **2026-11-17** — **FAM-1: the day's data never carries the id of a program or workout that is hidden**
  ([guide](../features/program-contract.md); contract change C21, from the day resolver's code
  review). The contract said a workout's ids are empty once it is purged and was silent about a
  hidden one. Now: an id is there only for something the household can use, so hidden reads as
  purged does, and a logged workout that is no longer live shows from its logged rows alone, so
  none of a hidden program's own text reappears. A comment and an invariant; no code changes, no
  fixture changes, and no FAM-1 action hides a program yet.
