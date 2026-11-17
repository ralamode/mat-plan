- **2026-11-17** — **FAM-1: two rules for the day page settled, and step 12a is two PRs** ([guide](../features/program-contract.md);
  contract change C18; the maintainer's decisions, 2026-11-17). A workout that was logged on a day
  and has since been taken off that weekday still shows there, now with **no label**: the label
  was its slot's heading and the slot is gone. **An archived athlete's day is never writable**, so
  their today shows only what they logged, like any closed day; a new fixture,
  `archived-athlete-today`, holds it. The plan splits the day's read: 12a-i (the read and
  PREVIOUS) gates the first real ✓, and 12a-ii replays the fixtures that describe a change after
  logging, once lane P's writers exist. 50 PRs in all. No schema change, no new dependency.
