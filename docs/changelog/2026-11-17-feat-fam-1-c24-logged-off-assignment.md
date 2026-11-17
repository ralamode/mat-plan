- **2026-11-17** — **FAM-1: a logged workout keeps its program's ids when only the athlete's place on it changed**
  ([guide](../features/program-contract.md); contract change C24, a forward note from the day
  resolver). If an athlete's start on a program is removed and a row they had logged that day
  comes back afterwards, the day shows that workout as one that left the week: its logged rows,
  with the program's and workout's ids, description and count kept. Whether an id is there depends
  on the program and workout being live, never on the assignment. A comment and a sentence; no
  code changes, and the state is not reachable until step 6d.
