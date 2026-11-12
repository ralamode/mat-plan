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
  than hand-writing a join; and the row count is measured in the dry run before a single transaction
  is trusted, with a written threshold at which to stop. Acceptance 11 lands as a Playwright spec,
  because the month's bytes exist only where the export does.
