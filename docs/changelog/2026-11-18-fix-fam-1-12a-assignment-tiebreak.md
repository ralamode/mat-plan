- **2026-11-18** — **FAM-1 12a: two programs tied on order keep their places after a put-on.** A put-on
  compacts the order of an athlete's open programs (`writers/program/assign.ts`, 6c-i) and leaves a
  program ending today at the number it had, so the two can share one. The day page broke that tie by
  row id, so an unrelated put-on could swap them. `currentPrograms` now puts the program that stays
  first, then breaks any tie left by id. Found in lane P's review of #588. Mutation 367.
