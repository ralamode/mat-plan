- **2026-10-07** — **Corrected how Beta 0 is sequenced, and how milestone progress is shown in a PR.**
  Three changes, all from the same observation. (1) ⚠️ **[parallel-work.md](../parallel-work.md)'s
  "How many lanes?" section said the opposite of the truth** — it claimed _"the constraint is review,
  not agents"_ and derived a lane count from how many plans were already panelled. The maintainer
  corrected it from experience: **review throughput has not been the bottleneck.** The real limits are
  **seam collisions** (a seam change does not parallelize — `TEN-1`'s household scope and the design
  tokens each touch every pillar) and **the serial critical path** (ADR 0006 → `TEN-1` → `AUTH-1`,
  where each step decides the shape of the next, so adding lanes does not shorten it). The old rule's
  conclusion should not be cited; the correction is recorded in place rather than swapped, because a
  plausible-but-untested rule is the failure mode that document exists to catch. (2) **`ONB-0` and
  `PRIV-1` move out of Beta 0 step 4 and start now.** `ONB-0` because first run is **broken today**,
  it is a P0 and it blocks nothing — work that is already broken and blocks nothing is pure
  throughput. `PRIV-1` because it is a **hidden gate on `AUTH-1`**: the Clerk/Google consent screen
  needs the privacy-policy URL, so privacy is upstream of auth, not a sibling of onboarding. Both
  patterns are now written down as scheduling rules rather than facts about this milestone. (3) **A
  milestone PR now embeds the milestone's Mermaid step chart with its own step marked**, so a reviewer
  sees what is still between that PR and the finish without opening the milestone file
  ([AGENTS.md](../../AGENTS.md) → "Milestone PRs also embed a progress chart", with a reminder in the
  `ship-pr` skill). The milestone file owns the canonical chart; if a PR's position disagrees with it,
  the chart is what gets fixed.
