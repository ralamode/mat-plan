- **2026-11-16** — **FAM-1 step 8b: link supersets and edit their rest in the workout editor,
  on the preview route** ([plan](../plans/fam-1-family-program.md) §5 "Lane B"). Each card but
  the last has "Superset with next", "Unlink from next", or "Join supersets A and B" where the
  link would join two groups. A superset's last card has its rest ("Rest", e.g. "90 s after each
  round"), saved on that item. Joining two supersets keeps the later one's rest and says which
  was dropped; unlinking copies the rest to both sides, so it goes only when neither side stays a
  superset. A double tap counts once. The builder now uses the contract's week order, start rule,
  decimal rule, superset letters and program type instead of its own copies. Nothing is mounted
  outside `/design/program`; no schema change, no new dependency.
