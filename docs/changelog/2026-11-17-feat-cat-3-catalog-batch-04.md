- **2026-11-17** — **The movement library gains 57 horizontal push and pull movements** (`CAT-3`,
  catalog batch 4; [spec](../specs/cat-3-movement-library.md)). Each entry was written in-house and
  approved by the maintainer row by row.

  The batch includes:
  - the push-up family, with its common variations (spiderman, T, tempo, pause, Hindu, dive bomber);
  - the bench and floor presses;
  - barbell, dumbbell, cable and bodyweight rows;
  - face pulls and band pull-aparts.

  Push-up and Weighted push-up, and Inverted row and Weighted inverted row, are each logged two ways,
  so each pair is two entries (spec rule 10).

  The entries are in `packages/shared/src/catalog/data/batch-04.ts`, with their lines added to
  `shipped.json` and `approved.json`. No roadmap item moved.
