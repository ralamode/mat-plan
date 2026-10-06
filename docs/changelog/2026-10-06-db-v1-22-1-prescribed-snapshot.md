- **2026-10-06** — **Chunk 1 of the Authoring milestone is planned, and the panel found a constraint
  proof that could not fail.** [The plan](../plans/v1-22-1-prescribed-snapshot.md) adds one nullable
  `text` column plus a CHECK to `entries`, shipping dark. Five lenses, then three more in round 2, and
  the design came through unchanged — the _evidence_ did not. The BLOCKING: the CHECK had exactly one
  rejection test, so mutating it to the **adjacent column** (`metric_key IS NULL`, declared on the next
  line, and the pair the existing guard is written in terms of) left every case green on a constraint
  permitting a snapshot on precisely the rows it forbids. The cause was assuming the tagged union is
  exclusive; `entries_value_source_check` is **at-most-one, not XOR**, so a row with _neither_ arm is
  legal and is what a boolean check-in writes. The state table is now a **nine-case grid** that kills
  five mutants, including `coalesce(…,'') = ''` — the exact form the spec forbids by name. Round 2 also
  caught the plan repeating its own citation error inside the fix for it, an obligation parked where
  nobody reads forward from, and one place where accepting a reviewer in full would have written a
  third copy of a runbook section. Both round-1 rejections were later **withdrawn by the lens that
  raised them**. One question remains open and needs the maintainer: `count(*)` on `entries` in prod,
  because the `ADD CONSTRAINT` scans under `ACCESS EXCLUSIVE` and no Neon-branch apply is wired, so
  prod is the first non-empty database this file will ever touch.
