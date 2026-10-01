- **2026-10-01** — **DAL-1: a soft-deleted profile's entries no longer list on Today, and its
  adherence rows no longer load.** `listEntriesForDay` and `weeklyAdherenceRows` scoped by
  `profiles.public_id` alone — the two ownership sites that skipped `profiles.deleted_at IS NULL` (the
  second found in review; it had copied the first's join). Both now use `isLiveProfile` from
  `writers/ownership.ts`. `db:verify` proves the adherence query returns nothing for a soft-deleted
  profile; `lib/dal/entries.test.ts` pins that the day read uses the predicate. Inert today (no profile
  is soft-deleted, and the page 404s first), but TEN-1 builds on these reads. DAL-2's sweep still has
  nine hand-written copies.
