- **2026-10-11** — **TEN-2c: the contract step has a plan, and the panel retracted the plan's own
  headline** ([plan](../plans/ten-2c-drop-global-slug-unique.md)). Six lenses, **17 blocking findings
  reconciled, 4 pushbacks**. The first draft was titled _"the leak closes here"_ — which is the
  mis-attribution [`plan.md`](../plan.md)'s TEN-2 row and
  [TEN-2a's plan](../plans/ten-2a-household-movements.md) had **already identified and assigned to
  TEN-2c to retract**, so the plan now separates two windows: the **2b→2c denial primitive**, which the
  drop closes completely, and the **pre-existing read leak**, which closes at the newly filed
  **`TEN-2c-1`**. The draft's urgency claim is retracted too — `getHouseholdScope()` throws on a second
  live household, so the denial window is a property of the schema, not a reachable exposure, and the
  real driver is beta-1's invite. Three findings reshaped the work: the seed's **shadow guard loses its
  premise at the drop and becomes a permanent `migrate.yml` wedge** (its `throw` fires on a state the
  drop makes benign, and `migrate.yml` says it "cannot clear itself by re-running"), so 2c demotes it
  to a warning; the **`23505` fallback's deletion moves to `TEN-2d`**, because deleting it beside the
  drop breaks AGENTS.md's deploy order in the direction the draft never argued (Vercel winning the race
  leaves a catch-less resolver against a schema that still has the constraint); and **`db:verify` was
  under-counted by three blocks** — 13 constraint sites, two of which would have **re-created the
  constraint the PR exists to drop**. Measured rather than reasoned: a throwaway `0017` proved the
  fixture at `verify.ts:755` dies **`42P10` first and `23514` second**, so the draft's "one line fix"
  was wrong twice over; and `squawk-cli@2.66.0` reports `0 issues` on the migration while having **no
  `ban-drop-constraint` rule at all** — the gate's silence, not its approval, now stated as such.
  Also: the end-state CHECK is renamed `movements_global_row_has_pattern`, because the old name stated
  an intent its predicate does not test; mutation patch `04` is **re-aimed rather than retired** (its
  slug-normalisation claim survives, and nothing else proves normalisation _within_ a household); and
  the backlog gains **`TEN-2c-1`**, **`TEN-2d`** and **`DX-9`** (`profiles.household_id` is nullable in
  Drizzle and NOT NULL in the database — which is what made 2c's "which household owns this row"
  question look open when the database had settled it in migration `0001`). **Plan only — no
  implementation code.** A light re-review by the two lenses that reshaped the file table is still owed.
