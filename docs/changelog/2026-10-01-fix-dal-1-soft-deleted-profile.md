- **2026-10-01** — **DAL-1: a soft-deleted profile's entries no longer list on Today.**
  `listEntriesForDay` scoped by `profiles.public_id` alone. It was the one ownership site that
  skipped `profiles.deleted_at IS NULL`, so the moment a profile was soft-deleted its day would still
  have rendered. It now uses `isLiveProfile` from `writers/ownership.ts`, the predicate `db:verify`
  already proves. `lib/dal/entries.test.ts` pins that the read uses it, by asserting the SQL Drizzle
  emits. Inert today (no profile is soft-deleted), but TEN-1 builds on this read. DAL-2's sweep is
  down to eight hand-written copies.
