- **2026-11-19** — **The movement library gains 22 gap-fill movements** (`CAT-3`, catalog batch 14;
  [spec](../specs/cat-3-movement-library.md)), the movements the family batches left out: the goblet
  squat hold, Hindu and archer squats, the upright row and dumbbell pullover, wall, scapular and
  typewriter push-ups, the typewriter pull-up, the straight-bar dip, the front lever row, the reverse
  crunch, flutter kick, windshield wiper and heel tap, the V-sit and V-sit crunch, the body saw and
  pike compression, the kip-up, the wrist circle and the knee-to-wall ankle rock. Each entry was
  written in-house and approved by the maintainer row by row.

  The kip-up is "Learn with a coach present", and its steps name the coach. V-up gains the other
  names "Jackknife sit-up" and "Jackknife" (an edit of a shipped entry, with its own approval line),
  rather than a second entry for the same movement.

  This completes the library at 587 entries. The entries are in
  `packages/shared/src/catalog/data/batch-14.ts`, with their lines added to `shipped.json` and
  `approved.json`. No roadmap item moved.
