- **2026-11-19** — **The movement library gains 46 jump, throw and lower-body movements** (`CAT-3`,
  catalog batch 10; [spec](../specs/cat-3-movement-library.md)): box, broad, vertical, squat and split
  jumps, hops, bounds and skips, medicine-ball throws and wall balls, and single-muscle work for the
  calves, shins, hips and neck. Each entry was written in-house and approved by the maintainer row by
  row.

  Broad jump logs distance, matching the old built-in it shares a slug with (maintainer,
  2026-11-19); Box jump also shares a slug and logs reps, as before. Depth jump and Depth drop are
  "Learn with a coach present", and their steps name the coach (K17).

  The entries are in `packages/shared/src/catalog/data/batch-10.ts`, with their lines added to
  `shipped.json` and `approved.json`. No roadmap item moved.
