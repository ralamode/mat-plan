- **2026-10-09** — **AUTH-1: the plan for Clerk, Google and invitation-only is written and panelled**
  ([plan](../plans/auth-1-clerk-google.md)). Four chunks — Clerk wired dark → `household_members` +
  the claim correction dark → the boundary moves → retire the gate — with the gate and the session
  **both** enforced for two of them, because AND-composition is the only shape with no window in
  which neither holds. It settles what [beta-1.md](../milestones/beta-1.md) § 3 deferred to it
  (**Clerk Organizations: recommended against for Beta 0**, reversal priced at one additive migration
  and one function body) and it corrects three things the milestone's prose asserts: the _"existing
  export-enumeration test"_ is an export-**shape** guard that would pass a new Server Action with no
  auth check at all, so the enforcement is a new test; `TEN-1` 1d's claim that the `cross_household`
  event cannot fire before AUTH-1 is over-stated (a profile pointing at a soft-deleted household
  reaches it today), so what AUTH-1 owes is the row-level `db:verify` proof; and _"a new user gets a
  new, empty household"_ is the clause that opens `TEN-1`'s proven cross-tenant catalog write, so it
  is recommended out of AUTH-1 and onto the invite row behind `TEN-2b`. Four decisions are left
  explicitly unsigned for the maintainer.
