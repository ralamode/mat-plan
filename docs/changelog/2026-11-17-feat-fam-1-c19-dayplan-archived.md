- **2026-11-17** — **FAM-1: a day's data says when its athlete is archived** ([guide](../features/program-contract.md);
  contract change C19; the maintainer's decision, 2026-11-17). `DayPlan` gains `archived`, so the
  day screen can say "<Name> is archived. Nothing new can be logged." instead of showing a
  read-only day with no reason. The day's read sets it from the profile. One fixture has it
  `true`; the preview's fake already refuses a write on such a day. The screen's line, the line
  for a closed day with nothing logged, and the athlete switcher showing whenever there is another
  athlete to go to are lane C's to build. No schema change, no new dependency.
