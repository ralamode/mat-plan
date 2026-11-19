# CAT-3 A2-i — the catalog seed's writer, not yet switched on

> Backlog: [plan.md](../plan.md) row `CAT-3`. Spec:
> [cat-3-movement-library](../specs/cat-3-movement-library.md), § "The seed (lane A)" E1 to E5, rule 2,
> rule 6, rule 7, and the A2 row of "Chunks, in order". No migration. Mutations `502`–`511` (from
> lane A's block, `500`–`519`, which comes with the chunk). **Owner: lane P** _(maintainer,
> orchestrator's chat, 2026-11-19: "Lane P takes A2-i (Recommended)")_; lane A drafted this plan
> before the handoff.

## Where this sits

- **Pillar:** the movement library, shared reference data with no pillar in roadmap.md's table.
- **Milestone:** [Beta 0](../milestones/beta-1.md), `CAT-3`'s node in its step chart.
- **This PR:** chunk A2-i. The code that writes a list of library entries into `movements`,
  `movement_equipment` and `movement_muscles`, and its proofs. **Production's seed does not call it with
  any entry yet**: `seed()` passes an empty list, so production keeps its 35 old rows and gains nothing.
- **Before it:** A1 (#577, the tables), `OPS-2` PR 1 (#592, `seedReference` is reference-only). Both
  merged and applied.
- **After it:** lane P's P11-ii-a needs `movementIsCatalog()` from this PR, not the rows. A2-ii (the
  switch, E4) waits for this PR deployed, for P11-ii-a deployed, and for the maintainer's go.
- _Roadmap alignment (2026-11-19): advances `CAT-3` (chunk A2-i); unblocks P11-ii-a; gates nothing
  else; checked against the private roadmap, nothing to add here._

## Goal

One function, `seedCatalog(db, entries)`, that A2-ii can switch on by changing one argument. It writes
each entry as a global row with its `modality`, plus its equipment and muscle rows, in one transaction,
and never touches a row that already holds the slug or a row a household owns.

⚠️ **`CATALOG_MOVEMENTS` is not empty.** Nine batches have merged (326 entries on 2026-11-19). The
step plan's "inert while the list is empty" no longer holds, so this PR keeps production inert by
passing `[]` from `seed()`, and a proof (Proof A, extended) fails if it passes anything else.

## Acceptance

From the spec, verbatim where it applies to A2-i:

- **E1.** The catalog seed shall take its list as an argument and, on a database with no global
  movements (a scratch instance in `db:verify`, run with `CATALOG_MOVEMENTS`), leave exactly one
  catalog row per entry with its stored fields (never its aliases, supervision label, instructions or
  media, which no column holds: rule 11) and its equipment and muscle rows, written in one transaction
  (a forced failure mid-list leaves none), each join row keyed to the id its insert returned, never to
  a slug lookup.
- **E2.** If a global row already holds an entry's slug, then the seed shall leave that row and its join
  rows untouched and count it (a planted row with a seed-namespace `public_id`, a different type and no
  `modality`).
- **E3.** The seed shall never delete a `movements` row, never write a row that has a `household_id`,
  and never write a join row for one (a planted household row on a catalog slug).
- **E5.** The seed's report shall contain counts only for any row a household owns, and the seed shall
  exit 0 on a database whose households own rows that collide with catalog slugs.
- **Rule 2.** `movementIsCatalog()` (global **and** `modality IS NOT NULL`) beside `movementIsGlobal()`.
- **Inert in production (this PR's own criterion).** `seed({ fixtures: false })` on a fresh database
  leaves the global movements equal to `MOVEMENT_SEED_ROWS`, no row with a `modality`, and no join row.
- **Owed from A1:** the `movements-ownership` report's TEN-2d blocker count reads the CHECK's own
  predicate, so a legal non-strength catalog row with no pattern is not a blocker.

E4 (the switch) is A2-ii's.

## Decisions

### D1. Where it lives: `seed.ts`, called from `seedReference`

`seedCatalog` is a function in `packages/db/src/seed.ts`, exported for `db:verify`. `seedReference`
takes a **required** `{ catalog }` option (the same no-default rule `SeedOptions.fixtures` follows) and
calls `seedCatalog(db, catalog)` **before** the legacy `MOVEMENT_SEED_ROWS` insert, which is the order
A2-ii needs (`CATALOG_FIXTURE` "in its place, then the legacy fixtures": a catalog row on a shared slug
wins, and the legacy insert's `ON CONFLICT DO NOTHING` skips it). `seed()` passes `{ catalog: [] }`
with a comment naming A2-ii.

- **Why not a new module under `writers/`:** `seed.ts` is already on the stay-dark scan's allowlist for
  the reference tables, and the spec puts the writer inside `seedReference`. A module of its own would
  add an allowlist entry for one caller.
- **Why the argument and not a const in `seed.ts`:** A2-ii's diff is then one line in `seed()`, and the
  proofs call the same function with `CATALOG_MOVEMENTS`, a failing list and planted rows.

### D2. Three statements, one transaction

```
db.transaction(async (tx) => {
  inserted = INSERT INTO movements (public_id, slug, name, modality, pattern, tracking_type,
                                    unit_default, is_bodyweight)
             VALUES (… one row per entry, public_id = newId() …)
             ON CONFLICT (slug) WHERE household_id IS NULL DO NOTHING
             RETURNING id, slug
  INSERT INTO movement_equipment (movement_id, equipment_code) VALUES (… for each inserted …)
  INSERT INTO movement_muscles (movement_id, muscle_code, role) VALUES (… primary, then secondaries …)
})
```

- **Keyed to the returned id.** The join rows come from `inserted`, matched to entries through the
  `slug` the same `RETURNING` gave back: never a `SELECT … WHERE slug = …`. An entry whose slug was
  already held returns nothing, so it gets no join rows (E2).
- **E3 by construction:** the conflict target is the global partial index, so a household row on the
  slug neither conflicts nor is touched; the new row is global because no column sets `household_id`.
  No delete, no update.
- **Batched, not a row at a time.** 326 entries are about 326 × 8 movement parameters and under 4,000
  join parameters, well inside Postgres's 65,535. The batches will reach ~500 entries; the plan's limit
  is still one statement per table. If a list ever passes ~5,000 entries, chunk it inside the same
  transaction (out of scope).
- **Empty list:** returns `{ inserted: 0, skipped: 0 }` without opening a transaction.
- **Muscle order:** the primary first, then secondaries in authored order. The tables keep no order
  (P11-ii-b's open question); this only makes the insert deterministic.

### D3. The report: counts only, and the shadow report stops printing slugs

`seedCatalog` returns `{ inserted, skipped }`. `seedReference` also counts the household rows that sit
on a catalog slug, taken **before** the insert (as TEN-2c's shadow detection is). `seed()` prints one
line of counts: `catalog: N inserted, M already present, K household rows share a library slug`.

**The legacy shadow report changes to counts too.** Today it prints each seeded slug a household also
owns, and `OPS-2` B4 asserts the slug is printed. Rule 7 says the public log names no row a household
owns, and a slug of a household's row says what that household typed. B4's assertion is reversed: the
count is printed and the slug is not. The runbook's "the seed's shadow guard fired" gets the query that
lists the slugs, to be run by the operator against the database, not read from a public log.

### D4. `movementIsCatalog()` in `ownership.ts`

```ts
/** `household_id IS NULL AND modality IS NOT NULL`: a library row (spec rule 2). Not a slug test. */
export function movementIsCatalog() {
  return and(movementIsGlobal(), isNotNull(schema.movements.modality));
}
```

Used in this PR by: the seed's count of rows already present that are catalog rows (the report line
splits "already present" into catalog and legacy), and the proofs. P11-ii-a is its first app reader.

### D5. Proofs: E1 runs before Proof A's first seed

`db:verify` has one PGlite database. Right after `verifyCatalogMigrationFacts` (no movement exists
yet), a new `verifyCatalogSeedOnAFreshDatabase` runs inside `rolledBack`:

1. **E1:** `seedReference(tx, { catalog: CATALOG_MOVEMENTS })`. Assert one catalog row per entry, each
   stored field equal to the entry (`movementIsCatalog()` rows compared by slug with the const), its
   equipment set and its muscles with roles equal to the entry's, and the legacy rows that share no
   slug still written. A second call inserts nothing and counts every entry as present.
2. **E1, the forced failure:** a list whose last entry's primary muscle is cast to a code `muscles`
   does not hold. The call rejects (FK) and leaves no catalog row and no join row.

Then, in `verifyCatalogTables` (with the modules, after the seed has run), each inside `rolledBack`:

3. **E2:** plant a global row on a `CATALOG_MOVEMENTS` slug with a seed-namespace `public_id`, a
   tracking type the entry does not have and no `modality`. Seed with that one entry. The planted row's
   every column is unchanged, it has no join row, and the count says one present.
4. **E3 / E5:** plant a household row (household A) on a catalog slug. Seed with that entry. The call
   resolves; the household row is unchanged and has no join row; a global catalog row exists beside it
   with its join rows; the captured log has the count and not the slug.
5. **Inert in production** (Proof A, extended): after `seed({ fixtures: false })` twice on the fresh
   database, no `movements` row has a `modality` and both join tables hold no row of a global movement.
   This is the "class the join tables with `movements`" A1 owed: the join tables are compared with the
   list production's seed was given, which is empty.
6. **The ownership report:** plant a global `mobility` catalog row with no pattern; the TEN-2d blocker
   count is 0. Plant a global row with neither (inside a transaction that drops the CHECK as the V1-1b
   simulation does); the count is 1.

### D6. The ownership report reads the CHECK's predicate

`corrections/registry.ts`'s `checkViolations` is `global.filter((r) => r.pattern === null)`. It becomes
a count in SQL: `NOT (movementGlobalRowHasPattern(schema.movements))` over the global rows, reusing the
schema's exported fragment, so the report and the CHECK cannot drift again. The "curated / residual"
lines stay as they are: reading "legacy or catalog" is A2-ii's (the TEN-2 discriminators), when a
catalog row can first exist in production.

### D7. The stay-dark scan

`seed.ts` is already allowed. The A1 `describe`'s comment says "relaxed by A2 (the seed's catalog
writer …)": it changes to say the seed is the one writer, and that S4's "no writer makes a household
join row" is now held by proof 4 and mutation `503`, not by the scan. `ownership.ts` names the
`modality` column, not a library table, so it needs no entry.

## File-by-file changes

| File                                                         | Change                                                                                                               |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `packages/db/src/writers/ownership.ts`                       | `movementIsCatalog()` (D4)                                                                                           |
| `packages/db/src/seed.ts`                                    | `seedCatalog`; `seedReference(db, { catalog })`; `seed()` passes `[]`; counts report (D1–D3)                         |
| `packages/db/src/seed.test.ts`                               | the report line's shape; `seed()` passes an empty list (a source pin, as `fixtures` has)                             |
| `packages/db/scripts/verify/catalog.ts`                      | `verifyCatalogSeedOnAFreshDatabase`; proofs 3, 4, 6 in `verifyCatalogTables` (D5)                                    |
| `packages/db/scripts/verify/seed.ts`                         | Proof A's inert assertions (D5.5); B4 reversed (D3)                                                                  |
| `packages/db/scripts/verify.ts`                              | calls the new entry point after `verifyCatalogMigrationFacts`; `seedReference` callers pass `{ catalog: [] }`        |
| `packages/db/scripts/corrections/registry.ts`                | the blocker count from `movementGlobalRowHasPattern` (D6)                                                            |
| `packages/db/scripts/mutations/502`–`511`                    | below                                                                                                                |
| `apps/web/test/program-tables-stay-dark.test.ts`             | the comment (D7)                                                                                                     |
| `docs/features/movement-catalog.md`                          | what is here (the writer), invariant 6 (the seed is the one writer), traps: the A2 items done, what A2-ii still owes |
| `docs/runbooks.md`                                           | "the seed's shadow guard fired": counts, and the operator's query for the slugs                                      |
| `docs/specs/…`, `docs/plan.md`, `docs/roadmap.md`, changelog | the A2 row's A2-i done; roadmap note; fragment                                                                       |

Estimated 350–450 lines with the proofs; the mutation patches are extra and small.

## Test plan — mutations (each must turn `db:verify` RED, at the named proof)

| #   | The patch                                                        | Fails at  |
| --- | ---------------------------------------------------------------- | --------- |
| 502 | `seedCatalog` without the transaction                            | D5.2      |
| 503 | join rows resolved by a slug lookup without the global predicate | D5.4 (E3) |
| 504 | join rows resolved by a global slug lookup, for every entry      | D5.3 (E2) |
| 505 | the insert becomes `onConflictDoUpdate` (adopts the row)         | D5.3 (E2) |
| 506 | `seed()` passes `CATALOG_MOVEMENTS`                              | D5.5      |
| 507 | the report prints the colliding slugs                            | D5.4 (E5) |
| 508 | `movementIsCatalog()` drops the `modality` half                  | D5.1      |
| 509 | the registry's blocker count reverts to `pattern === null`       | D5.6      |
| 510 | the primary muscle is written with role `secondary`              | D5.1      |
| 511 | a stored field dropped from the insert (`modality`)              | D5.1      |

A mutation that cannot fail is not written. The spec's "drop the global predicate in the join-row
write" has no predicate to drop under D2 (the ids come from `RETURNING`), so `503` is its meaningful
form: the slug lookup D2 rules out.

## Risks / rollback

- **Production behaviour:** none, by D1 and proof 5. The one production-visible change is the log
  line, which prints counts where it printed slugs.
- **`seedReference`'s signature** changes; every caller is in `packages/db` (`seed()`, `verify.ts`).
  A missed one is a compile error.
- **Rollback:** revert. No migration, no row written in production.

## Out of scope

- E4, the switch, and `MOVEMENT_SEED_ROWS` under the flag (A2-ii).
- The TEN-2 discriminators reading "legacy or catalog", the 0022 proofs planting their own rows, the
  `.expect` of `318`/`319`, the runbook's step-5 counts (A2-ii: none can change until a catalog row
  exists in the shared verify database or in production).
- E6, updating catalog rows (A3, after the fresh start).

## Open questions

None for the maintainer. D3 (the shadow report stops printing slugs) changes a log line that a runbook
reads; the panel is asked to check it.

## Review-response log (adversarial panel)

_To be filled by the panel._
