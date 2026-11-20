# CAT-3 A2-ii — the seed switches to the movement library (with K29)

> Backlog: [plan.md](../plan.md) row `CAT-3`. Spec:
> [cat-3-movement-library](../specs/cat-3-movement-library.md), E4, K29, K22, K23, rule 2, rule 7, the A2 row
> and the P11-ii row. Lane P _(maintainer, 2026-11-19: "Lane P takes A2-i (Recommended)"; A2-ii follows it)_.
> No migration. Mutations from lane P's block, `598`–`609`. Facts: lane E's read-only fact sheet against
> main at `6f05c36d` (2026-11-20), every claim marked checked, inferred or unverified. **Precondition:**
> #763 (the contract owner's three test-library type fixes) is on main.

## Where this sits

- **Pillar:** the movement library. **Milestone:** [Beta 0](../milestones/beta-1.md), `CAT-3` (node 14).
- **This PR:** the plan for A2-ii. It is the moment production's library changes.
  - **Without the fixtures flag**, the seed writes `CATALOG_MOVEMENTS` (the approved entries) and stops writing
    `MOVEMENT_SEED_ROWS`.
  - **With the flag**, it writes `CATALOG_FIXTURE` in their place, then the legacy fixtures (E4).
  - **K29 lands inside it:** a database seeded with the fixture library is read with the fixture library.
- **Before it:**
  - A2-i (#703, the writer, deployed);
  - P11-ii-a (#732, the picker lists library rows, deployed);
  - the vocabulary order (#716);
  - lane E's day read on `CATALOG_LIBRARY` (#760);
  - #763.
- **After it:** P11-ii-b (the taxonomy from the tables), B3 in production, then the fresh start (R0–R4).
  Native Scaling's R1 runbook gates on this PR.
- _Roadmap alignment (2026-11-20): advances `CAT-3` (A2-ii, K29); unblocks the fresh start's load step;
  touches the movement catalog, so `ID-1`'s six keep-open items are answered below; checked against the
  private roadmap, nothing to add here._

## What production sees

On the first push after this merges, `migrate.yml`'s seed writes every library entry whose slug no global
row holds.

- **The new rows:** the number of unique slugs minus 12 new catalog rows with their join rows, in one
  transaction (A2-i's writer).
- **The 12 shared slugs:** the entries that share a slug with a legacy row are held by that row (E2) until R2
  deletes the legacy rows.
- **The picker** then lists every library movement beside the 35 old built-ins (P11-ii-a, K22).

Every later push inserts nothing, because every entry is present and A2-i's guards hold (rule 7). It still
sends one `INSERT … ON CONFLICT DO NOTHING` per push, which uses up an identity value per absorbed row on a
`bigint`. That is harmless, and `migrate.yml`'s header says so (`docs/lessons.md` → Database).

## Decisions

### D1. E4: one library value decides both the catalog and the legacy rows

`seedReference` writes `MOVEMENT_SEED_ROWS` unconditionally today (`seed.ts:406-409`), and it takes only
`{ catalog }`. So:

- **`seedReference(db, { library })`** takes one `library: CatalogLibraryName`. That is `'catalog' | 'fixture'`,
  the `CATALOG_LIBRARY_NAMES` as-const array in `packages/shared`, the same one the app uses.
  - `'catalog'` writes `CATALOG_MOVEMENTS` and no legacy rows.
  - `'fixture'` writes `CATALOG_FIXTURE`, then `MOVEMENT_SEED_ROWS`.
  - One value, so the impossible combinations cannot be written (security P2-5).
- **`seed()` passes `fixtures ? 'fixture' : 'catalog'`.**
- **The TEN-2c shadow count stays unconditional** (db-safety P1-2, correctness P1-2). The 35 legacy rows exist
  in production until R2 whether or not a run writes them, so a household row on a legacy slug, the 12
  shared ones included, is still counted and reported. B4 and mutation `329` stay as they are.

### D2. 🔴 Fixtures: the ownership check comes before any write (security P1-1)

Today, with the flag, `seedReference` commits first and `seedFixtures` refuses a household it does not own
afterwards (`seed.ts:540-599`). After the switch, a mis-aimed `SEED_FIXTURES=1` run would commit the 24 fixture
rows to that database before refusing. If the database were production behind an accepted URL limit, those
rows would be global, shown to every household, and permanent: on the 17 shared slugs, production's next seed
sees them as present (E2).

So:

- `seed()` runs **`assertSeedOwnsDatabase(db)` first**, before `seedReference`, when `fixtures` is on. This is
  `seedFixtures`' live-household and `public_id` check, extracted.
- A proof on a fresh database with a foreign live household: `seed({ fixtures: true })` rejects with the
  refusal message, and zero `CATALOG_FIXTURE` slugs exist afterwards.
- A mutation restores the old order.

### D3. `db:verify`: real-library seeds stay out of the shared database

`seed()` takes its executor as an argument. So every proof that seeds without the flag does it **inside
`rolledBack` with `seed(asDb(tx), …)` and reads on `tx`**, never `asPg`, which would hang on PGlite's one
connection (`verify.ts:7088-7089`).

- **Proof A** (`verify/seed.ts:133-196`) moves into `rolledBack`, with every read on `tx`. It asserts the E4
  outcome:
  - the global rows are exactly the `CATALOG_MOVEMENTS` slugs, all `movementIsCatalog()`, with their join rows,
    and no legacy row;
  - a second run inserts nothing.
- **`verify.ts:369`** (the 1c-4 / OPS-2 C no-flag run) is wrapped the same way.
- **`verify/schema.ts:1084→1096`** (FAM-1 1's no-flag-then-flag in one transaction): the no-flag half runs in
  its own savepoint, `rolledBack(fn, tx)`, and is rolled back before the flag half. Otherwise the world's
  "Split squat" and "Hamstring stretch" resolve to real-library rows of other types and their programs are
  skipped (db-safety P1-3, correctness P1-4).
- **OPS-2 B1, B2, B3 and B5** (`verify/seed.ts:255-356`, db-safety P0-1, correctness P1-1).
  `householdTableCounts` digests whole tables, including global `movements` and join rows, so a no-flag seed
  now changes it. It digests **household-owned rows only**: `household_id IS NOT NULL` for `movements`, and
  join rows whose movement is household-owned. A separate assertion checks that the only rows the seed
  added are global catalog rows on `CATALOG_MOVEMENTS` slugs not already held. B5's "every insert conflicts"
  comment is corrected.
- **From the first `seed({ fixtures: true })` on, the shared database holds the 24 `CATALOG_FIXTURE` rows plus
  the 35 legacy rows**, exactly what every e2e, preview and `e2e:local` database holds. The proofs that read
  it are updated:
  - `verify.ts:653-657`: the global count is `MOVEMENT_SEED_ROWS.length + CATALOG_FIXTURE.length`, split by
    kind;
  - **the TEN-2 discriminators** (`verify.ts:6715-6777`) read "legacy (`MOVEMENT_SEED_PUBLIC_IDS`) or a library
    row of the library in effect" (D4's exact test);
  - **`verify/program.ts`'s P11-ii-a proof** (correctness P1-3) assumes no library row exists. Its three
    entries move to slugs `CATALOG_FIXTURE` does not use (or are re-slugged with `day-plan.ts`' `proofSlug`),
    and `catalogRowsOf` is limited to them;
  - **erasure P7 and mutations `318`/`319`:** P7 (a) sees the fixture join rows first, so the `.expect` files
    move to P7's message. Each is run alone.

### D4. "A library row" is exact: a modality AND a slug of the library in effect

`movementIsCatalog()` alone accepts any global row with a `modality` (db-safety P2-8, security P2-1). The two
places that feed decisions use an exact test:

- **the ownership report** (`corrections/registry.ts:668-729`): curated is a legacy seed id **or**
  (`movementIsCatalog()` **and** the slug is in the library in effect's slug set). The report:
  - prints which library it checked against (`CATALOG_MOVEMENTS` in production);
  - counts "global with a modality but not a library slug" on its own line, expected 0;
  - keeps Native Scaling's R4 lines (PRIV-3 R1, D3) as separate lines, whichever PR lands second merging the
    other's.
- **the TEN-2 discriminators** in `db:verify`, with the same rule against `CATALOG_FIXTURE`.

Proofs, as deltas against the shared database's other rows:

- a planted library row is curated;
- a planted global row with a modality on a non-library slug is not curated, and is counted on its line;
- the orphan input does not move.

### D5. K29: the library in effect, one rule, both sides

- **The rule, once:** `isFixturesDatabase(url)` in `packages/shared/src/db-environment.ts`. It is
  `isLocalDbHost(url) || namesPreviewDatabase(databaseNameOf(url) ?? '')`, the body of today's
  `assertFixturesTargetAllowed` (`seed.ts:173-177`), with its accepted limits documented. The seed's refusal is
  its negation.
- **The choice:** `catalogLibraryNameFor({ databaseUrl, vercelEnv })` is a pure function in the same file. It
  returns `'fixture'` exactly when `isFixturesDatabase(databaseUrl)` and `vercelEnv?.trim() !== 'production'`,
  otherwise `'catalog'`. It never throws: it chooses, defaulting to the real library and needing positive
  proof for the fixture one.
- **The app:** `apps/web/lib/env.ts` calls it once at module scope, reading `process.env` directly. It sits
  outside `SKIP_ENV_VALIDATION`, as `assertDatabaseEnvironment` and `BYPASS_PRINCIPAL` do, and exports
  `catalogLibraryName()`. `lib/dal/catalog-library.ts` maps the name to the list, so `CATALOG_LIBRARY` stays a
  module-scope const. Its shape is unchanged, so lane E's day read (#760) needs no edit. The stale line about
  #760 goes.
- **The seed:** it decides by its flag, `'fixture'` exactly when fixtures is on, which `resolveSeedOptions`
  already restricts to databases the same rule admits. `seedProgramFixtures(db, scope, library)` takes that
  list, and its `newItem` call (`seed-fixtures.ts:192`) passes it.
- **The start-up line (condition 2):** `CATALOG_LIBRARY_FIXTURE_NOTICE`, exported beside `DB_ENV_MESSAGE`, is
  logged once when the name is `'fixture'` and never otherwise. The test asserts the logged text `toBe` the
  constant (security P2-2). It names the rule and no URL, so it is safe in CI's public `next build` log.
- **The production pins** (A4) are tested by equality, beside OPS-1's tests:

  | Input                                                                                | Answer                                        |
  | ------------------------------------------------------------------------------------ | --------------------------------------------- |
  | production + a local database                                                        | `'catalog'`                                   |
  | production + a preview-named database                                                | `'catalog'`                                   |
  | `VERCEL_ENV=' production '`                                                          | `'catalog'`                                   |
  | no `VERCEL_ENV` + a remote production name (the `dev:prod` shape, `ALLOW_LIVE_DB=1`) | `'catalog'`                                   |
  | a remote database with no name                                                       | `'catalog'`                                   |
  | `localhost/db?host=ep-x.neon.tech` and `?%68ost=`                                    | `'catalog'`                                   |
  | no `VERCEL_ENV` + a remote preview name                                              | `'fixture'`                                   |
  | a local database, off production                                                     | `'fixture'`                                   |
  | `mat_plan_%70review`, off production                                                 | `'fixture'` (as the seed and OPS-1 decode it) |

### D6. K29 condition 1: every database the rule admits is seeded with fixtures

A test lists every fixtures target and asserts each one seeds with `SEED_FIXTURES=1`:

- CI's e2e job (`ci.yml:449, 601`);
- `migrate-preview.yml:84`;
- `embedded-pg.ts:148` and its three callers;
- the runbook's manual preview seed.

`migrate.yml` never sets the flag. This extends `apps/web/test/seed-fixtures-is-contained.test.ts`. The gaps are
recorded as accepted, each with what it costs:

- **A localhost database seeded by hand without the flag** reads the fixture library over real rows, and if
  later seeded with the flag it holds both libraries. That makes the mixed state the schema proof's savepoint
  avoids: fixture programs whose items match real rows of another type are skipped. A developer's own
  database; a runbook line says to reset it.
- **A preview database between a push and its re-seed:** one deploy. PR previews of branches cut before the
  switch read it with `CATALOG_MOVEMENTS`.
- **The preview database keeps the household items earlier seeds made** (Goblet squat, Side plank, Jump rope,
  Easy run), now shadowed by fixture rows: a mixed state until the preview is reset. A runbook line.
- **A production database named `*preview*`:** OPS-1's limit. `VERCEL_ENV` is the guard for the app, and D2 is
  the guard for the seed.
- **The seed reads `DATABASE_URL_UNPOOLED ?? DATABASE_URL`, and the app reads `DATABASE_URL`.** They agree on
  every wired estate:
  - locally, both are set to one URL (`embedded-pg.ts:141-142`, `dev-local.ts:91-92`);
  - on the preview, OPS-1 checks the app's preview name, and the seed's `EXPECTED_DB_ENV=preview` checks the
    unpooled one.

  The seed's allowlist checks the exact string it connects with. So a mismatch can only choose the wrong
  library on a non-production deployment, never put fixtures in production.

### D7. Every fixture program is written

**Since #763** the four names both lists share (Goblet squat, Side plank, Jump rope, Easy run) log alike, so
on a fixtures database the world's items resolve to library rows of their own type. The correctness lens
checked all 26 world items by name, alias and the "db" short form.

A2 asserts that every `SEED_FIXTURE_PROGRAM_CLIENT_IDS` program is present after a fixtures seed. That
includes the Family program, with its Conditioning workout, which Athlete One and Athlete Two are on and which
`day-page.spec.ts` and `program-builder.spec.ts` use.

### D8. Docs and comments the switch makes false

- `seed.ts:219-221`;
- `catalog-movements.ts:34-38`;
- `movement-catalog.md:28`, and its A2-ii trap list (closed);
- the inventory's future tense:
  - `data-inventory.md:496-497`: "Nothing writes them yet";
  - `:527`: "only the catalog seed (A2) will write it";
  - `:528`: "once A2 seeds them".

  Plus a dated §1/§1a re-read noting that production holds the library's rows (global reference data, no new
  category), and that they survive a household deletion (runbook 10a/10b).

- **The runbook:**
  - step 5's join-row counts go live;
  - a new entry for a seed run that fails on catalog data: fix forward, nothing left behind. `db:migrate` ran
    first, so read the log, not the colour;
  - the preview and localhost reset lines (D6).

## Acceptance

- (A1) **E4 without the flag**, on a fresh database: the global movements are exactly the `CATALOG_MOVEMENTS`
  slugs, every one a library row with its join rows, and no legacy row. A second run inserts nothing.
- (A2) **E4 with the flag:** the `CATALOG_FIXTURE` rows, all 35 legacy rows, then the household fixtures, and
  **every fixture program** (D7). This assertion sits before any other proof that reads the shared state.
- (A3) **D2:** a fixtures seed on a database a foreign household owns writes nothing.
- (A4) **K29's rule:** `catalogLibraryNameFor`'s table, by equality.
- (A5) **K29's readers on a fixtures database** get `CATALOG_FIXTURE`. Each reader's test mocks the name
  explicitly, once per name, because `vitest.config.ts` sets a localhost `DATABASE_URL` (correctness P2-7).
  `catalog-library.ts` has its own test of both mappings. The readers:
  - the picker's read;
  - "How to";
  - `newItem`;
  - lane E's case, the day resolver.
- (A6) **The seed's library reaches `newItem`.** In a rolled-back fresh database: `seedReference('fixture')`,
  then `seedFixtures`, then `seedProgramFixtures(tx, scope, L)`. `L` is `CATALOG_FIXTURE` with `squat_jump`
  (reps) given the alias "Burpees" (reps, `world.ts:118`), so the Burpees prescription points at the
  `squat_jump` row. An anti-vacuity assertion checks that no `CATALOG_MOVEMENTS` entry carries that alias.
- (A7) **K29 condition 1:** every fixtures target seeds with the flag, and `migrate.yml` never does.
- (A8) **K29 condition 2:** the notice is logged by equality on `'fixture'` and nothing is logged on `'catalog'`.
- (A9) **D4:** the report's three cases, as deltas.
- (A10) **D3's B cases:** the household digests are unchanged, and the only global rows added are library rows.

## Files

| File                                                                                                                                        | Change                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `packages/db/src/seed.ts` (+ test)                                                                                                          | D1, D2: `seedReference({ library })`, `assertSeedOwnsDatabase`, the order, the comments; the source pin follows |
| `packages/db/src/writers/program/seed-fixtures.ts`                                                                                          | `seedProgramFixtures(db, scope, library)`                                                                       |
| `packages/shared/src/catalog/`                                                                                                              | `CATALOG_LIBRARY_NAMES` and its type                                                                            |
| `packages/shared/src/db-environment.ts` (+ test)                                                                                            | `isFixturesDatabase`, `catalogLibraryNameFor`, `CATALOG_LIBRARY_FIXTURE_NOTICE`                                 |
| `apps/web/lib/env.ts` (+ test)                                                                                                              | `catalogLibraryName()`, the notice                                                                              |
| `apps/web/lib/dal/catalog-library.ts` (+ test)                                                                                              | the name-to-list map; the stale line                                                                            |
| `packages/db/scripts/corrections/registry.ts`                                                                                               | D4                                                                                                              |
| `packages/db/scripts/verify/seed.ts`, `verify.ts`, `verify/schema.ts`, `verify/program.ts`, `verify/catalog.ts`                             | D3, D4, A1–A3, A6, A9, A10                                                                                      |
| DAL tests (`picker.test.ts`, `program-dal.test.ts`, `day.test.ts`)                                                                          | A5                                                                                                              |
| `apps/web/test/seed-fixtures-is-contained.test.ts`                                                                                          | A7                                                                                                              |
| `.github/workflows/migrate.yml`                                                                                                             | a header line: a push inserts nothing after the first, and uses identity values                                 |
| mutations `598…`, re-cuts and re-points (below), README                                                                                     |                                                                                                                 |
| `docs/features/movement-catalog.md`, `write-path.md`, `program-writers.md`, `docs/runbooks.md`, `docs/privacy/data-inventory.md`, changelog | D8                                                                                                              |

## Test plan: mutations (each turns `db:verify` red at the named proof)

| #   | The patch                                               | Fails at                                     |
| --- | ------------------------------------------------------- | -------------------------------------------- |
| 598 | `'catalog'` still writes the legacy rows                | A1                                           |
| 599 | `'fixture'` writes `CATALOG_MOVEMENTS`                  | A2 (placed first among shared-state readers) |
| 600 | the report's curated drops the catalog half             | A9                                           |
| 601 | `seedProgramFixtures` ignores the library it is given   | A6                                           |
| 602 | the TEN-2 discriminator drops the catalog half          | D3's TEN-2 assertion                         |
| 603 | the fixtures ownership check runs after `seedReference` | A3                                           |
| 604 | the B digests count global rows again                   | A10                                          |

- **Re-cut and re-pointed:**
  - `506`: its claim, "production's seed writes no catalog row", is now false. It is retired, and 598 covers the
    flag's half; the README row says so.
  - `515`: re-pointed to a new early, labelled assertion that `seedReference` resolves on an empty library list.
  - `517`;
  - `318`/`319` to P7;
  - `328`/`329` re-checked.

  Each is run alone; the README rows follow.

- **The vitest-only rules** (A4, A5, A7, A8) are pinned by tests that can fail. One-off probes are recorded in
  the PR, since a `db:mutations` patch never runs vitest.

## Risks, the rehearsal, and rollback

**Before the merge, the maintainer, from their own console:**

1. **Cut a Neon restore branch of production, and leave it untouched.** Keep it until R2 has run.
2. **Rehearse on a separate child branch**, deleted afterwards:
   - run `db:seed` from this PR's head SHA, with `EXPECTED_DB_ENV=production` and `SEED_FIXTURES` explicitly
     unset. This is an exception to `runbooks.md:975`'s "hand-run a seed only from `origin/main`", and the
     runbook gains a line saying so;
   - expect exactly: inserted = unique library slugs − 12, already present = 0, held by a legacy row = 12. If
     more than 12 are held, stop: a non-legacy global row holds a library slug;
   - run it again: 0 inserted, 12 held. Record the first run's wall time against the 60-second statement
     timeout;
   - run the D4 ownership report on that branch, the only place D4 meets real data. Expect 0 in the orphan
     input and in "modality but not a library slug".
3. **Run the runbook's shadow query on production.**
4. **Only counts go into the PR**: the rehearsal's numbers and the household count, never a slug or a name
   (security P2-6).
5. **Repeat the rehearsal** if `packages/shared/src/catalog/**` changes on main before the merge.

**Risks:**

- A bad library entry fails the seed (an FK or a CHECK): `migrate.yml` turns red on every push until a
  fix-forward PR. The transaction leaves nothing behind (A2-i's D5.1), and the runbook entry says so.
- **Rollback, stated plainly:**
  - Reverting the PR stops further writes. The rows already written stay, and P11-ii-a lists them.
  - Once a household logs or prescribes one, `NO ACTION` foreign keys block deleting it, and no correction
    exists for that.
  - So a full undo is only the restore branch, which loses every write since it was cut. The window for that
    is from the first production seed until the first household uses a library row.

## ID-1's six keep-open items

1. The principal is a login: not touched.
2. Every access goes through `getHouseholdScope()`: unchanged. The seed writes global reference rows, and the
   library choice is global, not per household.
3. Nothing relies on one household per person: nothing new.
4. Nothing pins an athlete to a household: no new key.
5. No age logic. The library adds muscles from the fixed `MUSCLES` list only.
6. Roles stay a const plus a CHECK: not touched.

## Review-response log

**Approved** _(maintainer, 2026-11-20, relayed by the FAM-1 board: "Approve (Recommended)")_, including the
console rehearsal before the merge and the rollback limits as stated. Build starts once #763 is on main.

Panel on the first draft (2026-11-20): db-safety, correctness, security and privacy, on Opus 5.5 (the author
on Opus 5.5). No P0 stands: the db-safety P0 is fixed in D3. Every finding is accepted.

| #               | Lens                         | Finding                                                                                                                                           | Response                                                                                    |
| --------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| DS-P0-1, C-P1-1 | db-safety, correctness       | OPS-2 B1/B2/B3/B5 digest whole tables, so they go red                                                                                             | D3: household rows only; A10; 604                                                           |
| S-P1-1          | security                     | With the flag, the fixture library is committed before the ownership refusal                                                                      | D2: `assertSeedOwnsDatabase` first; A3; 603                                                 |
| DS-P1-2, C-P1-2 | db-safety, correctness       | Gating the TEN-2c count drops B4, 329, and the 12 shared slugs                                                                                    | D1: the count stays unconditional                                                           |
| DS-P1-3, C-P1-4 | db-safety, correctness       | `schema.ts:1084→1096` skips fixture programs against the real library                                                                             | D3: the no-flag half in its own savepoint                                                   |
| C-P1-3          | correctness                  | P11-ii-a's proof assumes no library row                                                                                                           | D3: fixture-free slugs                                                                      |
| DS-P1-4         | db-safety                    | 515 loses its target                                                                                                                              | re-pointed to an early labelled assertion                                                   |
| DS-P1-5, C-P1-5 | db-safety, correctness       | 601 cannot fail                                                                                                                                   | A6: a synthetic alias, with an anti-vacuity check                                           |
| DS-P1-6         | db-safety                    | The rehearsal writes into the restore point                                                                                                       | the child branch, exact counts, two runs, the report, the exception named                   |
| S-P2-1, DS-P2-8 | security, db-safety          | "Library row" was a column test                                                                                                                   | D4: modality AND the library's slugs                                                        |
| S-P2-2          | security                     | The notice needs an equality pin                                                                                                                  | D5, A8                                                                                      |
| S-P2-3, C-P2-8  | security, correctness        | The production-pin cases were incomplete, one wrong                                                                                               | D5's table                                                                                  |
| S-P2-4          | security                     | A cited test did not exist                                                                                                                        | D6: the reasoning instead                                                                   |
| S-P2-5          | security                     | Two flags could encode the impossible                                                                                                             | D1: one `library` value                                                                     |
| S-P2-6          | security                     | The shadow query's output                                                                                                                         | counts only into the PR                                                                     |
| DS-P2-7         | db-safety                    | The rollback claim was overstated                                                                                                                 | stated plainly, with the window                                                             |
| C-P2-6          | correctness                  | D6 understated the skip; Q1 must block                                                                                                            | resolved by #763, a precondition; D7 asserts every program                                  |
| C-P2-7          | correctness                  | vitest defaults to the fixture library                                                                                                            | A5: mocked per name, and a mapping test                                                     |
| —               | all                          | `rolledBack` + `seed(asPg)` hangs on PGlite                                                                                                       | D3: `seed(asDb(tx))`, reads on `tx`                                                         |
| —               | db-safety, correctness       | 506, 599, A3's delta, the identity-value note, the failed-seed runbook line, the preview and localhost mixed states, the inventory's future tense | in D3, D4, D6, D8 and the mutation list                                                     |
| Q1              | correctness (lane E's sheet) | Jump rope / Easy run types                                                                                                                        | the contract owner's #763: the test library takes the world's types (the board, 2026-11-20) |
