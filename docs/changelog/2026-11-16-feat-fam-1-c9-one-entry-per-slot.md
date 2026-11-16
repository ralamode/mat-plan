- **2026-11-16** — **FAM-1 contract change C9: a slot holds at most one entry**
  ([plan](../plans/fam-1-family-program.md) D35; [contract](../features/program-contract.md)
  invariant 16). Each un-tick hid an entry and the next ✓ with a new number added another, so one
  set of one item on one day could collect any number of hidden entries. The maintainer's rule: a
  new ✓ on a set whose entry was un-ticked (or hidden by Clear day) brings that entry back with the
  new numbers, in one transaction. The rule is written on `rowWriteSchema`, and the preview's fake
  follows it: the same entry returns however many times a row is un-ticked and ticked; a retry of
  that ✓ answers the same; a replayed ✓ whose own entry is hidden still answers `own_hidden` and
  revives nothing. The revived entry is what a new ✓ would have made but for its id, the
  prescription's current text included. One limit is recorded and pinned by a test: an attempt id
  that a revive replaced is forgotten, so replayed after another un-tick it revives the entry (no
  screen re-sends one; an offline queue would have to close it first). The fake's hide tokens are
  now unique within a millisecond. The real writer follows at step 11c. The same PR carries plan
  corrections from the lanes (log rows L20 and L21): step 13b-ii's Undo and Cancel rules, the 4b
  row's wording and two CHECKs tighter than the signed text, an owner for the privacy docs' stale
  "How it felt" lines, and a tech-debt entry for a CHECK that admits `NaN`. Preview route only; no
  production screen, schema or stored data changes; no new dependency.
