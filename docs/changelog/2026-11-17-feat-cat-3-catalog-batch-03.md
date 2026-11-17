- **2026-11-17** — **The movement library gains 58 vertical pull and push movements** (`CAT-3`, catalog
  batch 3; [spec](../specs/cat-3-movement-library.md)). Each entry was written in-house and approved by
  the maintainer row by row.

  The batch includes:
  - the pull-up and chin-up family, with its common variations;
  - pulldowns and overhead presses;
  - dips and support holds.

  Where a movement is logged two ways it has two entries (spec rule 10): Pull-up and Weighted pull-up,
  Dip and Weighted dip. Rope climb, Legless rope climb and Handstand push-up carry the "learn with a
  coach present" label.

  The entries are in `packages/shared/src/catalog/data/batch-03.ts`, with their lines added to
  `shipped.json` and `approved.json`. Nothing reads the library yet. No roadmap item moved.
