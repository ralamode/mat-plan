- **2026-10-06** — **TEN-1 has a plan, and the audit behind it confirmed the thing worth being alarmed
  about.** [`docs/plans/ten-1-household-scope.md`](../plans/ten-1-household-scope.md).
  `listProfiles()` really does return **every profile in the database**, and `getProfileByPublicId`
  really has **no household predicate** — `apps/web/lib/dal/profiles.ts`'s only filter is
  `deletedAt IS NULL`. DAL-2's "nine hand-written live-profile predicates" is exactly nine, counted and
  listed with line numbers. The design is a `HouseholdScope` value with two constructors and a
  per-request cached `getHouseholdScope()`, enforced in the DAL; `packages/db/src/queries/program-day.ts`
  generalises cleanly, and the plan notes it resolves the household **correlatively** — as a join
  equality, never as a value — so TEN-1 adds an independent assertion today's two-hop correlation
  cannot make. It is a **seam**: every pillar's DAL calls change through it, which is why
  [roadmap.md](../roadmap.md) sequences it before its consumers rather than beside them.
