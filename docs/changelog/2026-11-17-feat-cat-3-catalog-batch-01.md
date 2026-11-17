- **2026-11-17** — **The movement library gets its first 50 movements: mobility and stretching**
  (`CAT-3`, catalog batch 1; [spec](../specs/cat-3-movement-library.md)). Every entry was written
  in-house, in our own words, and reviewed and approved by the maintainer row by row. Each entry has:
  - the equipment it needs;
  - its primary and secondary muscles;
  - one tracking type;
  - short instructions on how to do it.

  The entries are in `packages/shared/src/catalog/data/batch-01.ts`. Their slugs and tracking types
  are added to `shipped.json`, and their approval hashes to `approved.json`. The data lane gets its
  feature guide, [catalog-data.md](../features/catalog-data.md).

  Nothing reads the library yet: the catalog seed (lane A's A2) and the picker's filters come later.
  No roadmap item moved.
