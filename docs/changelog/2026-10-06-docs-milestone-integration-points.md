- **2026-10-06** — **Parallel work now has a place to come back together, and the lane count has a
  stated limit.** Three gaps, all found by asking where integration actually happens: exit criteria
  existed only at the **Beta 0 / Beta 1** level, never per milestone; the Authoring spec's criteria were
  each owned by one chunk; and nothing named the places two pillars touch one contract. So the spec
  gains **§Integration** — six invariants that _span_ chunks and therefore belong to no single PR, each
  with the chunk that **closes** it and the proof it must carry, plus the milestone's exit criteria in
  one sentence. The hazard is specific: acceptance 11 (byte-identity between the snapshot and legacy
  export paths) spans chunks 1–3, so every chunk could ship green while the invariant nobody owns
  silently fails. The roadmap gains **Seams** — the five places two pillars share a contract, each with
  **one owner** — and the rule that _a seam change does not parallelize_, which immediately
  reclassifies `TEN-1`: it introduces one household-scope seam every pillar's DAL calls change through,
  so it goes **before** its consumers rather than beside them. And `parallel-work.md` gains the question
  the six gates never answered: they say _may these two run at once_, not _how many lanes to open_. That
  limit is **review bandwidth, not agent capacity** — a lane with a panelled plan is nearly free, a lane
  without one costs a full panel (eight lens-passes on the chunk-1 plan), so the count is "as many lanes
  as there are panelled plans, plus at most one that still needs planning." The corollary: **planning is
  the thing worth running in parallel early**, because its output is what unblocks lanes later.
