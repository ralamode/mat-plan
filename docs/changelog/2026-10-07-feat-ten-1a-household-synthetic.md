- **2026-10-07** — **TEN-1 chunk 1a: `households.synthetic` ships dark, and TEN-1's six-lens panel
  ran** ([plan](../plans/ten-1-household-scope.md)). Migration 0014 adds a metadata-only
  `boolean NOT NULL DEFAULT false` column for [OBS-2](../plan.md), which needs a synthetic-monitoring
  household excluded from every aggregate. Nothing reads it — and a new
  `household-synthetic-is-dark.test.ts` fails the build if anything starts to, so "ships dark" is a
  gate rather than a sentence that migrations 0006 and 0013 only asserted in prose. The seed is
  deliberately untouched: `db:seed` runs against production on every push and **inserts** the real
  household's row on a fresh or restored database, so a seeded value would label a real family's data
  a test fixture. `db:verify` pins the catalog shape (`is_nullable`, `column_default` — facts the
  `columnsOf` helper cannot express) and proves in both directions that the seed never writes the
  flag; all four assertions were confirmed load-bearing by mutation.
- **The panel's biggest change: `synthetic` is a column, not a field on `HouseholdScope`.** Five of
  six lenses independently rejected carrying it on the authorization capability — it is incoherent for
  OBS-2's cross-household need, it is a second source of truth for a DB column, and it would have made
  chunk 1b `SELECT` the column on every page and Server Action, so a 1b deploy landing ahead of its
  migration would be `42703 undefined column` on every route rather than a dark app. Taking it off
  removes the hazard instead of managing it, and leaves the column dark end to end.
  [ADR 0006](../decisions/0006-household-addressing.md)'s obligation was the brand, not the field.
- **ADR 0006 is Accepted, so TEN-1's chunk 0 is done** — and the backlog rows that still said
  otherwise are corrected here, including the HH-1 row that read "TEN-1 does not start until it is
  signed". The ADR's three named obligations and three forward-compatibility requirements now each
  have a vehicle and a chunk in the plan; the first draft named them and built none. Chunk 1a's second
  half (`packages/db/tsconfig.json` + `typecheck` over `scripts/**`) had already landed as DX-7 (#244).
