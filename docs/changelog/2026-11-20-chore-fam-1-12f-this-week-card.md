### Removed

- **The day page's "This week" card and its read** (FAM-1 12f PR 4,
  [plan](../plans/fam-1-12f-retire-old-forms.md); D21). The card showed the weekly ramp, which no
  household has seeded: in production no live `ramp_targets` row has a target above zero (Q5's first
  read, the maintainer, 2026-11-19), so it never rendered for anyone. Its component, its DAL and its
  fold are deleted. The day page's `Promise.all` keeps its other two reads (the entries and B2's
  clears). `weeklyAdherenceRows` stays in `packages/db` with its proofs.
- **`householdHasProgram`** (`packages/db/src/queries/program-day.ts`), with its `db:verify` proof and
  mutation 56 (a retired row in the mutations README). Its last caller left in #725.
