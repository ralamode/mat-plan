# TEN-2c — contract: drop the global `movements.slug` UNIQUE, and close the denial window

> Backlog: [plan.md](../plan.md) row `TEN-2c`. Branch: `db/ten-2c-drop-global-slug-unique`.
> Predecessors: [TEN-2a](./ten-2a-household-movements.md) (expand, dark) ·
> [TEN-2b](./ten-2b-scoped-movement-lookup.md) (writer, scoped + global-first).
> Addressing: [ADR 0006](../decisions/0006-household-addressing.md).

## Goal

`movements_slug_unique` is a **non-partial** `UNIQUE("slug")` over the whole table (migration
[`0001:90`](../../packages/db/migrations/0001_loose_barracuda.sql)). While it lives, **at most one row
per slug exists in the entire table**, so TEN-2a's two partial indexes are _declared_ and not _in
effect_: the narrower rule cannot widen what the broader one already forbids. Dropping it is what makes
the two namespaces real, and it is therefore where TEN-1 chunk 1d's catalog verdict stops reading
`LEAKS`.

### 🔴 Two windows, and this PR closes exactly one of them

An earlier draft of this plan was titled _"The leak closes here"_ and its goal said the verdict stops
reading `LEAKS`. **That is the mis-attribution the repo had already identified and assigned to this very
PR to retract**, and three panel lenses caught it independently:

- [`plan.md:1243-1245`](../plan.md): _"**The leak closes at TEN-2c**, when the constraint goes **and**
  the pre-existing app-authored rows leave the global namespace; **dropping the UNIQUE alone closes
  nothing** — it only *permits* two namespaces."_
- [`ten-2a-household-movements.md:18-23`](./ten-2a-household-movements.md): _"Dropping the global UNIQUE
  (2c) **closes nothing by itself** … `SECURITY.md`'s 'the leak closes when its third PR drops the
  global `slug` UNIQUE' is the mis-attribution **2c is already slated to retract**."_

So state the two separately, because they have different owners:

| Window                             | What it is                                                                                                                                | Closed by                                          |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| **(A) The 2b→2c denial primitive** | With global-first live and the non-partial UNIQUE still in place, A typing a name first makes B's write of that name fail `23505` forever | **This PR**, completely, by the drop alone         |
| **(B) The pre-existing read leak** | Any row at `household_id IS NULL` that is not seeded is resolved by step 1 for **every** household — TEN-1 1d's READ leak, byte for byte  | **`TEN-2c-1`** (the split backfill), _not_ this PR |

This PR also **stops (B) growing**: the `NOT VALID` CHECK enforces every new row from the instant it
applies, and 2b's writer already owns every row it creates. That is a real database-level control, and
the earlier draft undersold it while overselling the closure.

⚠️ **The urgency claim was also overstated.** The earlier draft called window (A) _"open right now"_.
It is a property of the schema, not a reachable exposure: `getHouseholdScope()` **throws** on a second
live household ([`queries/household-scope.ts:11-15`](../../packages/db/src/queries/household-scope.ts),
and [`SECURITY.md:42-43`](../../.github/SECURITY.md) says so), so a second household cannot be served
before `AUTH-1`. The real driver is the **beta-1 invite sequence**, several PRs out. The deferral in
§Out-of-scope therefore rests on the **measured-zero input**, not on a clock.

## Acceptance

Verbatim, from the `TEN-2c` row in [plan.md](../plan.md):

> **TEN-2c — contract: drop the global `movements.slug` UNIQUE. This is where the leak closes.** With
> the global UNIQUE gone a second household can hold its own row for a slug, so this PR carries the
> proofs: TEN-1 1d's `db:verify` catalog verdict flips from _"LEAKS"_ to _"isolated"_, both directions,
> and **mutation patch `04-slug-is-not-the-arbiter` is rewritten or retired** — its job is to prove the
> global slug _is_ the arbiter, which stops being true here.

Done when:

- `ALTER TABLE "movements" DROP CONSTRAINT "movements_slug_unique"` has applied, and `db:verify` proves
  **two households each hold their own row for one slug** — the state that is unreachable today — with
  **three** conjuncts: different ids, each row owned by the household that asked, **and both rows
  carrying the same `slug`**. Both directions.
- The verdict headline at `verify.ts:5513` names **what closed and what did not**: the denial primitive
  is gone, and the read leak's residual (any pre-2b custom row still at `household_id IS NULL`) closes
  at `TEN-2c-1`. ⚠️ **Not a bare "isolated"** — see §Goal; a bare headline would answer beta-1's
  go/no-go with a wish, and `plan.md:1243-1245` says the drop alone closes nothing.
- The two assertions the headline summarises are inverted: `:5295-5300` (READ) and `:5363`
  (WRITE/POISON). The positive direction still holds — both households resolve the **same global**
  `box_jump` (`:5345-5349`) — and a second call per household is idempotent, asserted on
  `movements_id_seq.last_value`.
- The three uniqueness facts at `:5640-5681` **survive** the block's rewrite, now proving the two
  partial indexes in their sole-arbiter role.
- Mutation patch `04` is **re-aimed** at a new same-household convergence assertion, `06` is added, and
  `pnpm db:mutations` reports **every** patch RED on its own assertion.
- `CHECK (household_id IS NOT NULL OR pattern IS NOT NULL)` is added **`NOT VALID`** as
  `movements_global_row_has_pattern`; the `VALIDATE` is **`TEN-2d`**.
- The seed's shadow guard is **demoted to a warning** and its premise rewritten, so `migrate.yml`
  cannot wedge on a state the drop makes benign.
- `movement-catalog.ts`'s `23505` `catch` is **still present** — it goes in `TEN-2d`.
- The **report-only correction has been run against production**, its aggregate counts are in the PR
  body, and they are zero. A non-zero count blocks this PR.
- `pnpm verify`, `db:verify`, `db:mutations` and `e2e:local` pass. Squawk reports `0 issues` — ⚠️ which
  is the gate's **silence**: it has no `ban-drop-constraint` rule, so the drop is review-enforced only.

## 🔴 Four findings that change the backlog row

Each was measured on this branch (`9ab6d7f`), not inferred. They are the reason this plan is not simply
the row restated.

### 1. Precondition (i) is NOT met — and neither grep the row offers can detect it

The row requires that `git grep -n "movements.slug" -- packages/db apps/web` show no non-partial
arbiter before the drop. One survives, and **that grep cannot find it**:
[`verify.ts:755-759`](../../packages/db/scripts/verify.ts) — the V1-1b backfill simulation — is raw
SQL (`INSERT INTO "movements" … ON CONFLICT ("slug") DO NOTHING`), so the string `movements.slug`
never appears.

⚠️ **My first replacement grep was also wrong.** It matched arbiters only, and the constraint is
manipulated by name in DDL the arbiter pattern cannot see. **The grep that works:**

```bash
git grep -n 'MOVEMENT_SLUG_UNIQUE_CONSTRAINT\|movements_slug_unique' -- packages apps   # the DDL + const sites
git grep -nE 'ON CONFLICT \("?slug|target: schema\.movements\.slug' -- packages apps     # the arbiters
```

Run **both**: the first finds the 13 constraint sites, the second finds unscoped arbiters and reads.

**The blast radius is narrower than the row claims, which matters because the row's stated reason is
a production wedge.** `migrate.yml` runs `db:seed` in the same job right after `db:migrate`
([`migrate.yml:62-78`](../../.github/workflows/migrate.yml)), so a surviving non-partial arbiter
there would wedge prod. That hazard is **already closed**: the production arbiter is
[`seed.ts:239`](../../packages/db/src/seed.ts) and it is **partial** (`where: movementIsGlobal()`,
rendering `WHERE "movements"."household_id" IS NULL`), so it still infers `uq_movements_slug_global`
after the drop. A whole-tree grep finds exactly two production inserts into `movements` —
`seed.ts:237` and `ownership.ts:201` — and both are partial. So `verify.ts:759` breaks **the build**,
not production.

#### 🔴 And the fix is not one line — measured, not reasoned

I applied the drop + CHECK as a throwaway `0017` and ran `db:verify`:

| Step                                    | Result                                                                                                                 |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| drop + CHECK applied, fixture untouched | **`42P10`** at `verify.ts:755` — the arbiter cannot be inferred                                                        |
| arbiter made partial, re-run            | **still dies at `verify.ts:754`** — the row is `household_id NULL` **and** `pattern NULL`, which the new CHECK forbids |

So there are **two** defects in the same statement, and the panel's correctness lens had the order
inverted (it predicted `23514` first): the arbiter is resolved at planning time, before any row is
inserted, so `42P10` precedes the CHECK. **Both must be fixed, and fixing only the arbiter just moves
the failure.**

**The fix is the precedent 20 lines above it**, not a new pattern: `verify.ts:734` drops
`entries_activity_type_id_not_null`, runs the backfill simulation, and re-adds it
`NOT VALID → VALIDATE` at `:775-779`, _"faithful to the DEPLOY ORDER — 0002's backfill runs BEFORE
0003 adds the CHECK"_. Same shape here: **drop the new CHECK → run the V1-1b sim (which genuinely
predates 0017) → re-add it `NOT VALID`.** Giving the fixture a `pattern` instead is wrong — it would
break the opposite assertion at `verify.ts:5774-5778`, which requires every app-authored row to have
`pattern IS NULL`.

### 2. Precondition (ii) is met — but the guard it names becomes a production wedge

The seed's shadow guard exists ([`seed.ts:200-241`](../../packages/db/src/seed.ts) +
[`:285-295`](../../packages/db/src/seed.ts)), detect → omit → seed → **throw last**, with a runbook at
[`runbooks.md:155-185`](../runbooks.md) and three proofs. So there is nothing to _build_.

🔴 **An earlier draft stopped there and concluded "nothing for 2c to build here". That was wrong, and
it is the most consequential thing the panel found.** The guard's entire premise is the constraint
this PR removes. [`seed.ts:202-208`](../../packages/db/src/seed.ts) states it:

> _"Postgres infers BOTH arbiters for `(slug)`: the non-partial `movements_slug_unique` has an empty
> predicate, trivially implied by `WHERE household_id IS NULL`. So if a household already owns a slug
> this seed is about to add globally, `DO NOTHING` absorbs the GLOBAL-unique collision too and the
> catalog row is NEVER INSERTED."_

**0017 deletes that premise.** With only `uq_movements_slug_global` left, a household-owned row is
outside the index's subset, so the global insert **does not collide** and the curated row lands. A
global row and a household row sharing one slug is the **intended end state** — global-first then
serves the curated row to everyone.

The guard's `throw` does not go away with its reason. After this PR it fires on a state that is no
longer dangerous, and [`migrate.yml:16-22`](../../.github/workflows/migrate.yml) spells out the
consequence: the refusal _"turns this job red on every subsequent push … It cannot clear itself by
re-running."_ **So shipping 2c without touching the guard converts a confidentiality control into a
permanent availability defect**, whose documented recovery is machinery this plan defers.

**→ 2c demotes the guard from `throw` to a warning**, re-points `verify.ts`'s baseline absorption
proof (`:6040-6056`, which stops being true), and rewrites `runbooks.md:155-185`. `seed.ts` is owned
by [`write-path.md`](../features/write-path.md), so it is in scope either way.

### 3. 🔴 The row's one **Open** question is closed by evidence — the database cannot produce the case

The row says: _"`profiles.household_id` is nullable, so 'the household with the earliest referencing
row' can resolve to NULL through `entries → profiles`. 2c owes an answer for that row. **Open.**"_

It is nullable **in Drizzle's type only**
([`schema.ts:157`](../../packages/db/src/schema.ts) has no `.notNull()`). The database enforces
otherwise, and has since the first migration
([`0001:158-159`](../../packages/db/migrations/0001_loose_barracuda.sql)):

```sql
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_household_id_not_null" CHECK ("household_id" IS NOT NULL) NOT VALID;
ALTER TABLE "profiles" VALIDATE CONSTRAINT "profiles_household_id_not_null";
```

`VALIDATE`d, and **no later migration drops it** (`git grep profiles_household_id_not_null -- packages/db/migrations`
returns only those two lines). `verify.ts:4002` already notes the CHECK rejecting such an insert. So an
orphan profile is **unreachable**, and the `entries → profiles` leg cannot yield a NULL household.

The other leg cannot either: `prescriptions.blockId` and `prescriptions.movementId` are both
`.notNull()` ([`schema.ts:742-749`](../../packages/db/src/schema.ts)) and
`program_blocks.householdId` is `.notNull()` ([`schema.ts:758-760`](../../packages/db/src/schema.ts)).

**→ The answer 2c owes is "refuse and report", and the reason is that the branch is provably dead.**
TypeScript still types the value `number | null`, so the code must handle it; it refuses with a named
error and the reporter counts it, rather than guessing an owner. `db:verify` asserts
`profiles_household_id_not_null` is `convalidated = true`, which is what makes the refusal unreachable
rather than merely unlikely — the same shape as 2a's `convalidated = false` assertion, which is how
"don't forget the VALIDATE" became a red build instead of a reminder.

**Not 2c's to fix:** the Drizzle-vs-database mismatch is a real defect (TypeScript forces every caller
to handle an impossible NULL), but correcting it means `.notNull()` on the column, which
`drizzle-kit generate` turns into `ALTER COLUMN … SET NOT NULL` — a migration, and therefore a
different PR. **Filed as its own row** (§Out-of-scope).

### 4. The deploy race has two directions, and only one is harmless

[`migrate.yml`](../../.github/workflows/migrate.yml) has **no gate coupling a migration to the Vercel
deploy**, and seeds in the same job. The ordering is a human merge-order convention — the same class
as AGENTS.md's unwired Neon-branch apply — so this plan does not cite it as a control.

- **Direction A (the row's concern): the migration lands before 2b's app.** Already satisfied in fact
  — 2b is merged, deployed, and its migration applied, verified by content on `main`.
- 🔴 **Direction B (unargued in the first draft): 2c's app lands before 2c's migration.** This PR was
  going to delete the `23505` fallback `catch` in the same commit as the drop. If Vercel wins the
  race, the catch-less resolver meets a schema that **still has** the constraint, so step 3 raises a
  raw `23505` out of a child's session write — precisely the permanent-write-failure outcome TEN-2a
  weighed and rejected, now with nothing catching it.

**→ The `catch` deletion moves to `TEN-2d`**, after 0017 has demonstrably applied. AGENTS.md's rule is
that a destructive contract runs _after_ the app that stopped depending on it; deleting the code that
depends on the constraint in the same breath as the constraint inverts it. The blast radius today is
near zero (one live household, so step 2 always returns the household's own row), but the _shape_ is
the one the rule exists to prevent.

## File-by-file changes

| Path                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Change       | What & why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/db/migrations/0017_ten2c_drop_global_slug_unique.sql`                                                                                                                                                                                                                                                                                                                                                                                                     | **NEW**      | The two statements below. Header carries **mechanics only** (locks, re-run safety, the Squawk-silence note) per `0015:20`'s precedent — reasoning and production numbers point at this plan, because migrations are forward-only and permanent.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `packages/db/migrations/meta/0017_snapshot.json` + `_journal.json`                                                                                                                                                                                                                                                                                                                                                                                                  | **NEW/EDIT** | Generated, then **hand-edited** for `NOT VALID` (drizzle's `check()` emits a validated constraint; it has no `NOT VALID`). Same hand-edit class as 0015's FK — `verify.ts:5585` records that **nothing but the `convalidated` assertion catches it being lost on a rebase**.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `packages/db/src/schema.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                         | EDIT         | Drop `.unique()` from `movements.slug`; add the CHECK to the table extras; **delete `MOVEMENT_SLUG_UNIQUE_CONSTRAINT` and its docblock** — `schema.ts:457-458` already says _"TEN-2c DELETES it, and this const with it."_ Also rewrite the `:502-508` docblock, whose "window closes at TEN-2c" is now past tense.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `packages/db/src/seed.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                           | EDIT         | **Demote the shadow guard's `throw` to a warning** and rewrite its `:202-208` premise (Finding 2).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `packages/db/src/writers/movement-catalog.ts`                                                                                                                                                                                                                                                                                                                                                                                                                       | EDIT         | **Keep the `23505` `catch`** (Finding 4; it goes in `TEN-2d`). Update its docblock: the window it describes is closing, and the helper is `isGlobalSlugCollision` (`:132`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `packages/db/src/queries/movement-ownership.ts`                                                                                                                                                                                                                                                                                                                                                                                                                     | **NEW**      | One home for the movement-ownership predicates, extracted at their second consumer: `crossHouseholdMovementRefs()` (`entries` **and** `prescriptions`, **both** directions — the runbook's version already covers more than `verify.ts`'s), `sharedMovementRows()`, and the single definition of **"referenced"** that `plan.md:1408-1412` requires be shared with `TEN-2b-2`. `verify.ts:5971` converts to a caller in this PR.                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `packages/db/scripts/verify.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                     | EDIT         | **Three blocks, 13 constraint sites** — the first draft listed one. Block `:5543`: keep the rolled-back transaction and all three uniqueness facts (`:5640-5681`), delete only the `DROP CONSTRAINT` at `:5637` and the `:5693` restore; `movementRowValues` gains a `pattern` or the probes hit `23514`. Block `:5813`: the global-first proof **loses its rolled-back-DROP scaffolding entirely** — the two orders are now distinguishable in the live schema, which is the win; retire-or-invert the fallback/price assertions at `:5948` and `:5978`. Block `:6019`: the shadow-guard DDL dance collapses to a straight-line proof, and its baseline absorption claim is re-pointed. Plus: `:755-759` per Finding 1, the READ (`:5295-5300`) and WRITE/POISON (`:5363`) inversions, the `:5513` verdict headline, the `:5801` and `:5319` message strings, and `convalidated`/absence assertions. |
| `packages/db/scripts/mutations/04-slug-is-not-the-arbiter.expect`                                                                                                                                                                                                                                                                                                                                                                                                   | EDIT         | **04 is kept and re-aimed, not retired.** Its hunk context is untouched by this PR, so only the `.expect` changes — pointed at a **new same-household convergence assertion** (two spellings are one movement _within_ a household), which is the normalisation property no assertion currently proves and the one the verdict rests on.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `packages/db/scripts/mutations/06-two-households-share-a-slug.patch` + `.expect`                                                                                                                                                                                                                                                                                                                                                                                    | **NEW**      | `06`, not `07` (nothing reserves `06`). The one-line break: drop `movementIsGlobal()` from step 1, so B's unscoped lookup returns A's row and the **inverted READ assertion fails first**. The draft's version (revert the insert to global) would have thrown a plain `Error` from the re-read and reported _"RED on the WRONG assertion"_. First mutation coverage of the `movements` seam.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `packages/db/scripts/corrections/registry.ts` + `correct.ts` + `README.md`                                                                                                                                                                                                                                                                                                                                                                                          | EDIT         | Report-only entry `movements-ownership-2026-10-11`, with **`kind: 'report'`** on the `Correction` type so `correct.ts` branches its strings — today `:72` prints _"already corrected, or the guard did not match"_ on zero findings, which for a reporter is the **good** outcome reported as the wrong thing. **Aggregate counts only — no `slug`, no `name`, no `public_id`**; `registry.ts:526`'s `(${t.name})` is the precedent _not_ to follow, because `movements.name` is household free text. Rules 2/4/5/7 are vacuous for a reader; say so. The census is deliberately **unscoped** (a cross-tenant count cannot ride a `HouseholdScope`) — stated in the code, or the next reader scopes it and blinds it.                                                                                                                                                                                 |
| **Pointer sweep** — `docs/architecture.md:144,:257` · `docs/milestones/beta-1.md:192-204` (+ the progress chart) · `packages/db/src/writers/ownership.ts:88-93` · `apps/web/lib/dal/catalog.ts:101-105` · `apps/web/lib/dal/scoped.test.ts:139` · `docs/features/write-path.md` · `docs/features/strength-logging.md:358` · `docs/features/programming.md:182` · `docs/tech-debt.md:39` · `packages/shared/src/catalog-movements.ts` · `mutations/README.md:96-102` | EDIT         | Each carries a **present-tense** "until TEN-2c" claim the drop falsifies. `plan.md:1419-1421` warned this PR by name: _"Budget for the sweep."_ Where a sentence is pure status it becomes a **status-free pointer**, so `TEN-2d` does not inherit the same sweep.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `.github/SECURITY.md`                                                                                                                                                                                                                                                                                                                                                                                                                                               | EDIT         | Retire **only** the 2b→2c denial-window paragraph (`:34-39`). ⚠️ **`:32-33` stays** — it reads _"no second household … before `TEN-1`, **`AUTH-1`** and `TEN-2` have all landed"_, and neither AUTH-1 nor all of TEN-2 has. Update `:28-30`'s leak bullet to the **residual**, not to "closed".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `docs/decisions/0006-household-addressing.md`                                                                                                                                                                                                                                                                                                                                                                                                                       | EDIT         | One **dated superseding line** at `:495` (_"movements has no household_id column at all"_, false since 0015) — not a paragraph rewrite. `plans/README.md` keeps decision records as-merged.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `docs/privacy/data-inventory.md` · `docs/runbooks.md`                                                                                                                                                                                                                                                                                                                                                                                                               | EDIT         | §4/§9's `TEN-2c` owner **re-points** to `TEN-2c-1` (the clone residual) and `TEN-2b-2` (the orphan) rather than reading closed — `:167` commits in the repo that _"dropping it alone closes nothing"_. `runbooks.md`: the shadow-guard heading (`:155-185`) and pre-flight (d) (`:866-889`), whose _cause_ changes now the fallback can no longer mint new cross-household references.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `docs/plan.md` · `docs/roadmap.md` · `docs/status.md` · `docs/changelog/<date>-db-ten-2c-…md`                                                                                                                                                                                                                                                                                                                                                                       | EDIT/NEW     | Row, pointer, fragment — **and file four new rows**: `TEN-2d` (the `VALIDATE` + the `catch` deletion), `TEN-2c-1` (the split backfill), the `profiles.household_id` Drizzle/DB mismatch, and the AUTH-1 note below.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `docs/plan.md` → AUTH-1 row                                                                                                                                                                                                                                                                                                                                                                                                                                         | EDIT         | AUTH-1's merged plan prescribes a Sentry message reading _"the catalog leak's precondition is met and TEN-2b has not landed"_ — wrong after 2c. Recorded on the backlog row, since the plan is kept as-merged. Its Q5 also gates the second household on **TEN-2b** while `beta-1.md`/`SECURITY.md` gate it on **TEN-2c**; 2c is the natural PR to settle that.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

### The migration's shape

```sql
SET lock_timeout = '5s';--> statement-breakpoint
SET statement_timeout = '60s';--> statement-breakpoint
ALTER TABLE "movements" DROP CONSTRAINT "movements_slug_unique";--> statement-breakpoint
ALTER TABLE "movements" ADD CONSTRAINT "movements_global_row_has_pattern"
  CHECK ("household_id" IS NOT NULL OR "pattern" IS NOT NULL) NOT VALID;
```

**The name changed, and the reason is the point.** An earlier draft called it
`movements_owned_or_seeded`, which **names an intent the predicate does not test** — a global row with
a hand-typed `pattern` satisfies it while being neither owned nor seeded. The repo's idiom is
predicate-descriptive (`movements_pattern_check`, `profiles_household_id_not_null`), and a name
stating the intent is how a later reader concludes the database enforces seededness and deletes the
`db:verify` membership proof as redundant. The intent, and the gap, live in the header.

**The two-layer design stands** (CHECK in the database + exact set-membership in `db:verify`), and the
CHECK is a real control rather than decoration: it blocks the realistic path into the forbidden state —
an operator hand-running `UPDATE movements SET household_id = NULL` to unwedge a blocked household
delete (`ten-2a:257-264`) — because `findOrCreateMovement` can never write a `pattern`. Layer 2 exists
because `db:verify` never runs against production. **Why not an exact `public_id` list in the CHECK:**
the seed has grown three times, so a literal list would need a migration per seed extension.

Two corrections to the first draft's mechanics, both because a wrong mechanic in a forward-only header
is permanent:

- ⚠️ **"Order within the file is load-bearing" was false.** It claimed `findOrCreateMovement` writes
  `household_id NULL`; since 2b it goes through `insertMovementOwnedBy`
  ([`ownership.ts:195-208`](../../packages/db/src/writers/ownership.ts)) and **cannot**. And a
  `NOT VALID` CHECK scans nothing while the app writes only after `COMMIT`, so nothing couples the two
  statements. The order is for readability.
- ⚠️ **`IF EXISTS` is dropped from the `DROP`.** Squawk does not require it, nothing asserts the
  constraint is gone, and the guard would mask a real problem. `db:verify` asserts **absence** from
  `pg_constraint` instead — which is also where the literal `'movements_slug_unique'` survives, once.

### Mutation patches — 04 re-aimed, 06 added

`04-slug-is-not-the-arbiter` replaces `movementSlug(name)` with `name`, and its `.expect` is verbatim
the READ assertion's message. **Retiring it would lose the slug-normalisation proof this plan calls
load-bearing** — and no assertion currently proves normalisation _within_ one household (`:5293`/`:5294`
and `:5362`/`:5364` each use two different scopes). So: add a same-household convergence assertion,
keep 04, re-point its `.expect`. Its hunk context survives this PR untouched.

`06` then covers the cross-household invariant, with the one-line break that reddens the inverted READ
assertion **first**. The gate ends 2c with **two** patches on the resolver instead of one, which is
what a contract step should leave behind.

## Test plan

| Proof                         | Asserts                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Two households, one slug      | Different ids, **each row's `household_id` is the asking household**, **and both rows carry the same `slug`** — three conjuncts. Without the slug conjunct the assertion passes under patch 04's mutation and does not assert its own acceptance criterion. Both directions.                                                                                                            |
| Global still shared           | Both households resolve the same global `box_jump` (`:5345-5349`).                                                                                                                                                                                                                                                                                                                      |
| Per-household idempotence     | Same id, nothing inserted — asserted on `movements_id_seq.last_value`, because an absorbed `ON CONFLICT` burns an identity value and a row count cannot tell the two apart.                                                                                                                                                                                                             |
| The two partial indexes bind  | The three facts at `:5640-5681` **kept**, now in their sole-arbiter role. Probe (c) — a global row and a household row sharing a slug — is `:5662-5665`'s _"ONLY assertion that distinguishes the new indexes from the constraint they replace"_.                                                                                                                                       |
| The constraint is gone        | Absent from `pg_constraint` by name.                                                                                                                                                                                                                                                                                                                                                    |
| The CHECK exists, unvalidated | `convalidated = false` — the only guard on the `NOT VALID` hand-edit surviving a rebase. ⚠️ **It does not force `TEN-2d`**: it stays green while nobody validates and reddens only for whoever does. The mechanical control on the end state is **2d's `VALIDATE`**, which raises `23514` on any residual and reddens `migrate.yml` until fixed — so **2d must precede any invite**.    |
| The dead branch is dead       | `profiles_household_id_not_null` is `convalidated = true`, queried from `pg_constraint` **by name with exactly one row**, so a later drop reddens rather than silently returning zero.                                                                                                                                                                                                  |
| End-state membership          | Scoped to **resolver-touched rows** (`TEN2B_RESOLVER_IDS`), as a fourth direction inside the existing `:5712-5784` block. ⚠️ The table-wide inversion is **false** here — `verify.ts:5729-5737` warns _"asserting it would have been a self-inflicted red build"_ because V1-1b's fixture mints non-seed unowned rows. The table-wide invariant lands with **`TEN-2c-1`**, not this PR. |
| Mutation gate                 | `pnpm db:mutations`: every patch RED **on its own assertion**, 04 re-aimed, 06 first-to-fail.                                                                                                                                                                                                                                                                                           |
| Smoke                         | `pnpm e2e:local`.                                                                                                                                                                                                                                                                                                                                                                       |

**What `db:verify` does not prove.** PGlite starts empty, is single-connection, and models no
concurrency — so the lock argument is review-enforced only. Three more, which the first draft missed:
it does not prove the deployed bundle survives the post-drop schema **in either race direction**; it
does not prove the CHECK is **validatable against production rows** (that is the reporter's job); and
it does not prove the ACCESS EXCLUSIVE lock's cost on a hot table. Stated positively: PGlite is real
Postgres in WASM, so `convalidated`, partial-index arbiter inference and CHECK evaluation order are
all faithful — **for once PGlite is not the weak link**; the gap is concurrency and production data.

## Risks / rollback

| Risk                                           | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A surviving arbiter or DDL site breaks on drop | Finding 1's **two** greps in the PR description; the 13 sites enumerated in the file table; probe-measured rather than reasoned.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **The shadow guard wedges production**         | Demoted to a warning in this PR (Finding 2). This was the panel's most consequential catch.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Direction-B deploy race**                    | The `catch` stays until `TEN-2d` (Finding 4).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| A pre-existing row violates the new CHECK      | `NOT VALID` does not scan, so **2c cannot fail on it** — it would wedge **2d's `VALIDATE`**. The reporter discovers it first.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Locks**                                      | `DROP CONSTRAINT` takes **ACCESS EXCLUSIVE**, which blocks **reads** — and `movements` is read on the logging path (`program-day.ts:102`, `export-month.ts:65`). The work is O(1) (a catalog delete plus an index unlink, 35 rows), so `statement_timeout` is slack and `lock_timeout = 5s` is the real bound. ⚠️ **`lock_timeout` bounds how long this statement waits; nothing bounds the queue piling up behind it** — on a PgBouncer-fronted pool that is the realistic outage shape, not the lock. `SET` (not `SET LOCAL`) leaks onto later files in the same run; benign here because 0017 will be the only pending file, and that is a property of the run, not the file.   |
| **Squawk is silent, not approving**            | Measured with the repo's pinned `squawk-cli@2.66.0` + `.squawk.toml`: the file passes **`0 issues`**; stripping the two `SET`s fires both timeout rules **on the `DROP` line**; a same-file `VALIDATE` fires `constraint-missing-not-valid`. But Squawk's destructive family has **no `ban-drop-constraint` rule**, so the most dangerous statement in this arc passes because the gate does not look at it. **Review-enforced only** — the same honesty Finding 4 applies to the deploy coupling.                                                                                                                                                                                 |
| The verdict flip is aspirational               | Three conjuncts, both directions, and patch 06 proves the new assertion can fail.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Rollback                                       | **The only rollback is `ADD CONSTRAINT movements_slug_unique UNIQUE ("slug")`, and it works only until the first duplicate slug appears.** After that the PR is irreversible by any mechanism, restore branch included — the duplicate rows and the `entries` referencing them are real data by then. That window _is_ the risk statement. A Neon restore branch is a **separate database**: it does not un-apply 0017 on the branch production writes to, and restoring loses every session logged since the restore point, which on a daily logger is the more expensive outcome. Cut one anyway per AGENTS.md, but do not call it the rollback. (`OPS-3`'s drill is undrilled.) |

## Out-of-scope / deferred — each filed as a row, not a promise

The first draft said the backfill was "gated on the reporter". **There was no `TEN-2d` row and no
`TEN-2c-1` row** — only prose inside the 2c row, so the gate pointed at nothing. This PR files them.

- **`TEN-2c-1` — the split backfill.** The row assigns it to 2c; this plan moves it out, and the
  reason is **not** urgency (see §Goal — there is no clock). It is that the input is **measured
  zero**: `ten-2a:283` records zero `movements` rows outside `MOVEMENT_SEED_ROWS` in production, so
  the clone/split is code for a population that does not exist. Its clone rules (original to the
  household with the earliest referencing row by `min(created_at)`, ties by household `public_id`
  **never** a raw internal id — `corrections/README.md` rule 3; a fresh `newId()` per clone; repoint
  through `inHousehold(scope)`) are a correction's worth of work. **Until it runs, window (B) stays
  open for any pre-2b custom row** — said plainly in `write-path.md` and the verdict headline rather
  than implied.
  _Rejected alternative: do it unconditionally in 2c. It roughly doubles a PR that is already at ~15
  files, on a code path whose input is zero._
- **`TEN-2d` — `VALIDATE CONSTRAINT` + delete the `23505` catch.** Squawk requires the split
  (**measured**, not conventional), which is why TEN-2 is **four PRs**. 2d is also where the catch
  goes (Finding 4) and the arc's only mechanical production-side gate. **Precondition on its
  acceptance:** the reporter has run against production and returned zero, or `TEN-2c-1` landed first.
- **`profiles.household_id`'s Drizzle/database mismatch** → its own row. `.notNull()` generates
  `ALTER COLUMN … SET NOT NULL`, i.e. a migration.
- **`TEN-2b-1`** (find-or-create inside the session transaction; owes a `SAVEPOINT`) and
  **`TEN-2b-2`** (the orphan-row correction) already exist and stay separate.

## Open questions

**None.** Both of the first draft's were hedges, and `plans/README.md` requires this section be empty
before implementation:

1. _Does the reporter ship in 2c?_ **Yes, and it gates this merge.** The scope lens argued for 2d
   (both its consumers are later), but the isolation claim rests on a zero measured on **2026-10-09**,
   and `ten-2a:358-359` already wrote the expiry: _"the count is re-measured immediately before the
   invite, because 'zero' is a dated fact, not an invariant."_ A measurement taken after the verdict
   flips is not evidence for it. Counts go in the PR body; non-zero blocks **this** PR.
2. _Does `MOVEMENT_SLUG_UNIQUE_CONSTRAINT` survive?_ **No.** `schema.ts:457-458` already committed to
   deleting it, no consumer survives this PR, and no contract test pins its value — the pin was
   `expectRejectedBy`. The literal lives on in the migration and in the absence assertion, once each.

## Review-response log (adversarial panel)

Six lenses, run in parallel on the first draft: correctness · db-safety · scope · architecture ·
security · reuse. **17 blocking + ~30 substantive findings.** Every verdict below was checked against
the code before being accepted — three were settled by running something rather than reading it.

### Round 1 — blocking

| #   | Lens                            | Critique (short)                                                                                                                                                                                                                                                                              | Verdict                                         | Resolution                                                                                                                                                                                                                                                                                                                        |
| --- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | security · arch · scope         | **"The leak closes here" is the mis-attribution this PR exists to retract.** `plan.md:1243-1245` and `ten-2a:18-23` both say dropping the UNIQUE closes nothing by itself.                                                                                                                    | **accepted** 🔴                                 | Retitled; §Goal rewritten with the **two-window table** (A denial primitive → closed here; B read leak → `TEN-2c-1`). The draft asserted B's closure while deferring the step that delivers it. **My error, and the second of this shape this session.**                                                                          |
| B2  | all six                         | **`verify.ts` is under-counted.** 13–14 `SLUG_CONSTRAINT` sites across **three** blocks (`:5543`, `:5813`, `:6019`); the table listed one. Two run module-level `DROP CONSTRAINT` (`42704`), two run `ADD CONSTRAINT … UNIQUE("slug")` — **re-creating what 0017 drops**.                     | **accepted**                                    | All three blocks enter the file table with a decision each. The `:5813` and `:6019` blocks get **simpler**: their rolled-back-DROP scaffolding exists only because the constraint was live. §Finding 2's "Nothing for 2c to build here" is **deleted**.                                                                           |
| B3  | 5 lenses                        | **Item (f) is the assertion TEN-2b wrote a warning against.** `verify.ts:5729-5737`: _"the obvious inversion … would have been a self-inflicted red build"_, because V1-1b's fixture mints non-seed unowned rows.                                                                             | **accepted**                                    | (f) is scoped to **resolver-touched rows** (`TEN2B_RESOLVER_IDS`, the shape 2b used) and expressed as a fourth direction inside the existing block. §Acceptance now says the table-wide invariant lands with `TEN-2c-1`.                                                                                                          |
| B4  | db-safety                       | **Deleting the `23505` catch in this PR breaks expand-before-use in the other direction.** If Vercel wins the race, the catch-less resolver meets a schema that still has the constraint → raw `23505` out of a session write.                                                                | **accepted** 🔴                                 | **The `catch` deletion moves to `TEN-2d`**, after 0017 has demonstrably applied. AGENTS.md: destructive contract runs _after_ the app that stopped depending on it. The draft argued only the harmless direction of the same race.                                                                                                |
| B5  | db-safety · security            | **The seed's shadow guard loses its premise and becomes a permanent `migrate.yml` wedge.** With only the partial index left, a global row and a household row may coexist — the intended end state — but `seed.ts:288` still `throw`s, and `migrate.yml:16-22` says that cannot clear itself. | **accepted** 🔴                                 | 2c **demotes the guard to a warning** and re-points `verify.ts`'s baseline proof and `runbooks.md:155-185`. This PR would otherwise convert a confidentiality guard into an availability defect. The best catch of the panel.                                                                                                     |
| B6  | correctness · db-safety · reuse | **The new CHECK breaks `verify.ts:755` with `23514`, so "the fix is one line" is wrong.**                                                                                                                                                                                                     | **accepted, with a correction to the critique** | **Measured by probe**, not reasoned: the first death is **`42P10`**, and `23514` is the _second_ defect at the same statement — the arbiter is resolved before any row is inserted. Both are real; the lens had the order inverted. Fix is the **drop → sim → re-add `NOT VALID`** shape `verify.ts:734`/`:775-779` already uses. |
| B7  | scope                           | **"Gated on the reporter" points at a row that does not exist** — no `TEN-2d` row in `plan.md`/`roadmap.md`, only prose inside the 2c row.                                                                                                                                                    | **accepted**                                    | This PR files **`TEN-2d`** and **`TEN-2c-1`** as real rows with stated preconditions. Unwired-gate rule, applied to my own plan.                                                                                                                                                                                                  |
| B8  | scope                           | **The `convalidated = false` assertion does not force 2d** — it stays green while nobody validates, and reddens only for whoever does.                                                                                                                                                        | **accepted**                                    | Claim corrected. The real mechanical control on the end state is **2d's `VALIDATE`**, which raises `23514` on any residual; said so explicitly, and 2d must precede any invite.                                                                                                                                                   |
| B9  | security                        | **The zero is a dated fact.** `ten-2a:358-359` requires re-measurement _"immediately before the invite, because 'zero' is a dated fact, not an invariant."_                                                                                                                                   | **accepted**                                    | The reporter runs against production **before this PR merges**, counts in the PR body, non-zero is a **merge blocker on 2c** rather than on 2d.                                                                                                                                                                                   |
| B10 | correctness · arch              | **Deleting `:5620-5690` deletes the only proof the two partial indexes bind** — at the PR where they become the sole arbiters. `verify.ts:5662-5665` says probe (c) is the only thing distinguishing them from the constraint they replace.                                                   | **accepted**                                    | Keep the transaction and the three facts; delete only the `DROP CONSTRAINT` at `:5637` and the `:5693` restore. Global probes gain a `pattern` (else `23514`).                                                                                                                                                                    |
| B11 | correctness                     | **Patch `07` as described cannot report its own `.expect`** — a global insert makes the re-read throw a plain `Error`, so the gate prints "RED on the WRONG assertion".                                                                                                                       | **accepted**                                    | 07 becomes the **one-line** break the lens derived: drop `movementIsGlobal()` from step 1, so B's unscoped lookup returns A's row and the inverted READ assertion fails first.                                                                                                                                                    |
| B12 | correctness                     | **Retiring 04 loses the slug-normalisation proof** the plan itself calls load-bearing, and no assertion proves normalisation _within_ one household.                                                                                                                                          | **accepted**                                    | Add a same-household convergence assertion, **keep 04**, and re-point its `.expect` at it. Its hunk context is untouched by this PR, so only the `.expect` changes.                                                                                                                                                               |
| B13 | security · scope · arch         | **Retiring `SECURITY.md:32-33` removes a control `AUTH-1` still owns** — it reads "before `TEN-1`, `AUTH-1` **and** `TEN-2` have all landed".                                                                                                                                                 | **accepted**                                    | Narrowed: retire only the **2b→2c denial-window** paragraph (`:34-39`). The three-row sequencing rule stands until AUTH-1 and all of TEN-2 land.                                                                                                                                                                                  |

### Round 1 — substantive, accepted

| #   | Lens                     | Critique                                                                                                                                                                                                                                                                                                 | Resolution                                                                                                                                                                                        |
| --- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | db-safety                | **Squawk has no `ban-drop-constraint` rule**, so "Squawk clean" is the gate's _silence_. Measured: the file passes `0 issues`; stripping the `SET`s fires both timeout rules; a same-file `VALIDATE` fires `constraint-missing-not-valid`.                                                               | Stated in §Acceptance and the header: the drop is **review-enforced only**. And the four-PR split is now **measured as Squawk-required**, not conventional.                                       |
| S2  | db-safety                | The plan carries **no lock argument at all**, and the header is where it would debut — unreviewed.                                                                                                                                                                                                       | §Risks gains the lock row: ACCESS EXCLUSIVE blocks **reads** on a table the logging path reads; the work is O(1); `lock_timeout` is the real bound; **nothing bounds the queue behind the wait**. |
| S3  | db-safety                | _"Order within the file is load-bearing"_ is **false since 2b** — `insertMovementOwnedBy` cannot write a NULL household — and a wrong mechanic in a forward-only header is permanent.                                                                                                                    | Deleted. Replaced with the true reason for the order (readability).                                                                                                                               |
| S4  | db-safety                | **"Cut a restore branch" is not a rollback** — it is a separate database and loses every write since the restore point.                                                                                                                                                                                  | §Risks states the real rollback: re-add the constraint, possible **only until the first duplicate slug**. After that, irreversible by any mechanism.                                              |
| S5  | arch                     | `movements_owned_or_seeded` **names an invariant its predicate does not test** — a global row with a hand-typed `pattern` satisfies it.                                                                                                                                                                  | Renamed `movements_global_row_has_pattern`, with the intent and the gap in the header. The repo's idiom is predicate-descriptive.                                                                 |
| S6  | reuse                    | The reporter's cross-household counts **already exist twice** (`verify.ts:5971-5976`, `runbooks.md:853-866`), and the runbook version covers both directions **and** `prescriptions`.                                                                                                                    | Extract to `packages/db/src/queries/movement-ownership.ts`; `verify.ts` converts to a caller in the same PR. One definition of _referenced_, as `plan.md:1408-1412` already requires.             |
| S7  | arch · reuse             | A report-only `Correction` makes **`correct.ts` lie** — `:72` prints "already corrected" on zero findings, which is a reporter's _good_ outcome.                                                                                                                                                         | Add `kind: 'report'` to the type and branch the runner's strings on it. Rules 2/4/5/7 are vacuous, not just rule 7.                                                                               |
| S8  | security                 | The reporter must emit **aggregate counts only**, and the registry's precedent (`registry.ts:526` prints `(${t.name})`) is exactly what not to copy — `movements.name` is household free text.                                                                                                           | Named in the plan as the precedent to avoid; counts only, no `slug`/`name`/`public_id`.                                                                                                           |
| S9  | arch · reuse · db-safety | **Open question 2 is answerable now**: `schema.ts:457-458` already says _"TEN-2c DELETES it, and this const with it."_ Zero consumers survive.                                                                                                                                                           | Closed. The const and its docblock go; the literal survives **once**, in the migration, and `db:verify` asserts the constraint is **absent** from `pg_constraint`.                                |
| S10 | arch · reuse · scope     | **Ten-plus files carry present-tense "until TEN-2c" claims** — `architecture.md:144,:257` (the diagram home), `beta-1.md:192-204` (the milestone + chart), `ownership.ts:88-93`, `catalog.ts:101-105`, `scoped.test.ts:139`, `seed.ts:204`, `schema.ts:502-508`, both feature guides, `tech-debt.md:39`. | All added. `plan.md:1419-1421` warned this PR specifically: _"Budget for the sweep."_ Where a sentence is pure status it becomes a status-free pointer, so 2d does not inherit it.                |
| S11 | scope · reuse            | The **migration header** should carry mechanics, not reasoning — `0015:20`, `0015:33-37` (_"NO PRODUCTION NUMBERS IN THIS FILE"_), `0015:57-60`.                                                                                                                                                         | Header carries locks, re-run safety and the Squawk-silence note; deploy-order and `db:verify`'s limits are one line each plus a plan pointer. No reporter counts.                                 |
| S12 | several                  | Naming and line drift: the helper is **`isGlobalSlugCollision`** (not `…UniqueViolation`); the verdict headline is `:5513`; the READ assertion `:5295-5300`; patch numbering should take **`06`**, not `07`.                                                                                             | All corrected.                                                                                                                                                                                    |

### Pushbacks

| #   | Lens  | Critique                                                                                  | Verdict      | Why                                                                                                                                                                                                                                                                                        |
| --- | ----- | ----------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P1  | scope | Move the **reporter** to `TEN-2d`, since both its consumers are after this PR.            | **rejected** | Security B9 is the stronger constraint: the isolation claim rests on a **dated** zero, and 2a's own plan requires re-measurement. A reporter that runs after the verdict flips is a measurement taken after the claim. It ships here and gates **this** merge.                             |
| P2  | arch  | The two-layer CHECK + set-membership design institutionalises a half-truth in the schema. | **rejected** | The same lens then argued the opposite and was right: the CHECK blocks the realistic path in (an operator nulling `household_id` to unwedge a delete — `ten-2a:257-264`), and `db:verify`'s PGlite-only reach is why layer 2 cannot stand alone. The defect was the **name**, fixed in S5. |
| P3  | scope | Drop patch `06`/`07` entirely as ceremony.                                                | **rejected** | Reuse checked all five existing patches: **none** covers `movementInHousehold` / `movementIsGlobal` / `insertMovementOwnedBy`. The `movements` seam has no mutation coverage at all today, and this is the PR where those indexes become load-bearing.                                     |
| P4  | scope | Reduce the ADR 0006 fix to a dated superseding note rather than editing the paragraph.    | **accepted** | Right — `plans/README.md` keeps decision records as-merged. One dated line, not a rewrite.                                                                                                                                                                                                 |

### Round 2 — what the second pass changed

Done (2026-10-11). Every blocking finding is resolved in the body above, not just logged:

- **B1** — retitled; §Goal carries the two-window table and the retracted urgency claim.
- **B2 / B10** — the file table now enumerates **three `verify.ts` blocks and 13 constraint sites**,
  with a decision each; the three uniqueness facts are **kept** rather than deleted; "Nothing for 2c to
  build here" is gone.
- **B3** — membership scoped to resolver-touched rows; the table-wide invariant moved to `TEN-2c-1`.
- **B4** — the `23505` catch moves to `TEN-2d`; §Finding 4 now argues **both** race directions.
- **B5** — the shadow guard is demoted to a warning, with its premise rewritten; in §Acceptance too.
- **B6** — fixed, and **measured**: the probe showed `42P10` first and `23514` second at the same
  statement, so the critique's ordering was inverted while its substance held. The fix is the
  drop → sim → re-add shape `verify.ts:734`/`:775-779` already uses.
- **B7 / B8** — `TEN-2d` and `TEN-2c-1` are filed as rows; the `convalidated` claim is corrected (it
  does not force 2d; 2d's `VALIDATE` is the mechanical control).
- **B9** — the reporter runs **before this merge** and gates it.
- **B11 / B12** — `06` is the one-line step-1 break; `04` is re-aimed, not retired.
- **B13** — `SECURITY.md:32-33` stays; only `:34-39` retires.
- **S1–S12** — Squawk-silence note, the lock argument, the false ordering mechanic deleted, the real
  rollback window, the CHECK renamed `movements_global_row_has_pattern`, the ownership queries
  extracted, `kind: 'report'`, counts-only, the const deleted, the eleven-file pointer sweep, header
  discipline, and the naming/line corrections.

**Still owed before implementation:** a light re-review by the **correctness** and **db-safety** lenses
that raised B2/B4/B5/B6, since those reshaped the file table. Then the maintainer's review.
