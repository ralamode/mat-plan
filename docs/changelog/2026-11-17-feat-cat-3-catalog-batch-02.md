- **2026-11-17** — **The movement library gains 58 core, carry and sled movements** (`CAT-3`,
  catalog batch 2; [spec](../specs/cat-3-movement-library.md)). Each entry was written in-house and
  approved by the maintainer row by row.

  The batch includes:
  - the plank family and its common variations;
  - Weighted plank, whose equipment is Any weight;
  - the carries, which list the core and obliques among their muscles;
  - sled push, march and drag as separate movements.

  The entries are in `packages/shared/src/catalog/data/batch-02.ts`, with their lines added to
  `shipped.json` and `approved.json`. Nothing reads the library yet. No roadmap item moved.
