# CAT-3 A2-ii — the seed switches to the movement library (with K29)

> Backlog: [plan.md](../plan.md) row `CAT-3`. Spec:
> [cat-3-movement-library](../specs/cat-3-movement-library.md), E4, K29, K22, K23, rule 2, rule 7, the A2 row
> and the P11-ii row. Lane P _(maintainer, 2026-11-19: "Lane P takes A2-i (Recommended)"; A2-ii follows)_.
> No migration. Mutations from lane P's block `598`–`609`.

## Where this sits

- **Pillar:** the movement library. **Milestone:** [Beta 0](../milestones/beta-1.md), `CAT-3` (node 14).
- **This PR:** the plan for A2-ii, the moment production's library changes: without the fixtures flag the
  seed writes `CATALOG_MOVEMENTS` (the 587 approved entries) and stops writing `MOVEMENT_SEED_ROWS`; with
  it, `CATALOG_FIXTURE` in its place, then the legacy fixtures (E4). **K29 lands inside it**: a database
  seeded with the fixture library is read with the fixture library.
- **Before it:** A2-i (#703, the writer, deployed), P11-ii-a (#732, the picker lists library rows, deployed),
  the vocabulary order (#716).
- **After it:** P11-ii-b (the taxonomy from the tables), B3 in production, then the fresh start (R0–R4; Native
  Scaling's R1 runbook gates on this PR).
- _Roadmap alignment (2026-11-20): advances `CAT-3` (A2-ii, K29); unblocks the fresh start's load step;
  touches the movement catalog, so `ID-1`'s six keep-open items are answered below; checked against the
  private roadmap, nothing to add here._

## Goal

1. **The switch (E4).** `seed()` passes `CATALOG_MOVEMENTS` to `seedReference` without the flag, and stops
   inserting `MOVEMENT_SEED_ROWS` (production keeps its 35 rows until R2; the seed never deletes). With the
   flag: `CATALOG_FIXTURE`, then the legacy fixtures (`MOVEMENT_SEED_ROWS` among them until F1).
2. **K29, the library in effect, from the database.** `isFixturesDatabase(url)` moves to
   `packages/shared/src/db-environment.ts` (the seed's `assertFixturesTargetAllowed` rule, shared). The
   library in effect is `CATALOG_FIXTURE` exactly when that holds and the deployment is not production;
   otherwise `CATALOG_MOVEMENTS`. **Every reader takes it:** `CATALOG_LIBRARY` (`lib/dal/catalog-library.ts`:
   the picker's read, "How to", `newItem`, the day resolver after #760) **and the fixture seed's own
   `newItem` call** (`seed-fixtures.ts:192`, the roadmap thread's reviewer, 2026-11-20).
3. **What A2-i's review said A2-ii owes before the switch** (`movement-catalog.md` → Traps):
   - 🔴 the `movements-ownership` report's "curated" reads "a legacy seed row **or** `movementIsCatalog()`", or
     TEN-2b-2's orphan input would list the whole library; and Native Scaling's R4 count lines kept beside it;
   - the TEN-2 discriminators in `verify.ts` read "legacy or catalog";
   - `verify/schema.ts`' 0022 proofs plant their own rows instead of relying on the seed;
   - erasure P7 and mutations `318`/`319`;
   - the runbook's step-5 join-row counts go live; a runbook entry for a seed run that fails on catalog data;
   - `catalog-library.ts`' stale line about lane E's day read.

## K29's two conditions (spec owner, 2026-11-19)

1. The rule's proof names every database it admits (`embedded-pg`, CI's smoke, the preview) and shows each
   one is seeded with fixtures; a test pins that a production target can never get the fixture library.
2. The app logs one line at start when the fixture library is in effect, naming the rule. No silent fallback.

Lane E's case rides here: the day resolver gets the fixture library on a fixtures database.

## The maintainer's console steps (before the merge)

- Cut a Neon restore branch and run `db:seed` against it from the operator's console: the first real-Postgres
  run of the writer, expecting `CATALOG_MOVEMENTS.length − 12` inserted, 12 held by a legacy row.
- Run the runbook's shadow query on production, so the household count is known in advance.

## Readers, by file

_To be filled from the fact sheet (lane E, 2026-11-20): every reader of `MOVEMENT_SEED_ROWS` /
`MOVEMENT_SEED_PUBLIC_IDS`, every e2e or fixture assumption about legacy rows, every K29 reader and where it runs._

## Acceptance, Files, Test plan, Risks

_To be written once the readers are known._

## ID-1's six keep-open items

_To be answered._

## Review-response log

_The panel runs on the full draft._
