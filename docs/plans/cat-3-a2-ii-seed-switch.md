# CAT-3 A2-ii — the seed switches to the movement library (with K29)

> Backlog: [plan.md](../plan.md) row `CAT-3`. Spec:
> [cat-3-movement-library](../specs/cat-3-movement-library.md), E4, K29, K22, K23, rule 2, rule 7, the A2 row
> and the P11-ii row. Lane P _(maintainer, 2026-11-19: "Lane P takes A2-i (Recommended)"; A2-ii follows it)_.
> No migration. Mutations from lane P's block, `598`–`609`. Facts: lane E's read-only fact sheet against
> main at `6f05c36d` (2026-11-20), every claim marked checked, inferred or unverified; the cites below are
> its, re-read where marked.

## Where this sits

- **Pillar:** the movement library. **Milestone:** [Beta 0](../milestones/beta-1.md), `CAT-3` (node 14).
- **This PR:** the plan for A2-ii. It is the moment production's library changes.
  - **Without the fixtures flag**, the seed writes `CATALOG_MOVEMENTS` (the approved entries) and stops writing
    `MOVEMENT_SEED_ROWS`.
  - **With the flag**, it writes `CATALOG_FIXTURE` in their place, then the legacy fixtures (E4).
  - **K29 lands inside it:** a database seeded with the fixture library is read with the fixture library.
- **Before it:** A2-i (#703, the writer, deployed), P11-ii-a (#732, the picker lists library rows, deployed),
  the vocabulary order (#716), lane E's day read on `CATALOG_LIBRARY` (#760).
- **After it:** P11-ii-b (the taxonomy from the tables), B3 in production, then the fresh start (R0–R4).
  Native Scaling's R1 runbook gates on this PR.
- _Roadmap alignment (2026-11-20): advances `CAT-3` (A2-ii, K29); unblocks the fresh start's load step;
  touches the movement catalog, so `ID-1`'s six keep-open items are answered below; checked against the
  private roadmap, nothing to add here._

## What production sees

On the first push after this merges, `migrate.yml`'s seed writes every library entry whose slug no global
row holds:

- about `CATALOG_MOVEMENTS.length − 12` new catalog rows with their join rows, in one transaction (A2-i's
  writer);
- the 12 entries that share a slug with a legacy row are left alone, held by the legacy row (E2), until R2
  deletes the legacy rows;
- the picker then lists every library movement beside the 35 old built-ins (P11-ii-a, K22).

Every later push writes nothing: every entry is present, and A2-i's per-insert guards hold (rule 7).

## Decisions

### D1. E4: the legacy insert moves under the flag, explicitly

`seedReference` writes `MOVEMENT_SEED_ROWS` unconditionally today (`seed.ts:406-409`), and it takes only
`{ catalog }`, so switching `catalog: []` alone would leave the legacy rows on every fresh database. So:

- **It takes `{ catalog, legacyMovements }`.** Both are required, with no default (the `SeedOptions.fixtures`
  rule).
- **`seed()` decides both from the flag:**
  - without fixtures: `{ catalog: CATALOG_MOVEMENTS, legacyMovements: false }`;
  - with fixtures: `{ catalog: CATALOG_FIXTURE, legacyMovements: true }`.
- **The order is kept:** the catalog first, then the legacy rows, so on a shared slug the catalog row wins.
  The fixture library shares no slug with the legacy rows, so on a fixtures database both are written.
- **The TEN-2c shadow count** runs only when the legacy rows are written. Without them there is no legacy
  insert to report on. The library-slug count stays.

### D2. The shared verify database becomes a fixtures database, and stays one

Today `db:verify`'s shared PGlite database first gets `seed({ fixtures: false })` twice (Proof A,
`verify/seed.ts:133-139`), and later again at `verify.ts:369`. After the switch, both would write the real
library into the shared database. A2-i kept it library-free on purpose, and lane E's sheet lists what breaks:
the global count at `verify.ts:653-657`, and the TEN-2 `appAuthored` discriminator at `:6715`.

- **Proof A runs inside `rolledBack`**, on the still-fresh database, like A2-i's E1. It asserts the new E4
  outcome:
  - the global rows are exactly the `CATALOG_MOVEMENTS` slugs, with no legacy row;
  - every one is `movementIsCatalog()`, with its join rows;
  - a second run inserts nothing.
- **`verify.ts:369`'s `seed({ fixtures: false })`** (the 1c-4 / OPS-2 C case) also runs inside `rolledBack`.
- **From the first `seed({ fixtures: true })` on, the shared database holds the 24 `CATALOG_FIXTURE` rows
  plus the 35 legacy rows**, which is exactly what every e2e, preview and `e2e:local` database holds. The
  proofs that read the shared state are updated to that truth:
  - `verify.ts:653-657`: the global count is `MOVEMENT_SEED_ROWS.length + CATALOG_FIXTURE.length`, split by
    `movementIsCatalog()`;
  - **the TEN-2 discriminators** (`verify.ts:6715-6777`) read "a legacy seed row (`MOVEMENT_SEED_PUBLIC_IDS`)
    **or** a catalog row (`movementIsCatalog()`)". `appAuthored` is a global row that is neither;
  - erasure P7 and mutations `318`/`319`: with catalog join rows on global movements in the shared database,
    P7's "matched by both" sees them first. The `.expect` files move to P7's message. This is inferred, so
    the PR runs both alone.

### D3. The ownership report reads "legacy or catalog" (before the switch)

`movementsOwnershipReport` (`corrections/registry.ts:668-729`) calls a global row "curated" only if its id is
in `MOVEMENT_SEED_PUBLIC_IDS`. After the switch, every catalog row would land in "TEN-2c-1 input" and
"TEN-2b-2 input (global, non-curated, unreferenced)", the orphan-removal input, and the "EXPECTED zero" line
would be false. So:

- curated becomes "a legacy seed row **or** `movementIsCatalog()`";
- the report gains one line counting each kind;
- **Native Scaling's R4 lines** (PRIV-3 R1, D3) go in as separate lines, whichever PR lands second merging the
  other's (agreed 2026-11-19).

A proof plants a global catalog row and asserts it is curated, and that the orphan input is 0. A mutation
drops the catalog half.

### D4. K29: the library in effect, one rule, both sides

- **The rule, once:** `isFixturesDatabase(url)` moves to `packages/shared/src/db-environment.ts`. It is
  `isLocalDbHost(url) || namesPreviewDatabase(databaseNameOf(url) ?? '')`, the body of today's
  `assertFixturesTargetAllowed` (`seed.ts:173-177`), with its accepted limits documented there. The seed's
  refusal is `!isFixturesDatabase(url)`.
- **The app** (`apps/web/lib/env.ts`, the one module that reads `process.env`) exports
  `catalogLibraryName(): 'catalog' | 'fixture'`. It is decided once at module scope:
  - `'fixture'` exactly when `isFixturesDatabase(DATABASE_URL)` holds and `VERCEL_ENV?.trim() !== 'production'`;
  - `'catalog'` otherwise.

  `lib/dal/catalog-library.ts` maps that name to the list, so `CATALOG_LIBRARY` stays a module-scope const.
  Its shape does not change, so lane E's day read (#760) needs no edit.

- **The seed** knows exactly which list it wrote, because it decides by the flag. `seedProgramFixtures(db,
scope, library)` takes the list `seed()` passed to `seedReference` (`CATALOG_FIXTURE` with the flag) and
  hands it to its `newItem` call (`seed-fixtures.ts:192`). It applies no URL rule of its own, because the flag
  is the seed's truth. That the two sides agree is K29 condition 1, below.
- **The start-up line (condition 2).** When the name is `'fixture'`, `env.ts` logs once:
  `catalog library: CATALOG_FIXTURE (isFixturesDatabase(DATABASE_URL), not production)`. It names the rule
  and no URL.
- **The production pin.** A pure function, `catalogLibraryNameFor({ databaseUrl, vercelEnv })`, in
  `db-environment.ts`, is tested by equality, beside OPS-1's tests:
  - production with a local database gives `'catalog'`;
  - production with a preview-named database gives `'catalog'`;
  - a remote non-preview database off production gives `'catalog'`;
  - a local or preview-named database off production gives `'fixture'`;
  - a database with no name gives `'catalog'`.

  OPS-1 cannot get in first here, because this rule never throws; it only chooses.

### D5. K29 condition 1: every database the rule admits is seeded with fixtures

A test lists every fixtures target and asserts each one seeds with `SEED_FIXTURES=1`:

- CI's e2e job (`ci.yml:449, 601`, a localhost service);
- `migrate-preview.yml:84`;
- `embedded-pg.ts:148` and its three callers;
- the runbook's manual preview seed.

`migrate.yml` must not set the flag. This extends `apps/web/test/seed-fixtures-is-contained.test.ts`, which
already pins the flag's workflows. Lane E's sheet names the gaps, recorded as accepted:

- a localhost database seeded by hand without the flag (P11-ii plan, Q5 (A));
- a preview database between a push and its re-seed (one deploy);
- a production database named `*preview*` (OPS-1's limit, where `VERCEL_ENV` is the guard);
- the seed reading `DATABASE_URL_UNPOOLED ?? DATABASE_URL` while the app reads `DATABASE_URL`. Both are
  preview-named on the preview estate (OPS-1 checks each), so the two rules agree. The PR states this, and a
  test of `assertMigrationTarget`'s pairing covers it if one exists (to check).

### D6. 🔴 The fixture world's two items whose type the fixture library contradicts (contract owner)

On a fixtures database the library rows exist before `seedProgramFixtures` resolves the world's items by name.
Two of them are found in `CATALOG_FIXTURE` with another tracking type:

- "Jump rope": `duration` in the world (`world.ts:116`), `count` in the library (`fixture.ts:285-288`);
- "Easy run": `distance` in the world (`world.ts:123`), `duration` in the library (`fixture.ts:273-276`).

`seed-fixtures.ts:197` refuses a type mismatch, so the Conditioning workout's program and Adult One's "Run and
core" program would be skipped on every fixtures database. The mismatches are checked; the skips are inferred
from the code. Both files are the contract owner's, so this is **Q1** below. The PR proves the outcome either
way: a seed run on a fixtures database writes every fixture program.

### D7. Docs and comments the switch makes false

- `catalog-library.ts:11-12`: the line about lane E's day read, stale since #760.
- `seed.ts:219-221` ("switches this one argument").
- `catalog-movements.ts:34-38` ("a fresh database takes it from here").
- `movement-catalog.md:28` ("nothing in apps/ reads them until P11-ii").
- `movement-catalog.md`'s A2-ii trap list, closed.
- Runbook: step 5's join-row counts go live, and a new entry covers a seed run that fails on catalog data
  (fix forward; one transaction, nothing left behind).
- Not this PR's: `apps/web/e2e/day-page.spec.ts:200-201`'s comment calls the legacy "Inverted Rows" the
  library's (lane C's spec; sent to them). The spec's "13 fixture slugs" in K29 counts 17 by slug, which goes to
  the spec owner.

## Acceptance

- (A1) **E4 without the flag:** on a fresh database the global movements are exactly the `CATALOG_MOVEMENTS`
  slugs, every one a catalog row with its join rows, and no legacy row. A second run inserts nothing and
  resolves.
- (A2) **E4 with the flag:** the `CATALOG_FIXTURE` rows, then all 35 legacy rows, then the household fixtures.
  **Every fixture program is written** (D6).
- (A3) **The ownership report:** a catalog row is curated; the orphan input stays 0 with catalog rows present.
- (A4) **K29's rule:** `catalogLibraryNameFor`'s cases by equality, including the production pins.
- (A5) **K29's readers on a fixtures database** get `CATALOG_FIXTURE`, each with a test that mocks the name:
  - the picker's read, "How to", `newItem`;
  - lane E's case: the day resolver gets the fixture library on a fixtures database;
  - the seed's `newItem`, in `db:verify`: a fixture item found by a `CATALOG_FIXTURE` alias is selected.
- (A6) **K29 condition 1:** every fixtures target seeds with the flag, and `migrate.yml` never does.
- (A7) **K29 condition 2:** the start-up line on the fixture library only; nothing on the real one.
- (A8) **The shared verify database** holds the fixture library and the legacy rows, and every proof that reads
  it says so.

## Files

| File                                                                                                                                        | Change                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/db/src/seed.ts`                                                                                                                   | D1: `seedReference({ catalog, legacyMovements })`; `seed()` picks both from the flag; `seedProgramFixtures` gets the library; comments |
| `packages/db/src/writers/program/seed-fixtures.ts`                                                                                          | `seedProgramFixtures(db, scope, library)`; the `newItem` call passes it                                                                |
| `packages/shared/src/db-environment.ts` (+ test)                                                                                            | `isFixturesDatabase`, `catalogLibraryNameFor`                                                                                          |
| `apps/web/lib/env.ts` (+ test)                                                                                                              | `catalogLibraryName()`, the start-up line                                                                                              |
| `apps/web/lib/dal/catalog-library.ts`                                                                                                       | maps the name to the list; the stale line goes                                                                                         |
| `packages/db/scripts/corrections/registry.ts`                                                                                               | D3                                                                                                                                     |
| `packages/db/scripts/verify/seed.ts`, `verify.ts`, `verify/catalog.ts`, `verify/erasure.ts` (if P7 needs a pin)                             | D2, A1–A3, A5 (seed)                                                                                                                   |
| `packages/db/src/seed.test.ts`                                                                                                              | the source pin follows D1                                                                                                              |
| `apps/web/test/seed-fixtures-is-contained.test.ts`                                                                                          | D5                                                                                                                                     |
| DAL tests (`picker.test.ts`, `program-dal.test.ts`, `day.test.ts`)                                                                          | A5 by a mocked name                                                                                                                    |
| `packages/db/scripts/mutations/598…`, re-cut `506`, `517`, `.expect` of `318`/`319`, README                                                 | below                                                                                                                                  |
| `docs/features/movement-catalog.md`, `write-path.md`, `program-writers.md`, `docs/runbooks.md`, `docs/privacy/data-inventory.md`, changelog | D7; the inventory: production now holds the library's rows (reference data, global, no new category)                                   |

## Test plan: mutations (each turns `db:verify` red at the named proof)

| #   | The patch                                              | Fails at                   |
| --- | ------------------------------------------------------ | -------------------------- |
| 598 | `seed()` still writes the legacy rows without the flag | A1                         |
| 599 | `seed()` writes `CATALOG_MOVEMENTS` with the flag      | A2 (fixture catalog rows)  |
| 600 | the report's curated drops the catalog half            | A3                         |
| 601 | `seedProgramFixtures` ignores the library it is given  | A5 (the seed's alias case) |
| 602 | the TEN-2 discriminator drops the catalog half         | D2's TEN-2 assertion       |

`506` and `517` are re-cut, and `318`/`319` re-pointed, each run alone. The vitest-only rules (A4, A5's DAL
cases, A6, A7) are pinned by tests that can fail, with one-off probes recorded in the PR (a `db:mutations`
patch never runs vitest).

## Risks and rollback

- **The first production push writes several hundred rows in one transaction.** `lock_timeout` and
  `statement_timeout` are set on the seed's connections. **Before the merge (the maintainer, from their own
  console):**
  - cut a Neon restore branch;
  - run `db:seed` against it, expecting `CATALOG_MOVEMENTS.length − 12` inserted and 12 held by a legacy row:
    the writer's first real-Postgres run;
  - run the runbook's shadow query on production, so the household count is known in advance.
- **A bad library entry fails the seed** (an FK or a CHECK): `migrate.yml` turns red on every push until a
  fix-forward PR. The transaction leaves nothing behind (A2-i's D5.1), and the runbook entry says so.
- **Rollback:** revert the PR. That stops further writes; rows already written stay, are reference data, and
  are deleted only by the fresh start (R2) or a correction.

## For the contract owner (roadmap thread)

- **Q1. The fixture world's "Jump rope" and "Easy run"** (D6). Options:
  - (A) Recommended: the world takes the fixture library's types (`count`, `duration`), and its prescriptions
    follow (`world.ts:188, 266`). The world then demonstrates the library as it is.
  - (B) The world renames its two items so no library row matches ("Rope skipping", "Easy jog").
  - (C) The fixture library takes the world's types.

## ID-1's six keep-open items

1. The principal is a login: not touched.
2. Every access goes through `getHouseholdScope()`: unchanged. The seed writes global reference rows only.
3. Nothing relies on one household per person: nothing new.
4. Nothing pins an athlete to a household: no new key.
5. No age logic. The library adds muscles from the fixed `MUSCLES` list only.
6. Roles stay a const plus a CHECK: not touched.

## Review-response log

_The panel (db-safety, correctness, privacy) runs on this draft._
