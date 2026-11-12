- **2026-11-12** — **V1-22 chunk 3 is planned: the backfill that freezes the `prescribed` history**
  ([plan](../plans/v1-22-3-backfill.md), [spec](../specs/v1-22-authoring-program-editing.md)). Plan
  only — no code. Chunk 2 froze what gets logged from now on; every row logged before it still has
  its `prescribed` CSV column reconstructed from **today's** program, so chunk 4's first program edit
  would rewrite past months. The backfill writes exactly what the export would have emitted at that
  moment, which is why **it changes no bytes on the day it runs** — and that identity is the
  acceptance, so a wrong backfill is loud instead of quiet. Four questions are decided rather than
  left to the implementation: a row with no asserted day role stays `NULL` (the resolver returns `''`
  before consulting the program, so no edit can move it); soft-deleted rows **are** written, because
  `V1-9b`'s restore is otherwise the one door left open, and the departure from corrections rule 5 is
  written beside the rule; the correction iterates households and reuses the real scoped query rather
  than hand-writing a join; and the row count is already measured — prod held 51 rows at chunk 1.
  **Five lenses then found nineteen things**, four of which no reading of the plan alone could have
  caught: the backfill should call the log-time writer's own composer rather than the two functions
  under it, which makes the byte identity structural instead of asserted; the planned Playwright spec
  would have failed an existing containment guard on day one and reversed chunk 2's A6 uncited; the
  planned mutation patch would have reddened chunk 2's assertion rather than chunk 3's; and the
  predicate was missing the `movement_id` conjunct that a CHECK turns into a whole-transaction abort.
  Acceptance 11 therefore lands in `db:verify` with literal expectations, and the one claim no test
  can make — that production's composed export emits the same bytes — becomes an operator step that
  diffs it, rather than a seeded fixture pretending to.
