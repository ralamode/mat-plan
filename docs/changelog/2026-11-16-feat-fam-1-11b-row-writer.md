- **2026-11-16** — **FAM-1 step 11b: the row writer's plan** ([plan](../plans/fam-1-11b-row-writer.md),
  [FAM-1](../plans/fam-1-family-program.md) §5 step 11b). One writer, `logRow`, will store a tick on a
  row of any of the seven tracking types once, and answer with a typed result; `untickRow` and
  `retickRow` come with it. The plan was reviewed by five lenses and re-reviewed by three. It keeps
  §5's gate (the athlete-on-the-program check, merging after step 5 is applied) and imports the row's
  value rules from contract step C10. Code follows in this PR.
