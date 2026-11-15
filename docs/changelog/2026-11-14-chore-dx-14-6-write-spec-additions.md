- **2026-11-14** — **DX-14 items 6 and 9b: `write-spec` asks for assumptions, deltas, a rollback
  and contract tests on both sides** ([skill](../../.claude/skills/write-spec/SKILL.md) § 3). A spec
  now lists the assumptions it rests on, each with how it would be checked and what changes if it's
  false, and the panel attacks those first. A shipped spec changes through a dated delta, never an
  in-place edit. A milestone spec says who sees it first, what is watched, how it's rolled back, and
  what can't be rolled back. Each chunk-0 shape gets contract tests on both sides against one named
  fixture, and a column chunk 0 missed is a fixture field marked _pending column_ until the schema
  lane adds it ([parallel-work → Once lanes run](../parallel-work.md#once-lanes-run-what-turns-them-back-into-one-queue)).
