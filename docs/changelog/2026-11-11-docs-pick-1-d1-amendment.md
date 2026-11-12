- **2026-11-11** — **the plans and pointers downstream of V1-22 chunk 2 describe the mechanism that
  shipped** ([PICK-1](../plans/pick-1-movement-picker.md), [MOV-1](../plans/mov-1-rename-movement.md),
  [ASSIGN-1](../plans/assign-1-assignments.md), both specs, the two milestones, the roadmap and
  `programming.md`). Chunk 2 shipped with D1 applied — no prescription identity on the log form's
  payload, the match keyed on `movement_id` — and the plans and pointers written against the design it
  replaced still told their implementers to send, clear, carry or re-key a field that does not exist,
  and still justified three serialization gates by it. PICK-1 gets a dated § Amendment naming each
  superseded passage and records invariant 7 as **already satisfied**, so no later PR owes the
  slug→id switch. MOV-1's reciprocal note is discharged — and its fact 6 is split, because "no rename
  **or merge** can alter `prescribed`" is false for a merge: it moves `entries.movement_id`, which is
  the live fallback's key, so every row still NULL (all of production's history until chunk 3) can
  change bytes. ASSIGN-1's failure mode is re-stated: a stale candidate set no longer leaves a visible
  NULL, it freezes the newest block's numbers permanently. `TEN-2b-1` — the row that really does move
  movement resolution into the transaction — now records that it must move the snapshot read with it.
