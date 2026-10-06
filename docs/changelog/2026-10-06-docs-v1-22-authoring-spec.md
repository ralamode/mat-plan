- **2026-10-06** — **The Authoring milestone has a spec, and its panel reversed three of the premises
  it was built on.** [`docs/specs/v1-22-authoring-program-editing.md`](../specs/v1-22-authoring-program-editing.md)
  is the first file in `docs/specs/`: 17 acceptance criteria, the `ProgramEditDTO` contract, and six
  chunks in an order five adversarial lenses corrected. What they overturned: the **seed was never a
  gate for editing values** (`onConflictDoNothing` is insert-only, so a value `UPDATE` already survives
  a re-seed), which moved the guard from first to fifth and cut three PRs out of the path to the pain
  being gone; the milestone is **additive-only after all**, because a day-scoped existence check in
  `seedProgram` beats a marker column and is the only option that survives a reorder that compacts; and
  the draft's headline acceptance criterion was **vacuous** — 11 of the 13 live prescriptions render an
  empty `prescribed` string, so "edit, re-export, assert unchanged" would have asserted `'' === ''` and
  passed with no snapshot column at all. The panel also caught a cleared per-athlete load **coming back
  from the dead**: soft-deleting the target row frees its partial unique slot and the next push to
  `main` re-inserts the seeded load onto a child's card, which overrides V1-22 W4. The routine-picker
  filter and the wrestling drills left the milestone as **CAT-1** and **CAT-2** — independent PRs
  sharing nothing with the write path.
