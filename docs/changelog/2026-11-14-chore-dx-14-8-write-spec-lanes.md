- **2026-11-14** — **DX-14 item 8: `write-spec` splits a milestone into lanes, and `guides:check`
  fails when two lanes would collide** ([plan](../plans/dx-14-8-write-spec-lanes.md),
  [write-spec](../../.claude/skills/write-spec/SKILL.md) → Lanes,
  [parallel-work](../parallel-work.md) gate 1). A milestone spec now opens with a contract PR
  (schemas, named fixtures, the tests still to write), integrates in thin slices, and declares its
  concurrent lanes as `lane-<name>:` frontmatter. The guides guard reads it: two lanes overlapping on
  a path, or reaching the same feature guide, fail; a malformed lane exits 2 rather than passing.
  FAM-1's lanes as drafted fail it through a shared guide, which is the conflict its own text predicts
  and d2 has to settle.
