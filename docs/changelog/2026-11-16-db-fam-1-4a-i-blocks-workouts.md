- **2026-11-16** — **FAM-1 step 4a-i: the database can hold workouts and a week template**
  ([plan](../plans/fam-1-family-program.md) §3, §5 lane A; ADR 0007 Amendment 2 §1–3, §5, §8, §10).
  Migration `0023` adds `program_blocks.kind` (`legacy` by default, which every existing block
  becomes; `template` for a program a household builds) and a household-scoped `client_id`; a
  `workouts` table (a client_id unique per block, copy provenance whose frozen program name outlives
  its source, length CHECKs pinned to `WORKOUT_NAME_MAX`, `FREE_TEXT_NOTE_MAX` and
  `PROGRAM_NAME_MAX`); and `block_day_workouts`, the week, whose composite FK keeps a slot on its own
  block's workouts, with one slot per place and one per workout per day. `writers/ownership.ts` gains
  the insert helpers lane P's writers will call: a block lands `template` explicitly, a workout only in
  this household's live template block, a replay is answered first (reporting whether the row was created and whether it is hidden), and a template block must carry its `client_id` (a CHECK). `db:verify` proves each
  constraint, both "flagged" audits and the program tables' erasure order (lettered 9a and 9b in the
  runbook); mutations 46–51 prove the helpers' refusals and the scoped block read; a source scan keeps the tables dark until
  lane P. Nothing writes the tables yet; the privacy notice and inventory say so.
