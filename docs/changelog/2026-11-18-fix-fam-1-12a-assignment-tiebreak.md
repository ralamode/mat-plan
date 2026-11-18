- **2026-11-18** — **FAM-1 12a: a program ending today is listed after the ones that stay** (ADR 0007
  Amendment 5, the maintainer, 2026-11-18). A put-on compacts the order of an athlete's open programs
  (`writers/program/assign.ts`, 6c-i). A program ending today keeps its number, so the two can share
  one. The day page ordered `(idx, id)`, so an unrelated put-on could swap two programs. `currentPrograms`
  now orders `(rank, idx, id)`: every program that stays first, in its own order, then the ones ending
  today. It also returns each program's placing row's days, for lane P's program view. Found in lane P's
  review of #588. Mutation 367.
