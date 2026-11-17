- **2026-11-17** — **The movement library gains 54 conditioning movements: machines, running and
  agility** (`CAT-3`, catalog batch 5; [spec](../specs/cat-3-movement-library.md)). Each entry was
  written in-house and approved by the maintainer row by row.

  Where people log a movement two ways, it gets two entries with names that say which (spec
  rule 10). For example:
  - Rowing machine (duration), Rowing machine intervals (time per set) and Rowing machine for
    distance;
  - Run (duration) and Run for distance.

  The entries are in `packages/shared/src/catalog/data/batch-05.ts`, with their lines added to
  `shipped.json` and `approved.json`. Batches 2 to 4 are still in review, so this batch merges ahead
  of them. Nothing reads the library yet. No roadmap item moved.
