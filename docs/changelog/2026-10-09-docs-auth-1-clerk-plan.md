- **2026-10-09** — **AUTH-1: the plan for Clerk, Google and invitation-only is written, and the
  seven-lens panel has run** ([plan](../plans/auth-1-clerk-google.md)). **Six** chunks — Clerk wired
  dark → the enumeration guard → `household_members` + the claim correction dark → the Playwright
  session story → the boundary moves → retire the gate — with the gate and the session **both**
  enforced across the cutover, because AND-composition is the only shape with no window in which
  neither holds. It settles what [beta-1.md](../milestones/beta-1.md) § 3 deferred to it (**Clerk
  Organizations: recommended against for Beta 0**, with the reversal re-priced by the panel) and it
  corrects three things the milestone's prose asserts: the _"existing export-enumeration test"_ is an
  export-**shape** guard that would pass a new Server Action with no auth check at all; `TEN-1` 1d's
  claim that the `cross_household` event cannot fire before AUTH-1 is over-stated (a profile pointing
  at a soft-deleted household reaches it today), so what AUTH-1 owes is the row-level `db:verify`
  proof; and _"a new user gets a new, empty household"_ is the clause that opens `TEN-1`'s proven
  cross-tenant catalog write.
- **What the panel changed, since the plan is only as good as its mechanisms.** It overturned no
  decision and no finding — four lenses re-verified the promise-5 correction — but it rewrote how
  seven of them are built: the resolver's query was missing the `households.deleted_at` conjunct TEN-1
  extracted it to protect; the no-household screen's discriminator answered a question nobody asks, so
  a signed-in parent would have been told to change this deployment's seed data; the enumeration
  test's load-bearing assertion was not implementable; the role CHECK cannot be sourced from a const
  the way the plan said; the claim correction's guard could not refuse what the next sentence claimed;
  the rate-limit constant could not be read by the limiter; and `household_members` would have
  **aborted the household-deletion transaction**, which is `PRIV-3`'s predicted "19th table". It also
  found a **non-request** path to household #2 (the production seed, keyed on a constant `SEC-6`
  rotates) at the same moment the plan deletes the detector that makes it loud, and that the CSP
  widening `beta-1.md` assigned to this plan **by name** was absent. **Seven decisions are left
  explicitly unsigned for the maintainer** — two of them new, because a lens disagreed with the plan.
