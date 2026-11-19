# CAT-3 P11-ii — the picker lists library movements, with their taxonomy from the database

> Backlog: [plan.md](../plan.md) row `CAT-3`. Spec: [cat-3-movement-library](../specs/cat-3-movement-library.md),
> criterion P11, K22, K23, K29, S6, rule 2 and the P11-ii row of "Chunks, in order". Lane P. Mutations
> `590`–`609` (the board, 2026-11-19).

## Where this sits

- **Pillar:** the movement library (shared reference data; no pillar in roadmap.md's table).
- **Milestone:** [Beta 0](../milestones/beta-1.md), `CAT-3`'s node in its step chart.
- **This PR:** the plan only. **The code is two PRs** (panel S2, below):
  - **P11-ii-a, the rows:** the read lists every catalog row, with its aliases, supervision label
    and `hasInstructions` from the library in effect, so `newItem`, Enter and search agree on it.
    It waits for **A2-i** (lane A: `movementIsCatalog()` and the catalog writer) and comes **before
    A2-ii** (the switch to `CATALOG_MOVEMENTS`). Without it, A2-ii would put catalog rows on
    production that only `newItem`'s slug step can find, and a re-spelled name would make a
    household duplicate (the ⚠️ in `new-item.ts`, step 2).
  - **P11-ii-b, the taxonomy:** a catalog row's modality, pattern, equipment and muscles come from
    the tables instead of the const; the payload is measured.
- **Before it:** P11-i (#571, #586), A1 (#581: the tables), K22 (#587: every old built-in stays
  listed until the fresh start).
- **After it:** B3's tree reads these fields unchanged; R2 has P11 as a precondition.
- _Roadmap alignment (2026-11-19): advances `CAT-3` (P11-ii); touches the movement catalog, so it
  answers `ID-1`'s six keep-open items below; checked against the private roadmap, nothing to add
  here._

## Goal

Today the option read (`packages/db/src/queries/program/movement-options.ts`) lists the global rows
whose slug `MOVEMENT_PICKER_ENTRIES` names. The web DAL (`apps/web/lib/dal/program/picker.ts`)
attaches each one's taxonomy from `CATALOG_MOVEMENTS` by slug. `newItem` matches over the read
directly (`new-item.ts:88`), so it never sees what the DAL attaches.

After this chunk:

1. **The read lists every catalog row** (rule 2, `movementIsCatalog()`), as well as the old built-ins
   (K22, unchanged).
2. **The read takes the library as an argument** (`movementOptions(exec, scope, library)`), as the day
   resolver already does (`queries/day/day-plan.ts:99`). A catalog row's aliases, supervision label
   and `hasInstructions` come from that list's entry on its slug, so `newItem` and the picker match
   over the same aliases (K23).
3. **(P11-ii-b) A catalog row's taxonomy comes from the tables**: `modality` and `pattern` from
   `movements`, the equipment set from `movement_equipment`, the primary and secondary muscles from
   `movement_muscles`. An old built-in still gets the library's taxonomy by slug (P11-i's path), or
   none.
4. **The DAL only builds the DTO**, field by field, copying `group` through from the read (Amendment 1).

## The predicate, written out (panel P1-1)

```ts
// catalog arm
and(
  movementIsGlobal(),
  isNull(movements.deletedAt),
  or(inArray(movements.slug, PICKER_SLUGS), movementIsCatalog()),
);
```

The `or` sits inside the global and live conjuncts. A household row on a picker slug never enters the
catalog arm. `isCatalog` is selected as a column through `movementIsCatalog()` (rule 2's one
predicate, never re-derived as `modality !== null` in TypeScript). Only rows with `isCatalog` true
get table taxonomy, so an old built-in is never given `equipment: []` (which means "No equipment",
`movement-option.ts`'s 🔴).

## Acceptance

### P11-ii-a

- (a1) **Every catalog row is listed**, as `catalogOptionOf(entry, publicId)` with the row's identity
  (name, tracking type, unit, bodyweight flag) written over it, for the library the seed used.
- (a2) **Old built-ins are unchanged.** The 35 legacy rows give exactly the options they give today:
  the expected options are a snapshot taken on main before the change. No table taxonomy is attached
  to any of them.
- (a3) **No other household changes what the caller sees.** Another household owns items on a
  `PICKER_SLUGS` slug, on a catalog-only slug and on a catalog alias. The caller's list is the same
  with or without them. Mutations drop `movementIsGlobal()` and `isNull(deletedAt)` from the catalog
  arm, and each conjunct of the household arm.
- (a4) **A household item a catalog row shadows is left out**, for a catalog-only slug too.
- (a5) **`newItem` selects a catalog row by its alias** (step 1, `existed: true`). A mutation that drops
  the library's aliases from the read turns it red. The ⚠️ in `new-item.ts` step 2 is closed.
- (a6) **K23 pairs.** These are planted on purpose; the fixture is disjoint from the legacy rows, so it
  never makes a pair:
  - the old "Dips" beside a catalog "Dip";
  - a catalog row with the alias `OHP` beside the old Overhead Shoulder Press.

  `newItem` returns the row the picker's search lists first.

- (a7) **No catalog rows at all** (production right after A2-i deploys): the read is today's, and
  `inArray([])` is never sent.
- (a8) **The internal `movements.id` never reaches `MovementOption`.** It stays local to the read, and
  `picker.test.ts` pins the option's keys, slug excluded, as today.

### P11-ii-b

- (b1) **The taxonomy is the tables'.** The proof edits one catalog row's `movement_equipment` and
  `movement_muscles` and the option follows. A mutation that takes the library entry's taxonomy
  instead turns it red. This runs in `db:verify`, because the mapping is in the read now (panel
  correctness 3).
- (b2) **The join reads take listed catalog ids only.** They live in one exported helper,
  `catalogTaxonomyRows(exec, ids)`. The proof asserts its raw rows: no `movement_id` outside `ids`. A
  household-owned join row is planted by hand inside a transaction that is rolled back, so the
  "no household join row" proof stays green. The assembly throws on a join row for an unlisted id. A
  mutation that drops the id filter turns the proof red.
- (b3) **Order:** the order the roadmap thread decides (Q2 below), pinned on an entry whose authored
  order differs from the code order (`incline_dumbbell_press`, `['dumbbell','bench']`). A mutation
  reorders it. The primary muscle and the secondaries are separate selects, never ordered "by role".
- (b4) **Values are parsed** through `modalitySchema`, `equipmentSchema`, `muscleSchema` and
  `movementPatternSchema`, as `declared()` parses the unit. A parse failure means a broken schema,
  not drifted data. The foreign keys to the reference tables and the modality CHECK hold every
  value, so a code can only fail if it leaves the shared vocabulary while rows still hold it. A code
  leaves only after A3 rewrites its rows, which is a note for A3's plan.
- (b5) **Payload measured:** the bytes of `getItemPickerData()`'s result over the real
  `CATALOG_MOVEMENTS` plus the 35 old rows, and at 500. The figures go in the PR body. JSON length
  stands in for the RSC payload. Never measured on production, where household item names are free
  text.

## Files

| File                                                                                                                                                                                                                               | PR         | Change                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/db/src/queries/program/movement-options.ts`                                                                                                                                                                              | a, b       | The predicate above; the `library` argument; the catalog arm's aliases, supervision and `hasInstructions` from it; `group` optional; (b) `catalogTaxonomyRows` and the assembly; `taxonomy` a required key on the catalog arm, `Pick<CatalogOptionTaxonomy, 'modality' \| 'pattern' \| 'equipment' \| 'primaryMuscle' \| 'secondaryMuscles'> \| null` (panel S4), reusing the shared type. |
| `packages/db/src/writers/program/new-item.ts`                                                                                                                                                                                      | a          | Takes the library and passes it to the read; docblock step 2 closed. Its one caller (the DAL's write) passes it.                                                                                                                                                                                                                                                                           |
| `apps/web/lib/env.ts`, `packages/shared/src/db-environment.ts`, `packages/db/src/seed.ts`, `lib/dal/catalog-library.ts`, the CI smoke step, the two harnesses, `seed-fixtures-is-contained.test.ts`, `check-preview-isolation.mjs` | **K29 PR** | Not P11-ii-a: Amendment 1, A1.1.                                                                                                                                                                                                                                                                                                                                                           |
| `apps/web/lib/dal/program/picker.ts`, `writes.ts`                                                                                                                                                                                  | a, b       | Pass the library in effect (Q1); `pickerOptionOf` copies fields one by one, `group` included.                                                                                                                                                                                                                                                                                              |
| `apps/web/lib/dal/program/picker.test.ts`                                                                                                                                                                                          | a, b       | The three arms, the keys, (b5).                                                                                                                                                                                                                                                                                                                                                            |
| `packages/db/scripts/verify/program.ts`                                                                                                                                                                                            | a, b       | Acceptance (a1)–(a9) (Amendment 1), (b1)–(b4).                                                                                                                                                                                                                                                                                                                                             |
| `packages/db/scripts/mutations/590…`                                                                                                                                                                                               | a, b       | One per conjunct and source above, each with its README row.                                                                                                                                                                                                                                                                                                                               |
| `apps/web/test/program-tables-stay-dark.test.ts`                                                                                                                                                                                   | b          | Q4 below.                                                                                                                                                                                                                                                                                                                                                                                  |
| `packages/db/src/schema.ts`                                                                                                                                                                                                        | b          | The `movementEquipment` docblock's "nothing in `apps/` reads them until P11-ii" (a board guest edit).                                                                                                                                                                                                                                                                                      |
| `docs/privacy/data-inventory.md`                                                                                                                                                                                                   | b          | A one-line re-read: the picker's options carry more catalog rows and the tables' taxonomy, all reference data on global rows (the CHECK holds), no new category.                                                                                                                                                                                                                           |
| `docs/features/program-writers.md`, `program-builder.md`, `movement-catalog.md`                                                                                                                                                    | a, b       | Which rows the read lists; where an option's fields come from; that the tables are read.                                                                                                                                                                                                                                                                                                   |
| changelog fragment each PR                                                                                                                                                                                                         | a, b       |                                                                                                                                                                                                                                                                                                                                                                                            |

## Decisions from the roadmap thread (spec owner, 2026-11-19)

- **Q3, decided: yes to all four.** The spec owner records them in its next docs PR:
  - P11-ii is two PRs (P11-ii-a and P11-ii-b, above);
  - its dependency reads "After P11-i and A2-i";
  - "the read maps it; the DAL builds the DTO";
  - A2-ii waits for P11-ii-a deployed. The board takes lane A's acknowledgement of this.
- **Q4, decided: (A).** S6 ends the stays-dark `describe` at P11's second PR, now P11-ii-b, which is
  the first PR whose request path reads the tables (the read is in `packages/db`, which the guard also scans). P11-ii-b retires it with lane A's agreement (the test is
  theirs), and its PR body says what replaces that protection: this read's proofs. No allowlist
  grows.
- **Q1, decided (spec K29; maintainer, 2026-11-19: "Test databases - ok").** A database seeded with
  the fixture library is read with it, and production refuses anything else. **When and how it is built
  is Amendment 1, A1.1 and Q5**: its own PR, with A2-ii, not P11-ii-a. Declined by the spec owner:
  disjoint fixture slugs.
- **Q2, with the maintainer.** The spec owner recommends (A): the vocabulary's order (`EQUIPMENT`,
  `MUSCLES`), in the read and in `catalogOptionOf`. Measured on main: 14 of 326 entries list
  equipment out of vocabulary order (so 14 rows would word "what it needs" differently), and 54
  list secondary muscles out of order (no screen shows those today). The spec gives the authored
  order no meaning. If chosen, the contract change is the spec owner's (`option.ts:33`,
  `catalogOptionOf` sorting, `option.test.ts`) and lands **before P11-ii-b**, so (b3)'s comparison
  with `catalogOptionOf` holds. **Nothing is built on Q2 until the maintainer answers.**
- **Lane E's `dal/day/day.ts:60`** takes the same library in effect, in lane E's own PR after
  P11-ii-a merges (it reads `CATALOG_MOVEMENTS` today, so the day page on a fixtures database shows
  the real library's supervision label on fixture rows). Lane P tells lane E when P11-ii-a lands.

## Amendment 1 (2026-11-19, after the post-merge review)

The maintainer merged this plan before its `review-pr` ran. The retroactive review (Opus 5.5, a
reviewer that wrote none of it, posted on #666) found one P1 and eight P2s. A first draft of this
amendment was then re-reviewed by the security, correctness, reuse and scope lenses (log below), and
this is the result. It closes every finding before any P11-ii code is committed.

### A1.1 The library in effect becomes its own PR, with A2-ii (scope P1-1, P1-2; correctness P2-2)

K29's mismatch begins only when a database holds `CATALOG_FIXTURE` rows, and only A2-ii writes them
(A2-i writes none). Switching CI to the fixture library earlier would annotate the 35 old built-ins
from a list that has none of them. CI's smoke asserts real-library annotations
(`e2e/movement-picker.a11y.spec.ts:87`, `:117-125`), so it would go red, or green on wrong data. So:

- **P11-ii-a passes `CATALOG_MOVEMENTS`**, as `dal/day/day.ts:60` already does for the day resolver.
  The read takes the library as an argument (Goal 2), so the switch later is one value.
- **K29 is a PR of its own (lane P), landing immediately before A2-ii or inside it**, flip included.
  That needs the spec owner to edit K29's "Lane P builds it in P11-ii-a" (Q5 below). The maintainer's
  decision ("Test databases - ok") is unchanged.

Its design, whichever mechanism Q5 picks:

- **One shared rule, not a second copy.** `seed.ts`' `assertFixturesTargetAllowed` (`:159-170`) already
  answers "may this database carry fixtures?" (`isLocalDbHost(url) || namesPreviewDatabase(databaseNameOf(url) ?? '')`,
  with its accepted limits documented). The boolean moves to `packages/shared/src/db-environment.ts` as
  `isFixturesDatabase(url)`, with that docblock. The seed throws on its negation. The app adds
  `VERCEL_ENV?.trim() !== 'production'` on top. A `null` database name and an unset `DATABASE_URL` are
  not fixtures databases.
- **`apps/web/lib/env.ts` exports only the name** (`catalogLibraryName(): 'catalog' | 'fixture'`),
  decided once at module scope, outside `SKIP_ENV_VALIDATION`, by equality (the `BYPASS_PRINCIPAL`
  pattern), never by an object lookup. The lists stay out of `env.ts`, which `proxy.ts` and
  `sentry.edge.config.ts` import. **One DAL module** (`lib/dal/catalog-library.ts`) maps the name to its
  list and one memoised slug index. `picker.ts` (its fixed `LIBRARY` map is deleted), `writes.ts`
  (`newItem`), `getHowTo`, and lane E's `day.ts:60` (lane E's own PR) import it.
- **The names are shared constants**: `CATALOG_LIBRARY_ENV` and `CATALOG_LIBRARIES` (an `as const`
  array, zod enum and type) in `packages/shared/src/catalog/`, beside `SEED_FIXTURES_ENV`'s pattern.
- **Wiring, if Q5 keeps a variable:**
  - CI: the Playwright smoke step's step-level `env:`, beside `E2E_SESSION_BYPASS_USER_ID`. Not beside
    `SEED_FIXTURES=1`, which is inline on the seed command and never reaches the app.
  - Local harnesses: injected into the app env by `e2e-local.ts` and `screenshot-ephemeral.ts`, from
    the shared constant, beside the bypass injection.
  - Preview: the Vercel preview scope (the maintainer, by hand), checked by `pnpm preview:check`,
    which also refuses the variable in a production scope.
  - Not `migrate-preview.yml`, which runs no app.
  - A containment test (`seed-fixtures-is-contained.test.ts`, extended): every workflow that seeds
    fixtures and starts the app names the fixture library, and `migrate.yml` names neither.
- **Tests that can fail** (security P1-1, correctness P1-1). OPS-1's `assertDatabaseEnvironment` runs
  first at import, so a case it refuses proves nothing. The predicate is a pure function in
  `db-environment.ts` with an exported message, asserted by equality:
  - production with a **local** database (OPS-1 lets it through), refused by the new rule;
  - no Vercel variables, a remote non-preview database, and `ALLOW_LIVE_DB=1` (the `pnpm dev:prod`
    case, where the new rule is the only guard), refused;
  - a local database and a preview-named one off production, accepted;
  - a typo under `SKIP_ENV_VALIDATION`, refused;
  - a database with no name, and the `?host=` override, both refused.

  The flip from conjunction to disjunction is a one-off probe run in review, with its result in the
  PR body. It is not a `db:mutations` patch, which never runs vitest. The DAL tests mock the accessor
  to return the fixture library, and assert it is the argument the read and `newItem` receive. They
  also check `getHowTo` on a fixture-only slug.

- **"Fails the build"** is a test obligation, not a claim. Run
  `CATALOG_LIBRARY=fixture VERCEL_ENV=production DATABASE_URL=postgres://u:p@localhost:5432/db pnpm --filter web build`
  and record that it exits non-zero with the new message. If Next does not evaluate the module at
  build time, the plan says "fails at boot", which fails closed.

### A1.2 What P11-ii-a's read returns for every catalog-arm row (review P2-3; correctness P1-3, P1-4, P2-1)

Goal 2's "a catalog row" means **every row of the catalog arm**. The per-row mapping is one pure exported
function in `packages/db`, `catalogArmOption(row, pickerEntry, libraryEntry)`, used by the read, with
its own vitest file. Its cases:

| Row                       | Library entry on its slug | Option                                                                                                                                                                                                  |
| ------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| old built-in              | yes                       | the row's identity; aliases = the const's joined with the entry's by the picker's name key (today's `joinAliases`, moved); the entry's taxonomy, supervision and `hasInstructions`; the const's `group` |
| old built-in              | no                        | the row's identity; the const's aliases; no taxonomy; the const's `group`                                                                                                                               |
| catalog row               | yes                       | `catalogOptionOf(entry, publicId)` with the row's identity written over it; no `group`                                                                                                                  |
| catalog row (**a9**, new) | no                        | the row's identity; no aliases; `supervision: null`; `hasInstructions: false`; no taxonomy in (a), the tables' in (b); no `group`. Listed, never dropped (K22).                                         |

- **The read carries `taxonomy`.** In (a) it comes from the library entry; in (b) from the tables. The
  DAL copies every field, `group` included, and adds nothing. So `newItem` matches over exactly the
  aliases the picker shows (K23).
- **`picker.test.ts`'s mapping cases move** to `catalogArmOption`'s test: the row's type winning, the
  taxonomy attached, two spellings of an alias kept as one. `picker.test.ts` keeps "copies every field,
  keys pinned". A `db:verify` mutation drops the join.
- **(a2) restated per library.** With `CATALOG_MOVEMENTS`, the read equals main's DTO for the 35:
  main's `joinAliases(row, entry)` plus the entry's fields. Measured: 12 old built-ins have entries,
  bringing 6 aliases the const lacks. With the fixture library (from the K29 PR), the 35 carry the
  const's aliases only, and no taxonomy, because the fixture shares no slug with them. Risks note that
  CI's smoke then covers no old built-in with taxonomy.
- **(a6) gains two cases** (correctness P2-6, P2-8):
  - "Hex-bar deadlift", an alias only on the library entry of `trap-bar_deadlift` and a different slug,
    so step 2 cannot select it. `newItem` answers `existed: true` with the built-in's `publicId`, and
    no household row is made. The library passed is `CATALOG_MOVEMENTS`.
  - A household item named "Hex-bar deadlift": an exact name beats an alias on both sides (`bestFirst`).
- **(a9)** is proved in `db:verify` by planting a catalog row and passing a library without its slug.

### A1.3 Mechanics

- **Existing patches touched:** 304, 305, 306, 382, 397, 398, 496 and 498 patch `movement-options.ts` or
  `new-item.ts`. Each is re-cut and checked with `git apply --check`, and each changed one is run alone
  with `--only`.
- **Size:** after A1.1's split, P11-ii-a is the read, `catalogArmOption`, `newItem`'s argument, (a1)–(a9)
  and its patches: an estimated 500–600 lines, most of it proofs. If it comes out over that, the
  built-in alias move (A1.2's first two rows and the "Hex-bar" case) goes to a PR of its own, before
  A2-ii.

### Test plan

- **`db:verify`:** (a1)–(a9) and (b1)–(b4). Each new or re-cut patch is run locally with
  `pnpm --filter @mat-plan/db db:mutations --only <n>`, then all of them in CI's sharded gate.
- **vitest:** `catalogArmOption`'s cases, and `picker.test.ts` (keys, copying, (b5)). In the K29 PR:
  the env predicate's cases above, the DAL's accessor-mock cases, and the containment test.
- **e2e:** unchanged by P11-ii-a. The K29 PR's smoke runs with the fixture library on a fixtures database.

### Risks and rollback

- **A parse failure takes the picker and `newItem` down together** ((b4)). This is unreachable while the
  foreign keys and the CHECK hold. A code leaves the vocabulary only after A3 rewrites its rows.
- **A catalog row whose entry left the library** is listed bare ((a9)), never dropped.
- **The K29 refusal could fail a deploy.** That happens only with the fixture library named against
  production, which is the failure it exists to stop. Rollback: unset the variable.
- **A2-ii before P11-ii-a** would let `newItem` miss catalog rows by alias. The spec gates A2-ii on
  P11-ii-a deployed (Q3).
- **Rollback of any of these PRs** is a revert. No migration, no data written.

### For the spec owner

- **Q5. When K29 is built, and by what mechanism** (scope P1-1, P2-1).
  - (A) Recommended: K29 is its own PR (lane P), just before A2-ii or inside it, and **the library is
    worked out from the database** rather than read from a variable: the fixture library exactly when
    `isFixturesDatabase(DATABASE_URL)` and the deployment is not production. Every database that rule
    admits is seeded with fixtures: `embedded-pg.ts` forces it, as do `ci.yml` and
    `migrate-preview.yml`. That removes the variable, its wiring, the Vercel setting the maintainer
    would set by hand, and the gap before they set it. Production then refuses by construction. The
    cost: a local database seeded by hand without fixtures would read the fixture library, which is
    wrong annotations on a developer's own database.
  - (B) The same timing, with the variable as A1.1 specifies.
  - Either way, K29's "Lane P builds it in P11-ii-a" becomes "in its own PR, with A2-ii".

### Approval

**Approved by the maintainer** _(orchestrator's chat, 2026-11-19, relayed by the board)_, asked
"Record that you approve lane P's P11-ii plan (#666, the one you merged): the picker lists library
movements from the database, in two PRs (P11-ii-a before the library seed switch, P11-ii-b after the
equipment/muscle order answer)?": **"Approve (Recommended)"**. P11-ii-a can be built once A2-i is on
main; P11-ii-b waits for Q2.

## Not in this chunk

- Hiding any old built-in (K22: not until R2).
- A household item's taxonomy (rule 11; Beta 0 has none).
- Loading options when the picker opens (only if the measured payload says so).
- B3's tree, which reads these fields unchanged (`cat-3-b3-browse-by-kind.md` § "Compatibility with
  P11-ii").

## ID-1's six keep-open items

1. **The principal is a login:** not touched; no profile or login column.
2. **Every access goes through `getHouseholdScope()`:** still true, through `householdMovementRows`
   (`picker.ts`). The write path's `newItem` takes the scope as today.
3. **Nothing relies on one household per person:** nothing new depends on it; `cache()` is per
   request.
4. **Nothing pins an athlete to a household:** no `(household_id, profile)` key or cache key is
   added. This is movement data, not profile data.
5. **No age logic.** The read adds no muscle word and parses through `muscleSchema`, so the `MUSCLES`
   list kept stable for a later body map is untouched. The read is per movement and never joined to
   `entries`. A per-athlete muscle summary would be derived data that needs its own inventory row.
6. **Roles stay a const plus a CHECK:** not touched.

A household's own items keep travelling with their join rows when a household takes its history.
That rule is the `movementEquipment` docblock's, not an `ID-1` item.

## Review-response log

Panel on the first draft (2026-11-19): correctness, privacy and architecture, on Opus.

| #                | Lens                      | Finding                                                                                                                                                                    | Response                                                                                                                            |
| ---------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| B1               | architecture, correctness | `newItem` matches over the read, which gives a catalog row no aliases, so (g) could not pass and the server and picker could choose different rows ("Strict press", "OHP") | **accepted**: the read takes the library and attaches the const fields (Goal 2, a5, a6)                                             |
| B2               | architecture, correctness | Fixtures databases hold `CATALOG_FIXTURE`, but the DAL reads `CATALOG_MOVEMENTS`: wrong aliases, labels and "How to"; decision 1's premise is false there                  | **accepted** as Q1 for the spec owner; decision 1 is replaced by it                                                                 |
| P1-1             | privacy                   | The `or` read literally drops the global conjunct for the picker slugs; (d) planted nowhere that would show it                                                             | **accepted**: the predicate is written out; (a3) plants on all three kinds of slug, with mutations on the global and live conjuncts |
| P1-2, C4         | privacy, correctness      | (f) cannot go red: unlisted join rows are discarded in assembly                                                                                                            | **accepted**: (b2), a helper asserted on its raw rows, the assembly throws on an unlisted id, the plant is rolled back              |
| C3               | correctness               | (b)'s mutation targets the DAL, which `db:verify` never runs                                                                                                               | **accepted**: the mapping moves into the read (B1), so (b1) runs in `db:verify`                                                     |
| C5               | correctness               | Taxonomy must follow `movementIsCatalog()`, or old built-ins get `equipment: []`; cover zero catalog rows                                                                  | **accepted**: `isCatalog` column, (a2), (a7)                                                                                        |
| C6               | correctness               | K23 (Enter and `newItem` pick the same row) is not tested, and this is the first PR where a pair can exist                                                                 | **accepted**: (a6)                                                                                                                  |
| S1, C7           | architecture, correctness | Ordering by id cannot survive A3's by-difference write (architecture); id order is fine if a proof pins it (correctness)                                                   | **Q2** for the spec owner, recommending the vocabulary order; (b3) pins whichever is chosen                                         |
| S2               | architecture              | Split: the rows (unblocks A2-ii) and the taxonomy                                                                                                                          | **accepted**: P11-ii-a and P11-ii-b                                                                                                 |
| S3               | architecture, correctness | The gate on A2-ii is on neither spec row                                                                                                                                   | **accepted**: Q3                                                                                                                    |
| S4               | architecture              | An optional `taxonomy` invites a placeholder; reuse the shared type                                                                                                        | **accepted**: a required key, `Pick<CatalogOptionTaxonomy, …> \| null`                                                              |
| P2-1             | privacy                   | The ID-1 section cited a non-item                                                                                                                                          | **accepted**: the six items answered                                                                                                |
| P2-2             | privacy                   | The inventory and the schema docblock were missing from Files                                                                                                              | **accepted**                                                                                                                        |
| P2-3             | privacy                   | Keep `movements.id` off `MovementOption`                                                                                                                                   | **accepted**: (a8)                                                                                                                  |
| N1, C-decision 3 | architecture, correctness | Parsing in `packages/db` can take the picker down; say why that is acceptable                                                                                              | **accepted**: (b4)                                                                                                                  |
| N2               | architecture              | The stays-dark allowlist would grow each chunk; S6 ends at P11-ii                                                                                                          | **Q4**                                                                                                                              |
| N3, C8           | architecture, correctness | The payload was measured at the wrong size and asserted nothing                                                                                                            | **accepted**: (b5), on the real library and at 500, figures in the PR                                                               |
| —                | architecture              | Muscles "by role" relies on alphabetical order                                                                                                                             | **accepted**: separate selects (b3)                                                                                                 |
| —                | architecture              | Outside this plan: `dal/day/day.ts:60` has B2's gap                                                                                                                        | folded into Q1 (lane E owns that file)                                                                                              |

### Re-review of Amendment 1 (2026-11-19)

Four lenses on the amendment's first draft: security, correctness, reuse, scope (Opus 5.5 each; the
author on Opus 5.5). The post-merge review that prompted it was a fifth reviewer. **Panel cost:** the
original three lenses, one post-merge reviewer and four re-review lenses. No P0 from any of them.

| #                               | Lens                         | Finding                                                                                                           | Response                                                                               |
| ------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| PM-P1                           | post-merge                   | K29 was added after the panel and never reviewed                                                                  | **accepted**: this re-review; A1.1                                                     |
| PM-P2                           | post-merge                   | No reuse or scope lens; no cost or models line                                                                    | **accepted**: both lenses ran here; this header                                        |
| PM-P2                           | post-merge                   | Old built-ins' library aliases are not seen by `newItem`; `group` contradicts itself                              | **accepted**: A1.2                                                                     |
| PM-P2                           | post-merge                   | Q4 said "first PR in `apps/`"; no Test plan or Risks; no plan.md link; no K29 in the header                       | **accepted**, all four                                                                 |
| S-P1-1, C-P1-1                  | security, correctness        | The refusal tests can't fail: OPS-1 throws first                                                                  | **accepted**: A1.1's cases isolate the new rule, with messages asserted by equality    |
| S-P1-2, R-P1-3, Sc-P1-3, C-P1-2 | all four                     | Wiring beside `SEED_FIXTURES` never reaches the app; `migrate-preview.yml` runs no app; the harnesses are missing | **accepted**: the smoke step, the harnesses from a shared constant, a containment test |
| R-P1-1                          | reuse                        | `assertFixturesTargetAllowed` already holds the rule                                                              | **accepted**: `isFixturesDatabase` in `db-environment.ts`, used by both                |
| R-P1-2                          | reuse                        | The variable name and values were bare literals                                                                   | **accepted**: shared constants                                                         |
| Sc-P1-1                         | scope                        | P11-ii-a held two concerns at ~800 lines                                                                          | **accepted**: K29 gets its own PR (Q5)                                                 |
| Sc-P1-2, C-P2-2                 | scope, correctness           | Flipping CI before A2-ii annotates the legacy rows from the fixture                                               | **accepted**: the flip lands with A2-ii                                                |
| C-P1-3                          | correctness                  | A catalog row with no library entry has no shape                                                                  | **accepted**: (a9), listed bare                                                        |
| C-P1-4                          | correctness                  | Moving the join leaves `picker.test.ts` testing a mock                                                            | **accepted**: `catalogArmOption` and its tests                                         |
| S-P2-1, R-P2-1, C-P2-4          | security, reuse, correctness | zod is off under `SKIP_ENV_VALIDATION`; the `null` name; the `trim`                                               | **accepted**: equality at module scope; `null` refused                                 |
| S-P2-2, R-P2-2, C-P2-3          | security, reuse, correctness | Lists in `env.ts` reach the proxy bundle                                                                          | **accepted**: `env.ts` exports the name; one DAL module holds the lists                |
| R-P2-3                          | reuse                        | Three slug-to-entry maps                                                                                          | **accepted**: one memoised index; `picker.ts`' `LIBRARY` is deleted                    |
| S-P2-3                          | security                     | "Fails the build" is unproved                                                                                     | **accepted**: a stated build check                                                     |
| Sc-P2-1                         | scope                        | The library could be derived from the database, with no variable                                                  | **Q5** for the spec owner, recommended                                                 |
| Sc-P2-2                         | scope                        | Defer the built-in alias move                                                                                     | **partly**: kept, with an explicit split if P11-ii-a goes over                         |
| Sc-P2-3                         | scope                        | An env probe can't be a `db:mutations` patch                                                                      | **accepted**: a review probe, its result in the PR                                     |
| C-P2-1                          | correctness                  | "(a2) unchanged" is false for the 12 built-ins with entries                                                       | **accepted**: restated per library                                                     |
| C-P2-5                          | correctness                  | The "library passed" tests can't fail                                                                             | **accepted**: the accessor mocked to the fixture                                       |
| C-P2-6, C-P2-8                  | correctness                  | (a6) traps and a collision case                                                                                   | **accepted**: "Hex-bar deadlift" both ways                                             |
| C-P2-7                          | correctness                  | Eight existing patches will stop applying                                                                         | **accepted**: A1.3                                                                     |
| R-P2-4                          | reuse                        | Two ranges for the same proofs                                                                                    | **accepted**: the Files row points at Acceptance                                       |
| Sc-P2-4                         | scope                        | No changelog fragment                                                                                             | **accepted**                                                                           |
| —                               | correctness, outside         | A seventh K23 pair: Barbell Hip Thrust's "hip thrust" alias vs the library's "Hip thrust"                         | sent to the spec owner                                                                 |
