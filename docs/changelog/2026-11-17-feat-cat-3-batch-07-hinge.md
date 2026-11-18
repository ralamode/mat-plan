- **2026-11-17** — **The movement library gains 49 hinge movements** (`CAT-3`, catalog batch 7;
  [spec](../specs/cat-3-movement-library.md)): deadlift variations, Romanian deadlifts, hip thrusts
  and glute bridges, kettlebell swings, back extensions, and hamstring and glute isolation work. Each
  entry was written in-house and approved by the maintainer row by row.

  Where people log a movement two ways, it gets two entries with names that say which (spec rule 10),
  for example Glute bridge (reps) and Barbell glute bridge (weight × reps). One entry, the Jefferson
  curl, is "Learn with a coach present", and its steps name the coach (K17).

  The entries are in `packages/shared/src/catalog/data/batch-07.ts`, with their lines added to
  `shipped.json` and `approved.json`. The guide now says a batch merges once every row of its review
  reads "lgtm", and that the lane merges it (maintainer, 2026-11-17). Nothing reads the library yet.
  No roadmap item moved.
