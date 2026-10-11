# TEN-2a — expand: `movements.household_id`, nullable, shipping dark

> Backlog: [plan.md](../plan.md) row TEN-2a. Branch: `db/ten-2a-household-movements`.
> Milestone: [beta-1.md](../milestones/beta-1.md) → Beta 0, `TEN-2` (deadline: the **invite**, not
> AUTH-1's merge). Verdict that put it there:
> [ten-1-household-scope.md](./ten-1-household-scope.md) → "1d as built — the catalog verdict".

## Goal

`movements` is the one table in the schema with no household column, which is why
`findOrCreateMovement` cannot be scoped and why TEN-1 1d proved — in both directions, against a real
database — that one household is handed another's catalog row, that whoever types a name first pins
that slug's metadata for everybody, and that a session write the household seam **refuses** has
already committed the caller's text. This PR adds the column and the two partial unique indexes that
will carry the invariant, **and lights nothing up**: no reader, no writer, no behaviour change, the
global `movements.slug` UNIQUE untouched so every deployed `ON CONFLICT (slug)` keeps its arbiter.

⚠️ **Precise about when the leak closes, because the repo currently mis-states it.** Dropping the
global UNIQUE (2c) **closes nothing by itself** — it only _permits_ two namespaces. The read leak
closes when the pre-existing app-authored rows **leave the global namespace**: 2b's backfill assigns
the ones a single household references, 2b's correction removes the ones nothing references, and 2c
splits the ones several households reference. `SECURITY.md`'s _"the leak closes when its third PR
drops the global `slug` UNIQUE"_ is the mis-attribution 2c is already slated to retract; this plan
does not propagate it.

Now, because the exposure window opens the moment household #2 exists — AUTH-1's _"a new user gets a
new, empty household"_ followed by step 4's _"invite family #1"_ — and because **the backfill is
cheapest while the catalog is small**. It is currently as cheap as it will ever be: zero app-authored
rows exist in production (measured below).

## Acceptance

Verbatim from [plan.md](../plan.md) → TEN-2a:

> Add the column plus the two partial unique indexes that will replace the global `movements.slug`
> UNIQUE. No reader, no writer, no behaviour change: the global UNIQUE stays, so every deployed
> `ON CONFLICT (slug)` keeps its arbiter.

Done when:

- `movements.household_id` is a nullable `bigint`, FK to `households.id`, added **`NOT VALID`**, with
  **`ON DELETE NO ACTION`** (load-bearing — see "Why `SET NULL` is forbidden").
- `uq_movements_slug_global` and `uq_movements_household_slug` exist with the predicates below, their
  **names exported from `schema.ts` as consts** (the `BODYWEIGHT_DAY_UNIQUE_INDEX` precedent) so
  `verify.ts` and 2b import rather than re-type them. The **predicates** stay SQL literals, and the
  docblock says why that asymmetry is deliberate.
- `movements_slug_unique` (the global UNIQUE **constraint**, not an index) is **unchanged** — and
  that is **proved**, not just asserted (test 2, outside the transaction).
- `db:verify` proves: the column's catalog shape; the FK **rejects** a non-existent household **and**
  is recorded `convalidated = false`; each new index rejects its own duplicate **and** the two
  namespaces are separate (only provable with the old constraint dropped); the authorship
  discriminator holds in **three** directions; and after the whole run **every** `movements` row has
  `household_id IS NULL`.
- **No committed statement anywhere in `verify.ts` sets `household_id` in 2a.** That is the invariant
  the dark gate encodes, and why every non-NULL fixture lives inside a rolled-back transaction.
- TEN-1 1d's structural tripwire (`verify.ts` → _"`movements` has NO household_id column"_) is
  **rewritten**, not deleted; `scripts/mutations/README.md`'s paragraph naming it is corrected; the 1d
  leak assertions are **unchanged and still green** — the verdict does not flip here.
- Every present-tense _"`movements` has no `household_id` column"_ claim is resolved, two files
  holding the statement and the rest pointing at them.
- `docs/runbooks.md`'s household-deletion procedure no longer aborts on the new FK.
- **`docs/plan.md`'s TEN-2b row no longer specifies the resolution order this plan rejects.**
- `pnpm verify`, `pnpm guides:check`, `pnpm status:check`, `pnpm db:mutations` (all five existing
  patches still RED), Squawk on the new migration, the forward-only and drift guards.

## 🔴 The uniqueness shape — the decision, and what it means for 2c

The backlog row sketched `UNIQUE (slug) WHERE household_id IS NULL` +
`UNIQUE (household_id, slug) WHERE household_id IS NOT NULL` and asked for it to be settled rather
than adopted. **It is the right shape, for a reason the sketch does not give, and it has two
consequences the sketch misses** (the resolution direction, and the 2b→2c window).

```sql
household_id  bigint NULL  REFERENCES households(id)  ON DELETE NO ACTION   -- nullable, FOREVER

CREATE UNIQUE INDEX uq_movements_slug_global
  ON movements (slug)               WHERE household_id IS NULL;
CREATE UNIQUE INDEX uq_movements_household_slug
  ON movements (household_id, slug) WHERE household_id IS NOT NULL;
```

**`household_id IS NULL` is a value, not missing data.** It means _reference data owned by no
household_ — the 35 curated rows seeded from `MOVEMENT_SEED_ROWS`, each with a `pattern`, a
`unit_default` and an `is_bodyweight` a human chose. A free-text row belongs to whoever typed it.
Those are two different kinds of row in one table, and NULL is the honest encoding of the first. So:

> **2c does NOT contract to `NOT NULL`.** It would assert something false about the seed: that some
> household owns `Box Jump`. There is no such household, and inventing a sentinel one to satisfy a
> constraint would put a fiction into the table that every household-scoped query must then exclude.

### What 2c contracts to instead — and it _is_ enforceable in the database

The end-state invariant is **`household_id IS NULL` ⟹ the row is a seeded catalog row.**

An earlier draft said that could only be _proved_ in `db:verify`, because the right-hand side is
membership in a `packages/shared` const list and a `CHECK` cannot read one. **Two lenses showed that
was wrong in the way that matters**, and the repo has already solved it twice: `movements_pattern_check`
inlines the `MOVEMENT_PATTERNS` literals and `verify.ts` pins them with
`assertCheckCoversConst(…, MOVEMENT_PATTERNS)`. So 2c gets **two layers**, not one:

1. **Declared, in the database** — a `NOT VALID` CHECK, `VALIDATE` in the PR after (the same split
   Squawk forces on the FK here):

   ```sql
   CHECK (household_id IS NOT NULL OR pattern IS NOT NULL)
   ```

   Every seeded movement has a non-NULL `pattern` — `movementSeedRowSchema` makes it non-nullable and
   `verify.ts` parses all 35 rows through it — and `findOrCreateMovement` can **never** write one. One
   line, no list, no prefix, no cast.

2. **Proved, in `db:verify`** — exact set membership in `MOVEMENT_SEED_ROWS`' `publicId`s, which is
   the _precise_ invariant the CHECK only approximates.

**Why both.** `db:verify` runs on PGlite, never against production, so it holds against nothing there
— not a hand-typed `UPDATE`, not a correction, not the operator, whom `SECURITY.md` calls _"the most
privileged actor here, and not a hypothetical one."_ A `NOT VALID` CHECK enforces every **new** row
from the moment it applies. Calling a `db:verify` assertion "stronger than `NOT NULL`" conflated
predicate strength with enforcement; this plan no longer does.

⚠️ The CHECK cannot land before 2c: `findOrCreateMovement` today writes `household_id NULL` with no
`pattern`, so it would `23514` on the live write path.
⚠️ 2c also owes a **dry-run `db:correct` reporter runnable against production**, because the invariant
is otherwise only ever observed on PGlite fixtures.

### Does a household get its own row for a name the global catalog already has?

**No — and the indexes are not what stops it.** They live in two namespaces, so they _permit_ a
household row and a global row to share a slug (measured: probe F below). What prevents it is the
resolution rule, which is 2b's to implement and is fixed here because the shape's safety depends on
its direction:

> **Global-first.** Resolve `slug` against `household_id IS NULL`; if found, return it. Only then
> resolve `(scope, slug)`; only then insert `(scope, slug)`.

The reason is specific to this app: **nothing in the app can author movement metadata.**
`findOrCreateMovement` writes exactly `{publicId, slug, name, isBodyweight: false}` — no `pattern`, no
`unit_default`. A household-first rule would let the free-text path shadow the seeded `box_jump`
(`is_bodyweight: true`) with a household row declaring it loaded-with-no-unit, and `programDayRows`
reads exactly those columns as _"the movement's declaration"_. A household override would always be
**strictly worse** than the row it overrode, and it would break the 1d assertion that is **good**
behaviour and must survive TEN-2: _"free text matching a catalog slug resolves to the SEEDED row …
carrying `is_bodyweight: true`, which this function can never write."_

🔴 **`docs/plan.md`'s TEN-2b row currently specifies the rejected order** — _"resolves
`(household_id, slug)`, falling back to the global reference row"_ — which is exactly the naive
reading that breaks the above. **2a rewrites that sentence**, and `seedProgram`'s bullet with it. A
decision recorded only in a plan nobody re-reads is not a decision; the backlog row is the brief 2b
gets implemented from.

⚠️ **The future cost, stated so the future PR knows what it owes.** Flipping to household-first when a
movement-editing UI exists is not a flag: it re-points which row _new_ writes resolve to while
existing `entries.movement_id` / `prescriptions.movement_id` keep pointing at the old one — the same
fragmentation hazard described next. That PR owes a repoint migration.

⚠️ **One hazard global-first creates: the seed grows** (three times already), and `migrate.yml` runs
`db:seed` against production on **every** push to `main`. If a household holds a custom `kb_swings`
and a later seed adds `kb_swings` globally, global-first re-points that household's **new** logs to
the seeded row while its **existing** FKs still point at its own — two rows for one slug inside one
household's history, breaking per-movement aggregation (DASH-1's PRs, the CSV grouping key).

**Why 2a is safe from it, stated correctly** (an earlier draft said _"it needs two households"_, which
is wrong — this splits a **single** household's history and has nothing to do with the invite): **no
row can carry a non-NULL `household_id` until 2b writes one**, so 2a cannot create the precondition at
all. The hazard goes live with 2b's writer **and 2c's backfill**, so the guard — the seed detects a
pre-existing household row for a slug it is about to add globally, and refuses or adopts — is a
**precondition in both 2b's and 2c's acceptance**, not a 2b task 2c could outrun. Its sibling:
`seedProgram`'s `inArray(movements.slug, …)` builds a slug-keyed map where **last row wins**, so once
two rows share a slug a prescription can attach to another household's row.

### 🔴 The 2b→2c window is a cross-household denial primitive, and it is structural

The most important thing the panel changed. Trace two households through the 2b→2c gap with
global-first: A types a novel name → inserts `(household_id = A, slug = 'x')`. B types the same name →
global miss, B-scope miss → tries to insert `(household_id = B, slug = 'x')` → **violates
`movements_slug_unique`, which is non-partial and still live until 2c**, and which is _not_ the
arbiter. `23505` propagates out of `findOrCreateMovement` and B's session write fails. **So between
2b's deploy and 2c's, household A can permanently deny household B the ability to log any movement
name A typed first** — an availability primitive, in the arc whose purpose is isolation. The backlog's
2b row half-saw this (_"its insert hits the global UNIQUE, which a partial-index `ON CONFLICT` does
not absorb. Harmless only while one household exists"_) and filed it as a leak caveat, not a denial.

**The window cannot be closed by resequencing.** Both options were considered:

- **Drop the constraint in 2b.** Rejected: code deployed _before_ 2b still says `ON CONFLICT (slug)`.
  `migrate.yml` migrates on merge while Vercel deploys separately, so the drop would land while the
  old code is live and **every** free-text movement write would fail with `42P10` — AGENTS.md's
  deploy-order rule exists for exactly this.
- **Make 2b read-only and have 2c do writer+drop together.** Rejected for the same reason one PR
  later: a PR boundary between "code stops needing the constraint" and "the constraint goes" is
  structurally required, so the window moves rather than closes.

**So the resolution is a precondition, owned rather than discovered:**

> **No second household may exist between 2b's deploy and 2c's.** This is already `SECURITY.md`'s
> sequencing rule and `beta-1.md`'s invite gate — what was _not_ written down is that **2b→2c is the
> window it protects**, and that the failure mode there is a denial, not only a leak. 2a writes it
> into `beta-1.md`, `SECURITY.md` and both backlog rows.

**Plus a cheap code mitigation for 2b, so the control is not only prose:** 2b's writer catches `23505`
on `movements_slug_unique` and falls back to resolving the existing global row. B then gets A's row —
the **pre-existing** 1d leak, which 2c closes — instead of a 500. That degrades the denial into the
status quo, the right failure direction. Assigned to 2b with a boundary test.

### Alternatives considered and rejected

1. **`NOT NULL` with a sentinel "global" household.** Rejected: `households` would hold a row that is
   not a household, `getHouseholdScope()` already throws on ≥2 live households, and every scoped query
   would need a predicate to exclude it. An honest NULL beats a fiction remembered in more places.
2. **Household-first resolution.** Rejected above — the only writer cannot author metadata, so every
   override destroys curated metadata. Revisit cost: a repoint migration, not a flag.
3. **A second table, `household_movements`, leaving `movements` purely seeded reference data.**
   Genuinely attractive — `movements` keeps its global UNIQUE forever and 2c drops nothing.
   ⚠️ **An earlier draft rejected it on a false premise** — _"no FK can enforce a tagged union across
   two parents"_ — which this repo's own `entries` contradicts: `movement_id` and `metric_key` are two
   real FKs to two parents with an at-most-one-of CHECK. The decisive reasons are different and
   stronger: it requires an expand→backfill→contract on `entries` **and** `prescriptions` (a nullable
   column plus a CHECK on the largest tables) instead of one nullable column on a 35-row table; it
   doubles every read of the movement declaration (`programDayRows`, `export-month`, DASH-1's
   per-movement aggregates); it makes "two rows for one slug in one household's history" **permanent**
   rather than a hazard with a guard; and it forks the id space the write path resolves through. It is
   the `entries` idiom deliberately **not** repeated.
4. **A single `UNIQUE (COALESCE(household_id, 0), slug)` expression index.** Rejected: it collapses
   the namespaces, so it forbids the household row by _colliding_ it with the global one — surfacing
   as a failed insert deep in a session write instead of a resolver that returned the seeded row — and
   it hides the invariant inside a sentinel.
5. **`WHERE deleted_at IS NULL` on the new indexes**, matching every other natural key in the schema.
   **Rejected, and this is the one place 2a deliberately diverges from the repo idiom.** The reason is
   `findOrCreateMovement`'s `SELECT … WHERE slug = $1 LIMIT 1`, which has **no `deleted_at` filter and
   no `ORDER BY`**: a natural key that ignored tombstones would let a live row and a tombstone share a
   slug and let the resolver hand back the tombstone. The repo's partial-on-`deleted_at` idiom exists
   for tables whose **writers** filter tombstones; this one does not. (An earlier draft also argued
   "2c's drop would quietly loosen a constraint" — **dropped as reasoning-to-a-conclusion**: the two
   partial indexes already loosen it along the namespace axis, which is the whole point.) Nothing in
   the app soft-deletes a movement today, so the conjunct buys nothing.
   **Revisit condition — three things in one change, not two:** the PR that first soft-deletes a
   movement adds `deleted_at IS NULL` to both indexes, **a `deleted_at` filter to the resolver**, and
   **the plain `idx_movements_household`** — because the moment the predicate becomes
   `… AND deleted_at IS NULL` it stops being implied by `household_id = $1` and the FK loses its
   index. Recorded in `schema.ts` beside the index, not only here.
   ⚠️ **Hard constraint until then:** nothing may set `movements.deleted_at`. Not hypothetical —
   `verify.ts` already soft-deletes a movement and restores it, and `programDayRows` filters
   `isNull(movements.deletedAt)`, so the read path treats a tombstone as supported while the write
   path cannot see one.
6. **A third plain `idx_movements_household` covering index.** Rejected: `uq_movements_household_slug`
   leads on `household_id` and its predicate is **implied** by any `household_id = $1` lookup
   (a strict operator clause), so it serves the FK's referential check and every household-scoped
   read. `program_blocks` needs its plain index only because its partial predicate is
   `WHERE deleted_at IS NULL`, which `household_id = $1` does **not** imply.
   ⚠️ This is the **first break in an 11-for-11 `schema.ts` idiom**, so the reasoning goes in
   `schema.ts` at the table — otherwise the next reader "fixes" it. ⚠️ And it is a **planner** claim:
   on a 35-row table PGlite will seq-scan, so `db:verify` can never exercise it. Stated as reasoning,
   not as a proof, and coupled to #5's revisit condition above.

### Why `ON DELETE SET NULL` is forbidden

`NO ACTION` mirrors `profiles.householdId`, but mimicry is not the justification. **`SET NULL` would
silently promote every row of a deleted household into the global reference namespace** —
`household_id IS NULL`, served by global-first to every other household, violating the end-state
invariant with no code change anywhere. It is reachable two ways: a future PR "fixing" the deletion
abort below by reaching for `SET NULL`, or the operator hand-typing
`UPDATE movements SET household_id = NULL WHERE household_id = H` to unwedge the delete. So the
migration header and the `schema.ts` docblock both say: **the correct response to a blocked household
delete is to delete the rows, never to null the column.**

## What the real production data says (measured 2026-10-09, read-only)

**Provenance, because this plan is setting the convention** — `git grep` finds no prior plan citing a
production measurement. Only **aggregates** were selected (`count`, `count(distinct)`) plus the
`movements` catalog's own columns, which are reference data from a public const. One query joined
`entries` and `profiles` to count _distinct referencing households_; it selected a count, never a
row. **No row-level personal value was read, printed or pasted** — no name, bodyweight, birthdate,
`public_id` or email — per [SECURITY.md](../../.github/SECURITY.md)'s bodyweight rule. The rule this
establishes: **production state facts live in the plan and the PR body, which stay editable — never in
a migration comment**, which the forward-only guard makes permanent
([data-inventory.md](../privacy/data-inventory.md) §9 residual 2 is the repo already paying for that
mistake once).

| Fact                                                                        | Value                     |
| --------------------------------------------------------------------------- | ------------------------- |
| `movements` rows                                                            | **35**, zero soft-deleted |
| `MOVEMENT_SEED_ROWS` length                                                 | **35**                    |
| Rows whose `public_id` is **not in `MOVEMENT_SEED_ROWS`**                   | **0**                     |
| Rows whose `public_id` is in the seed _namespace_ but not in the const      | **0**                     |
| Rows with `pattern IS NULL`                                                 | **0**                     |
| Live households                                                             | **1**                     |
| Max distinct households referencing any one movement (`entries`+`profiles`) | **1**                     |

> **There are zero app-authored `movements` rows in production.** All 35 are the 35 const seed rows,
> matched by `public_id` **identity**, inserted in three seed batches (`created_at` identical within
> each batch — a bulk insert, not typing). A handful of rows carry internal ids far above the rest,
> which **looks** like app authorship and is not: they are the most recent seed extension, carrying
> seed `public_id`s **and** a non-NULL `pattern`, neither of which `findOrCreateMovement` can write.
> The large id gaps are identity values burned by `ON CONFLICT DO NOTHING` across repeated seed runs,
> which consumes a sequence value per attempted insert — so **an id gap is evidence of re-seeding, not
> of deleted rows.** (Internal ids and batch dates are deliberately not reproduced: production row
> metadata with no load-bearing role.)

Consequences, all favourable: **TEN-2's whole arc carries no existing-data risk** (2b's backfill and
2c's split have zero rows to act on today — the cheapest this will ever be, which is the schedule
argument for landing it before the invite); **the leak is proved but not realised** (with one
household, no row has crossed a boundary — the verdict is about the primitive); and **a backfill in 2a
would be a no-op**, so there is none.

## The backfill's terms (the three questions left open by #269's review)

2b's and 2c's to execute; settled **here** because the uniqueness shape cannot be judged without them.

**1 · What counts as "custom"?** Not _"a slug not in the seeded catalog"_ — the seed list has grown
three times, so a slug a household typed can later **become** a seed slug and that test would then
call the row reference data. And 🔴 **not a `SEED_PUBLIC_ID_PREFIX` prefix test either, which is what
an earlier draft of this plan said.** That was wrong, and it drove a destructive delete:
`SEED_PUBLIC_ID_PREFIX` is the **global** seed namespace shared by every seeded table (`001` profile,
`010` household, `020`/`021` activity types, `030` metrics, `050`+ movements), so "inside the prefix"
means "in the seed namespace of _any_ table", not "is a movement seed row" — a `movements` row
carrying `seedPublicId('010')` would pass. The draft's own measurement table gave it away by
reporting "in the namespace but not in the const" as a _separate_ fact.

> A row is **app-authored** iff its `public_id` is **not in `MOVEMENT_SEED_ROWS`** — exact set
> membership, which is what the production measurement actually used. The prefix is a cheap
> pre-filter at most. Cross-check: `pattern IS NULL`.

Sound by construction: `movementSeedRowSchema` requires `pattern: movementPatternSchema`
(non-nullable) and `verify.ts` parses every seed row through it, so every seeded row has a pattern;
`findOrCreateMovement` writes neither `pattern` nor `unitDefault`, so every app-authored row has
`pattern IS NULL`. It is also **not forgeable**: `newId()` is the only non-seed source of
`movements.public_id`, and no path lets a caller supply one.

**2a exports the set once** — `MOVEMENT_SEED_PUBLIC_IDS` from `catalog-movements.ts`, beside the rows
it derives from — because the rule is otherwise re-derived in `verify.ts`, 2b's backfill, 2b's
correction and 2c's split. 2a does **not** export a prefix-based `isSeedPublicId()`; that would
enshrine the wrong test.

**2 · A custom row nothing references.** 1d's surviving-refusal primitive creates exactly these — one
household's free text in the global namespace where the fallback can serve it to another. It is not
assigned, it is **removed**, and 🔴 **it must be a HARD `DELETE`**, stated explicitly because the
registry's only existing delete precedent is a **soft** one (`.set({ deletedAt: … }) // README rule
4`) and an implementer following the registry would get this exactly wrong: a tombstoned app-authored
row still occupies its slug in a namespace whose resolver has no `deleted_at` filter, so it would be
handed back forever — recreating the precise defect alternative 5 exists to avoid. Justified by
`corrections/README.md` rule 8, the sanctioned deletion exception that inverts rules 2 and 5. Lands
with 2b; measured count today **zero**.

Four rules it needs that do not exist yet, all 2b's:

- **(a) It is a second sanctioned deletion.** Rule 8 scopes the exception to a PRIV-1 household
  deletion. 2b extends it or writes its own exception beside the rules, where that file keeps them.
- **(b) The dry-run output and the committed Applied table must never carry the row's `name` or
  `slug`.** Uncontrolled household free text, and the notice telling people not to type a person's
  name there means some will. `public_id` plus counts only; rule 9's redaction rule names only _"a
  privileged value (a child's bodyweight)"_ and 2b extends it to uncontrolled free text. The
  cautionary precedent is already here: §9's _"dated incidents about a named minor"_ residual lives in
  `registry.ts` and its README.
- **(c) Do not rest the justification on "unattributable."** With one live household and a
  `created_at`, the owner is inferable. The justification is **no purpose, no scope, nothing
  references it** — minimisation, true regardless.
- **(d) Ordering.** It runs **after** 2b moves the find-or-create inside `writeStrengthSession`'s
  transaction, or it deletes rows the live app is still creating; and the count is **re-measured
  immediately before the invite**, because "zero" is a dated fact, not an invariant.

**3 · How 2c picks which household keeps a shared row's original.** Deterministically, by first
reference:

> The original goes to the household with the **earliest** referencing row across
> `entries` ∪ `prescriptions` (`min(created_at)`), ties broken by the household's **`public_id`**
> (lexicographic) — never a raw internal `household_id`. `corrections/README.md` rule 3: _"targeted by
> `public_id`, never an internal `bigint` id — ids differ between environments."_ A tie-break on
> `households.id` would make the dry run the operator reads and the apply that runs disagree about
> which household keeps the original, and **ties are realistic**: this plan itself measured
> `created_at` identical within a batch, and a v1.5 sync flush writes many entries under one `now()`.
> Every other referencing household gets a clone with a **fresh `newId()` `public_id`** (copying one
> would duplicate a URL-addressable identifier across tenants and collide the `public_id` UNIQUE), and
> its own `entries.movement_id` / `prescriptions.movement_id` are repointed **through
> `inHousehold(scope)`** — never a hand-written conjunct; `scoped.test.ts` asserts there is no twelfth
> copy.

_Earliest_ rather than _most references_ because "whoever types a name first pins the slug" is already
the de-facto rule, so the first referencer is the household whose text the row carries.

⚠️ **`profiles.household_id` is nullable**, so "the household with the earliest referencing row" can
resolve to NULL through `entries → profiles`. 2c owes an answer for that row (treat as unreferenced,
or refuse and report); open for 2c, not 2a.

⚠️ **The clone is a cross-tenant data copy, and 2c must not pretend otherwise.** It carries the
**other** household's free text as `name`, indistinguishable from the recipient's own data and
surviving the author's household deletion — the residual `data-inventory.md` §3 names as _"the one
that leaves the household"_ and §4 marks `TEN-2`-closing. So 2c either sets the clone's `name` to the
slug's titleized form (**derived, not authored**) or records the retained foreign text as a named
residual in §5/§9. It may not leave §4 reading as closed while the text persists.

## How the index gets built, and what it actually locks

**Plain `CREATE UNIQUE INDEX`, not `CONCURRENTLY`** — the backlog's option (b). The
transaction-stripping runner AGENTS.md describes **does not exist** (`migrate.ts` is drizzle's stock
migrator; no migration here has ever used `CONCURRENTLY`), a `CONCURRENTLY` statement inside a drizzle
migration **fails at runtime with `25001`**, and **no gate catches it**:
`require-concurrent-index-creation` is excluded repo-wide and `assume_in_transaction = true` tells
Squawk the opposite. `movements` is 35 rows, and `db-migration`'s own rule allows it _"on a small or
new table with a comment saying why"_. `.squawk.toml` already records the reasoning, so the header
points at it rather than restating it. **No inline `-- squawk-ignore`**: `0012` creates an index on
the same argument and carries none, the rule is off so the gate will not ask, and two inline ignores
inside a file nobody may edit would **pre-exempt** exactly the two statements that should be
re-reviewed if the rule is ever switched on.

**No `DO $$` pre-check, unlike `0012` — and the reason belongs in the header**, because neither build
can fail: `uq_movements_slug_global` indexes a **subset** of the rows `movements_slug_unique` already
forces unique, and `uq_movements_household_slug`'s predicate matches **zero** rows. No `23505` is
possible; the only realistic failure is `lock_timeout` (`55P03`).

### The lock argument, corrected

An earlier draft repeated `0014`'s lock sentence, written for a file with one statement. It was wrong
in three ways. This is the truth, and it is the reviewed artifact:

> The whole file is one transaction, so the **`ACCESS EXCLUSIVE` on `movements`** taken by
> `ADD COLUMN` — which blocks **reads** as well as writes — is held through both index builds until
> COMMIT. The `SHARE` lock a bare `CREATE INDEX` would take is therefore irrelevant: a strictly
> stronger lock is already held. The FK additionally takes **`SHARE ROW EXCLUSIVE` on `households`**.
> `lock_timeout = '5s'` bounds how long **this statement waits** to acquire its lock — nothing bounds
> the queue piling up behind it; `statement_timeout = '60s'` bounds the **work**. At 35 rows the whole
> hold is milliseconds, and `migrate.yml` serializes and runs `db:seed` only after `db:migrate`
> returns, so the seed cannot be what queues behind it.

⚠️ `docs/tech-debt.md` records that the 1d review **already had to retract this exact class of
overstatement** (the indexes "built `CONCURRENTLY`"). A false lock claim in a migration header is a
defect, not a wording nit — and **PGlite models no concurrency at all**, so nothing in `db:verify` can
check it. The header has to be right because nothing else will catch it.

### 🔴 `drizzle-kit migrate` wraps the whole pending SET in one transaction, not each file

Verified in `drizzle-orm@0.45.3`'s source: `pg-core/dialect.js` → `migrate()` is a single
`session.transaction(...)` with `for await (const migration of migrations)` **inside** it. The repo
says "each file" in **five** places — `AGENTS.md`'s GOTCHA, `.squawk.toml` (marked LOAD-BEARING),
`0012`, `0014` and `runbooks.md`. Consequences 2a must get right:

- The atomicity claim is **stronger** than stated — the whole pending set rolls back together — so
  `assume_in_transaction = true` stays correct.
- Alongside another pending file, the `ACCESS EXCLUSIVE` on `movements` is held for the **entire run**.
- `SET` is session-level, so 0015's timeouts **leak onto later files in the same run**. 2a keeps plain
  `SET` for consistency with 0006–0014 and **says so**, rather than silently diverging to `SET LOCAL`.

2a does not add a sixth copy of the wrong claim; the repo-wide correction is its own one-line docs PR,
recorded in `tech-debt.md`.

### Squawk and the FK, measured rather than predicted

| Draft                            | Result (`squawk-cli@2.66.0 -c .squawk.toml`)                                    |
| -------------------------------- | ------------------------------------------------------------------------------- |
| FK added **`NOT VALID`**         | **`Found 0 issues`**                                                            |
| FK added **validated** (no flag) | **2 warnings**: `constraint-missing-not-valid`, `adding-foreign-key-constraint` |

So the FK ships `NOT VALID` and **2b runs the `VALIDATE CONSTRAINT`** — honouring AGENTS.md's
split-across-PRs rule with no escape hatch and no extra PR, landing the validation in the PR that
first writes a non-NULL value. **Measured in PGlite**, the split is free:

| Against a `NOT VALID` FK, one non-NULL child row | Result                                           |
| ------------------------------------------------ | ------------------------------------------------ |
| `DELETE` the parent                              | **`23503`** — blocked                            |
| `INSERT` a child with a non-existent parent      | **`23503`** — blocked; **new rows are enforced** |
| `INSERT` a child with `household_id NULL`        | **ok** — every existing row passes trivially     |

`NOT VALID` skips only the validation **scan**; both referential triggers are created and live. That
measurement does three jobs: it makes the runbook fix **mandatory**, it proves the FK protects 2b's
writes before it is ever validated, and it proves the 35 NULL rows cannot fail validation.

### The index behaviour, measured

A throwaway PGlite probe settled what the test plan can and cannot assert:

```
with movements_slug_unique present:
  two NULL-hh rows, same slug           => rejected by "movements_slug_unique"
  two hh=1 rows, same slug              => rejected by "movements_slug_unique"
  global + household row, same slug     => rejected by "movements_slug_unique"
after ALTER TABLE … DROP CONSTRAINT movements_slug_unique:
  two NULL-hh rows, same slug           => rejected by "uq_movements_slug_global"
  two hh=1 rows, same slug              => rejected by "uq_movements_household_slug"
  global + household row, same slug     => ACCEPTED
  on conflict (slug) do nothing                                  => OK (infers the non-partial)
  on conflict (household_id, slug) do nothing                     => ERR 42P10
  on conflict (household_id, slug) where household_id is not null => OK
  DROP INDEX movements_slug_unique                                => ERR 2BP01 (constraint owns it)
  begin; alter table … drop constraint …; rollback                => OK (DDL rollback works)
```

Three decisions fall out: **the central safety claim is confirmed** (a bare `ON CONFLICT (slug)` can
only infer the non-partial arbiter, so 2a changes no deployed behaviour); **the new index names cannot
be asserted while the constraint exists**; and **the drop must be `ALTER TABLE … DROP CONSTRAINT`**,
not `DROP INDEX` as the `0012` idiom does for its own index.

## 🔴 The runbook this PR breaks

[runbooks.md](../runbooks.md) → _"Delete a household and everyone in it (PRIV-1)"_ is the most
destructive procedure in the repo, irreversible by design, hand-typed under pressure after a 7-day
cooling-off, with `OPS-3` still a `_TODO_` stub. Its step-4 transaction deletes 12 tables ending in
`DELETE FROM households WHERE id = H`; `movements` is absent, and step 5 reads _"confirm `movements` is
**not** empty (it is global and must survive)."_

**This PR's FK changes that, and the runbook's own safety property is the symptom.** Step 5 reasons:
_"Every FK except the two cascades is `NO ACTION`, so a table this procedure missed would have aborted
the transaction rather than silently orphaning rows."_ Exactly so — measured above, the delete raises
`23503`, so from the first non-NULL `household_id` the operator is stranded mid-procedure.

2a's edit, with the corrections the architecture lens caught (the earlier draft had the insertion point
wrong — **11 is `profiles`**, not `households`):

- a **delete step at position 11**, `DELETE FROM movements WHERE household_id = H`, no `deleted_at`
  predicate per the documented inversion — renumbering `profiles`→12 and `households`→13, **and step
  4c's _"The 12 DELETEs"_ becomes 13**;
- a `movements WHERE household_id = H` row in the **step-3 / 4b / 4d count block**, because the
  runbook's own rule is _"the counts are the proof"_ and 4d is _"every row must read 0"_ — without it
  step 5's new assertion has nothing to compare against;
- **step 5** rewritten from _"confirm `movements` is not empty"_ to **"confirm `movements` holds zero
  rows for H and still holds the seeded (`household_id IS NULL`) rows"**;
- a **step-3 pre-flight** for the new unscoped-FK class: nothing in the schema stops an
  `entries.movement_id` / `prescriptions.movement_id` of household H from pointing at a movement owned
  by ¬H. Global-first and the backfill rules prevent it _by construction_ — which is the repo's idiom,
  and the repo's idiom is that such an invariant is **written in the schema docblock and pre-flighted
  in step 3** (the runbook writes out three others, warning that checking the wrong direction _"would
  leave exactly the mid-transaction abort that step 3 exists to pre-empt"_). So it goes in both;
- one sentence naming the **2b→2c residual**: 2b leaves a row referenced by more than one household at
  `household_id IS NULL`, so it carries H's typed `name`, is **not** selected by `household_id = H`,
  and survives a deletion the notice promises is complete.

**Why 2a and not 2b:** the FK that aborts the transaction is created by _this_ PR, and the runbook is
read months later by someone who has just promised a family their data is gone.

**Also:** the header's recovery pointer must not cite a stub. `runbooks.md` has **no**
"pending-migration wedge" heading — the already-generically-written wedge prose is buried inside
"Correct wrong data in prod", and both headings a failed 2a would send an operator to are `_TODO_`.
2a promotes the wedge prose to its own heading and cites that.

## Shipping dark — the gate, and what it does and does not cover

**The write side: a `db:verify` assertion, the gated vehicle** (`db:verify` runs in CI;
`db:mutations` does not). After the full run — migrations, seed twice, every 1d fixture, which creates
app-authored rows through the **real** `findOrCreateMovement` — every `movements` row has
`household_id IS NULL`.

⚠️ **The anti-vacuity guard must be on the property, not a row count.** An earlier draft used
`count(*) > MOVEMENT_SEED_ROWS.length`, reasoning that the vacuity risk is an empty table. It is not:
the risk is _"no row was created by a writer that could have set the column"_, and a count is satisfied
by extra rows from **any** source — including this plan's own direct-insert probes. It works today only
by luck. So: `count(*) WHERE public_id NOT IN MOVEMENT_SEED_PUBLIC_IDS > 0` — "at least one row was
authored by the only writer that exists" — reusing the discriminator rather than a magic number.

**The read side needs two lines, and the earlier draft got this wrong twice.** The all-NULL assertion
falsifies a **writer**, not a **reader**, and the earlier risk row claimed it covered the `42703`
window. The claimed backstop was false too: `scoped.test.ts`'s rule is _"reaches `db` ⇒ resolves or is
handed a `HouseholdScope`"_ — a scope-presence rule, not a column rule, so a scoped reader selecting
the new column satisfies it. So 2a adds a **six-line** source assertion in the
`household-synthetic-is-dark.test.ts` shape, scoped to `packages/db/src/` and `apps/web/lib/`: nothing
there names `movements.householdId` / `movements.household_id`. **2b deletes it**, as 1a's docblock
instructs for its own.

That is a one-PR-lifetime guard, which this plan refuses elsewhere as ceremony — the difference is that
it is **six lines, not sixty**, and it is the only thing covering a window with a real `42703` at the
end of it. Known gap, stated: a destructured alias evades a grep, which is why the DB-level all-NULL
assertion is the load-bearing half.

**No new `db:mutations` patch.** A patch whose whole life is one PR, in a gate not wired into CI,
costs more than it proves; the property-based anti-vacuity guard is the honest substitute.

## 2a owns the tripwire it fires

`verify.ts` asserts `(await columnsOf('movements')).has('household_id') === false`, saying _"TEN-2 adds
the column, and this assertion is what fails then"_, and `scripts/mutations/README.md` names it as the
verdict's tripwire that needs no patch. Both are **this PR's** to rewrite. The replacement asserts what
is now true (the column exists, is nullable, nothing has written it) and says in its message that **the
leak assertions below are unchanged and still green**. 1d's leak assertions and mutation patch
`04-slug-is-not-the-arbiter` are untouched.

## The sentence this PR makes false

`git grep` for the phrase returns **14 occurrences across 12 editable files** — more than the eleven an
earlier draft listed, and the draft's gate pattern also matched two files that must **never** be edited
(`docs/plans/ten-1-household-scope.md`, kept as-merged per [plans/README.md](./README.md);
`docs/changelog/2026-10-08-…md`, an as-merged fragment). Missed entirely, and named independently by
three lenses: **`apps/web/lib/dal/catalog.ts:25` and `:95`** — two copies in the file holding
`findOrCreateMovementId`, the most load-bearing of the lot, and `:95` is the docblock **directly above
it** — plus `docs/architecture.md:141` and `docs/features/programming.md:170`. All three are named in
the `tech-debt.md` entry this plan cites, whose list was more complete than the draft's.

**And the fix is not eleven restatements.** The reuse lens landed a fair hit: the draft wrote a
canonical phrase into every file while refusing a one-PR-lifetime test as ceremony — but 2b falsifies
that phrase too, so it was eleven one-PR-lifetime sentences. So:

- **Two files hold the statement**: `docs/privacy/data-inventory.md` §4 and `docs/plan.md`'s TEN-2 row
  — the designated evidence homes `tech-debt.md` already proposes.
- **Everything else gets a pointer**: _"`movements.household_id` exists; see `data-inventory.md` §4 for
  the status."_ 2b then edits two files, not twelve, and `tech-debt.md`'s entry **shrinks** instead of
  gaining a phrasing.
- **§4 needs its own wording.** It opens _"`movements` is shared across households and **cannot be
  scoped**"_ — an impossibility claim 2a falsifies, in the row that is the evidence home for a
  **still-open** leak. Use: _"`movements` is shared across households and is **not** scoped — the
  `household_id` column exists (TEN-2a) but nothing reads or writes it until TEN-2b; the leak closes
  at **TEN-2c**."_
- **The gate**, run at the end of the branch, must be **phrasing-tolerant**, because the sentence is
  reflowed by Prettier and wraps mid-phrase in three files:
  `git grep -nEi 'no (\*\*)?.?household_id.?( column)?|carries no .household_id.|column at all' -- . ':!docs/plans/' ':!docs/changelog'`
  then eyeball the residue. A literal single-phrase grep cannot police text a formatter reflows — the
  draft's pattern returned 18 hits in 16 files and could never have passed.

**Deliberately deferred to 2c**, named in the PR body: `.github/SECURITY.md`,
`docs/milestones/beta-1.md`, `docs/decisions/0006-household-addressing.md` — in each the sentence
supports a conclusion that is **still true**, and tech-debt's consolidation is explicitly 2c's.
⚠️ `docs/roadmap.md` is **not** deferred: its TEN-2 cell is one table cell holding _both_ the false
clause _and_ the status text 2a already edits, so leaving it would ship a self-contradicting sentence.

## What the privacy inventory, the notice and the retention policy owe

The privacy lens found that **three documents which promise a parent something are owned by no PR in
this arc** — the arc's real weakness, not the schema.

**`docs/privacy/data-inventory.md` — five edits.** `movements` moves from _"reference data, no personal
content"_ to _"household-reachable"_ the moment the column carries a value: a **classification
change**, against this file's contract that _"every factual claim in the notice traces to a row here,
and every row here traces to code."_ **2a owns three:** a `movements.household_id` row in §2 "Columns
that exist and hold nothing", in exactly the `profiles.pin_hash` shape (_"Reserved, and **owned** —
TEN-2b"_, not the `profiles.birthdate` shape this file records as the bad case) — which also arms the
file's own re-review trigger 3, _"a writer appears for a column this file says is unused"_, the
mechanism that catches 2b if 2b slips; a note on §1's _"Twelve are household-reachable"_ count saying it
becomes thirteen/five at 2b; and a re-dated staleness header, since 2a edits `schema.ts` and that
header's probe would otherwise print. **2b owns two**, untrue until the deletion step exists: §1b's
_"no household scoping"_ and _"survives that household's deletion"_, plus §1b's framing sentence _"Not
deleted when a household is deleted, because there is nothing of theirs in them"_, which now has an
exception.

**`docs/privacy/notice.md` — nothing in 2a, and that is a decision.** A dark column falsifies nothing
it says. But it is unassigned across all three PRs and makes two movement-specific promises this arc
moves, so they are assigned now rather than at the invite: _"it is **not removed** when you delete your
household"_ → **2b**, same PR as the deletion step; _"it can appear to another household"_ and "Who can
see it" limitation 2 → **2c**.

**Retention.** A household-authored movement name is the only piece of personal content in the schema
with **no retention row at all** (§8 has none; the notice's "not removed" is the only statement, i.e.
indefinitely). 2a adds the §8 row: _"A household-authored movement name — until the household is
deleted (TEN-2b adds it to the deletion procedure; before that, indefinitely). Seeded catalog rows are
reference data and are kept."_

## File-by-file changes

| Path                                                                                                                                                                                                       | Change   | What & why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/db/src/schema.ts`                                                                                                                                                                                | EDIT     | `householdId` (nullable, mirroring `profiles.householdId`, `NO ACTION`); the two `uniqueIndex(...).where(...)`; **both index names exported as consts** beside `BODYWEIGHT_DAY_UNIQUE_INDEX`. Docblock: namespace semantics; why `SET NULL` is forbidden; why there is no third plain index (the 11-for-11 divergence) **and what would make it necessary**; alternative 5's three-part revisit condition; the new writer-enforced cross-household-reference invariant; names-are-consts / predicates-are-literals asymmetry; a **pointer** to this plan for the resolution rule.                                             |
| `packages/db/migrations/0015_ten2a_movements_household.sql`                                                                                                                                                | NEW      | The migration. Shape below.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `packages/db/migrations/meta/0015_snapshot.json`, `meta/_journal.json`                                                                                                                                     | NEW/EDIT | `drizzle-kit generate --name ten2a_movements_household`. Journal append-only; snapshot `prevId` chains to `0014`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `packages/shared/src/catalog-movements.ts`                                                                                                                                                                 | EDIT     | Export `MOVEMENT_SEED_PUBLIC_IDS` (a `Set` of the 35 `publicId`s) beside the rows — the **one** home for the authorship discriminator, so it is not re-derived in four places. ⚠️ **Not** a prefix-based `isSeedPublicId()`: the prefix is the global seed namespace, not the movement one.                                                                                                                                                                                                                                                                                                                                   |
| `packages/db/scripts/verify.ts`                                                                                                                                                                            | EDIT     | Rewrite the 1d tripwire; add `columnCatalogShape(table, column)` beside `columnsOf` and convert TEN-1 1a's inline `information_schema` block to it (mechanical, same assertion messages); give `expectRejectedBy` a `tx`-aware parameter; append the `// ── TEN-2a: …` section. 1d's leak assertions untouched.                                                                                                                                                                                                                                                                                                               |
| `packages/db/scripts/mutations/README.md`                                                                                                                                                                  | EDIT     | Correct the paragraph naming the structural assertion as the tripwire: it has fired, 2a re-took it, the leak assertions stand until 2c.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `apps/web/lib/movements-household-is-dark.test.ts`                                                                                                                                                         | NEW      | Six lines plus the 1a-shaped anti-vacuity check. **2b deletes it.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `docs/runbooks.md`                                                                                                                                                                                         | EDIT     | 🔴 The deletion procedure: count-block row, delete step at **11** with the renumbering and the "12 DELETEs"→13 fix, step 5's verification, the step-3 pre-flight, the 2b→2c residual. Plus promote the pending-migration wedge prose to its own heading.                                                                                                                                                                                                                                                                                                                                                                      |
| `docs/architecture.md`                                                                                                                                                                                     | EDIT     | **The diagram home**, so the PR's ERD and the committed one agree: §2's ERD gains `households \|\|--o{ movements`, and the two paragraphs calling the missing edge _"the defect"_ (one of which carries the false sentence) are corrected.                                                                                                                                                                                                                                                                                                                                                                                    |
| `docs/spec.md`                                                                                                                                                                                             | EDIT     | One line in §4a's `movement` column list: `household_id? (FK; NULL = seeded reference row)`. It is the data-model source of truth AGENTS.md points every agent at; `households.synthetic` skipped it, and this plan declines to repeat that.                                                                                                                                                                                                                                                                                                                                                                                  |
| `docs/privacy/data-inventory.md`                                                                                                                                                                           | EDIT     | 🔴 Three of the five edits above, plus §4's own wording and the §8 retention row.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `apps/web/lib/dal/catalog.ts`                                                                                                                                                                              | EDIT     | 🔴 Two docblock pointers (`:25`, `:95`) — missed by the draft's grep, and `:95` sits directly above `findOrCreateMovementId`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `packages/db/src/writers/movement-catalog.ts`                                                                                                                                                              | EDIT     | Docblock pointer. Explicitly: the column exists and this function must **not** start using it — 2b changes the signature.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `packages/db/src/writers/ownership.ts` · `apps/web/lib/dal/entries.ts` · `apps/web/lib/dal/scoped.test.ts` (reason string) · `docs/features/write-path.md` (×3) · `strength-logging.md` · `programming.md` | EDIT     | Pointers. **No code change** — `entries.ts`'s ordering fix and `scoped.test.ts`'s entry deletion are 2b's.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `docs/plan.md`                                                                                                                                                                                             | EDIT     | TEN-2a → link this plan, design question **settled**. 🔴 TEN-2b → **rewrite the resolution sentence to global-first** and the `seedProgram` bullet with it; plus `VALIDATE CONSTRAINT`, the `23505` fallback, the seed-growth and `seedProgram` hazards, the four correction rules, hard-delete, `where:`-not-`targetWhere:`, the notice/inventory edits. TEN-2c → the `NOT VALID` CHECK (not `NOT NULL`), the clone rules, the `public_id` tie-break, the nullable-`profiles.household_id` gap, the conflict-target sweep, the seed guard as a **precondition**, the prod-runnable reporter. TEN-2 → the 2b→2c precondition. |
| `docs/milestones/beta-1.md` · `.github/SECURITY.md`                                                                                                                                                        | EDIT     | The 2b→2c window as a named invite precondition (one or two lines each; the verdict narrative is left for 2c).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `docs/status.md` · `docs/roadmap.md` · `docs/tech-debt.md` · `docs/lessons.md`                                                                                                                             | EDIT     | Status pointers; tech-debt records which copies 2a resolved, what 2c owes, the repo-wide "each file" transaction error, and the two out-of-diff reuse items; `lessons.md` gains the **`onConflictDoNothing` reads `where`, not `targetWhere`** half (verified in drizzle 0.45.3's source) so the entry stops documenting only the form 2b must not use.                                                                                                                                                                                                                                                                       |
| `docs/changelog/2026-10-09-db-ten-2a-household-movements.md`                                                                                                                                               | NEW      | One fragment (`status:check` names this exact filename).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

⚠️ **Hand-hardening comes after `generate`, which emits none of it** — no `NOT VALID`, no
`IF NOT EXISTS`, no `SET`s, no comments. That is invisible to the drift guard (it diffs `schema.ts`
against the snapshot, not the SQL), which is exactly why the FK needs the `convalidated = false`
assertion: **if the hand-edit is lost on a rebase, every gate stays green** and prod runs a validating
scan instead. Re-check with `pnpm db:generate && git status --short packages/db/migrations`.

### `0015_ten2a_movements_household.sql` — shape

```sql
-- TEN-2a — `movements.household_id` + the two partial unique indexes, shipped dark.
--
-- WHY / THE SHAPE: <the verdict in one para; household_id IS NULL = reference data owned by no
--   household, so 2c contracts to a NOT VALID CHECK (household_id IS NOT NULL OR pattern IS NOT
--   NULL), NOT to NOT NULL.>
-- CONSTRAINT ON 2b (one line, not a design): the resolver must be GLOBAL-FIRST, or a household row
--   can shadow a seeded one with strictly worse metadata. Reasoning, the seed-growth hazard and the
--   2b->2c window: the plan. This file states what the indexes MEAN; it does not design 2b.
-- ⚠️ ON DELETE NO ACTION IS LOAD-BEARING: SET NULL would promote a deleted household's rows into the
--   global reference namespace and silently break "IS NULL => seeded". The correct response to a
--   blocked household delete is to DELETE the rows (runbooks.md, step 11), never to null the column.
-- ⚠️ WRITER-ENFORCED, NOT SCHEMA-ENFORCED (the `supersets` / `prescription_targets` family): nothing
--   here stops an entries.movement_id of household H pointing at a movement owned by not-H.
--   Global-first + 2b/2c's backfill rules prevent it by construction; runbooks.md step 3 pre-flights
--   it, because the symptom is a mid-transaction abort of the household delete.
-- MEASURED: see the plan -> "What the real production data says". No backfill here.
--   ⚠️ NO PRODUCTION NUMBERS IN THIS FILE: migrations are forward-only and never edited, so a fact
--   written here is permanent (data-inventory.md §9 residual 2 — 0012 carries a given name in a
--   comment and can only go if history is rewritten). Production state belongs in the plan.
-- LOCKS: the whole file is one transaction, so ADD COLUMN's ACCESS EXCLUSIVE on `movements` — which
--   blocks READS as well as writes — is held through both index builds until COMMIT; the FK also
--   takes SHARE ROW EXCLUSIVE on `households`. lock_timeout bounds how long THIS STATEMENT WAITS for
--   its lock (nothing bounds the queue behind it); statement_timeout bounds the work. 35 rows =>
--   milliseconds. ⚠️ drizzle wraps the WHOLE PENDING SET in ONE transaction (verified in drizzle-orm
--   0.45.3 pg-core/dialect.js), not each file, so alongside another pending file the hold spans the
--   whole run — and plain SET (not SET LOCAL, kept for consistency with 0006-0014) leaks these
--   timeouts onto later files in that run.
-- NO PRE-CHECK (contrast 0012): uq_movements_slug_global indexes a SUBSET of the rows
--   movements_slug_unique already forces unique, and uq_movements_household_slug's predicate matches
--   ZERO rows, so neither build can raise 23505. Only realistic failure: lock_timeout (55P03).
-- NOT CONCURRENTLY: the transaction-stripping runner does not exist and the gate that would ask is
--   excluded repo-wide — reasoning recorded in .squawk.toml, not restated here.
-- SHIPS DARK: no reader, no writer. movements_slug_unique is UNTOUCHED, so every deployed
--   ON CONFLICT (slug) keeps its arbiter until 2c (a bare target can only infer a NON-PARTIAL
--   index — measured). db:verify proves every row stays NULL.
-- RE-RUN SAFETY comes from the transaction, not from IF NOT EXISTS: a failed run leaves nothing
--   behind. (ADD CONSTRAINT has no such clause anyway; the indexes omit it deliberately, per 0012 —
--   it would mask a same-named index with a DIFFERENT predicate, and the predicate is the invariant.)
-- WHAT db:verify DOES NOT PROVE: PGlite starts empty (the 35-rows-acquiring-a-column path is never
--   exercised), is single-connection (lock_timeout never exercised) and models NO CONCURRENCY at all
--   (the ACCESS EXCLUSIVE hold and the movements->households lock order are review-enforced only).
-- IF IT FAILS: no partial state, but the migration stays PENDING and takes db:seed with it —
--   runbooks.md -> the pending-migration wedge (promoted to its own heading in this PR).
SET lock_timeout = '5s';--> statement-breakpoint
SET statement_timeout = '60s';--> statement-breakpoint
ALTER TABLE "movements" ADD COLUMN IF NOT EXISTS "household_id" bigint;--> statement-breakpoint
ALTER TABLE "movements" ADD CONSTRAINT "movements_household_id_households_id_fk"
  FOREIGN KEY ("household_id") REFERENCES "public"."households"("id")
  ON DELETE no action ON UPDATE no action NOT VALID;--> statement-breakpoint
-- The global reference namespace: one row per slug among rows owned by no household. Implied by the
-- existing global UNIQUE today; load-bearing from 2c.
CREATE UNIQUE INDEX "uq_movements_slug_global" ON "movements" USING btree ("slug")
  WHERE "movements"."household_id" is null;--> statement-breakpoint
-- Each household's own namespace. ALSO the covering index for the FK above: it leads on household_id
-- and its predicate is implied by any `household_id = $1` lookup, so no separate plain index is
-- needed (unlike idx_program_blocks_household, whose partial sibling is WHERE deleted_at IS NULL and
-- therefore cannot answer the referential check). ⚠️ Adding `deleted_at IS NULL` here LOSES that
-- implication, so the PR that does it must also add the plain idx_movements_household.
CREATE UNIQUE INDEX "uq_movements_household_slug" ON "movements" USING btree ("household_id","slug")
  WHERE "movements"."household_id" is not null;
```

## Test plan

New `// ── TEN-2a: the column exists, and nothing uses it ──` section in `verify.ts`, PGlite.

**1 · Shape and the FK.** `columnCatalogShape('movements', 'household_id')` → `bigint`,
`is_nullable = 'YES'`, no default. Then the two proofs the draft omitted, both load-bearing:

- the FK **rejects** a non-existent household →
  `expectRejectedBy('movements_household_id_households_id_fk', …)`;
- the FK is **actually `NOT VALID`** → `SELECT convalidated FROM pg_constraint WHERE conname = …` is
  `false` (the `pg_constraint` idiom already in `assertCheckCoversConst`). Nothing else catches a lost
  hand-edit. **2b flips this assertion to `true`**, turning "2b must not forget the VALIDATE" from a
  prose reminder into a red build.

**2 · `movements_slug_unique` is unchanged — and this is the acceptance item the draft never proved.**
Outside any transaction: a global row and a household row with the **same slug** are rejected by
**`movements_slug_unique`** (measured: probe C). That single line proves the old constraint is still
non-partial and still binding, which is the whole basis of "2a changes no deployed behaviour".

**3 · The three uniqueness facts, in ONE rolled-back transaction.** ⚠️ **They cannot be asserted
outside one.** `movements_slug_unique` is non-partial on `(slug)`, so it dominates both new indexes for
every row these tests insert; index insertion walks the index list in OID order, and a `0001`
constraint has a far lower OID than a `0015` index — so `expectRejectedBy`, which asserts the **exact**
`cause.constraint`, would deterministically get `movements_slug_unique`. The draft tried to resolve
this with prose that was not a procedure. Four mechanics, each of which would otherwise cost an
attempt:

- **`ALTER TABLE "movements" DROP CONSTRAINT "movements_slug_unique"`**, not `DROP INDEX` — measured:
  `DROP INDEX` fails `2BP01` because the constraint owns the index. (The `0012` idiom drops a bare
  index, which is why it reads as a direct precedent and is not one.)
- **Resolve the `households` row id BEFORE entering the transaction.** PGlite has one connection, and
  `verify.ts` already documents that a query on `db` inside `tx` waits forever. For the same reason
  `expectRejectedBy` — which closes over the module-level `db` — gets a `tx`-aware parameter; calling
  it as-is inside the transaction would **hang `db:verify` with no message**.
- **Each expected rejection in its own nested `tx.transaction(...)`** (drizzle emits
  `SAVEPOINT`/`ROLLBACK TO`). A failed statement aborts the enclosing transaction, so after the first
  rejection every later statement fails `25P02` and `expectRejectedBy` would report `got '(none)'`.
- **The rollback is unconditional**: end the callback by throwing a sentinel the caller catches, in a
  `try/finally`. `0012`'s transaction rolls back because its `DO` block _raises_; a callback that
  merely finishes **commits**, which would permanently drop `movements_slug_unique` for the rest of a
  5,400-line file and make every later assertion pass for the wrong reason.

Inside it:

```
(a) two rows, same slug, both household_id NULL     → rejected by uq_movements_slug_global
(b) two rows, same slug, same non-NULL household_id → rejected by uq_movements_household_slug
(c) one global row + one household row, SAME slug   → BOTH INSERT — the namespaces are separate,
                                                      which is the entire point of the shape
```

Then **after** the rollback: the constraint is back and still rejects a duplicate slug — `0012`'s
closing re-assertion, without which (a)–(c) could leak a dropped constraint into the rest of the file.

(c) is the only assertion that distinguishes the new indexes from the constraint they replace; without
it, tests 1–3 would pass against a migration that created no indexes at all. It is **not** 2c's
acceptance: 2c's is that the real `findOrCreateMovement` resolves per household with the constraint
actually gone.

**4 · The dark claim.** At the **end** of the run: the property-based anti-vacuity guard
(`count(*) WHERE public_id NOT IN MOVEMENT_SEED_PUBLIC_IDS > 0`), then
`count(*) WHERE household_id IS NOT NULL === 0`. ⚠️ **This is why every non-NULL fixture lives inside
the rolled-back transaction**: a committed one would falsify this gate, and the tempting repair is to
weaken it to `<= 1`, at which point it stops proving the dark claim. **No committed statement in 2a may
set `household_id`.**

**5 · The authorship discriminator, three directions** — set membership in
`MOVEMENT_SEED_PUBLIC_IDS`: a row in the set has a non-NULL `pattern`; a row outside it has
`pattern IS NULL`; and **no row carries a seed-_namespace_ `public_id` that is not in the set** — the
third direction, which the prefix test would have missed and which the production measurement
implies. Plus the obligation the security lens named: assert `movements.public_id` is only ever
`newId()` or a `MOVEMENT_SEED_ROWS` value — true today and asserted nowhere, and `verify.ts`'s one
raw-SQL fixture uses `gen_random_uuid()` and satisfies this by luck.

**1d is unchanged** — a precondition, not a proof, so it lives in Acceptance rather than the count.

Commands: `pnpm --filter @mat-plan/db db:verify` · `pnpm verify` · `pnpm guides:check` ·
`pnpm status:check` · `pnpm db:mutations` (all five patches still RED — hunk sites checked, none
collide with 2a's edits) ·
`npx squawk-cli@2.66.0 -c .squawk.toml packages/db/migrations/0015_*.sql` ·
`pnpm db:generate && git status --short packages/db/migrations`. **No `e2e:local`**: no route,
component or flow changes. **No UX panel**: nothing in 2a is user-facing — no route, component, copy
or visible state. Stated rather than skipped silently.

## Risks / rollback

| Risk                                                                         | Mitigation                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A reader slips in, so a deploy ahead of `migrate.yml` throws `42703`.        | The six-line source assertion. Test 4 gates the **write** side only, and `scoped.test.ts` is a scope-presence rule, not a column rule — the draft claimed both covered this and neither does.                                                              |
| A new partial index arbitrates an existing `ON CONFLICT (slug)` differently. | It cannot — **measured**: a bare target can only infer the non-partial `movements_slug_unique`, untouched. Test 2 proves the constraint still binds; test 3(c) measures the difference the indexes make.                                                   |
| The hand-added `NOT VALID` is lost on a rebase; every gate stays green.      | The `convalidated = false` assertion in test 1. This is the only thing that catches it.                                                                                                                                                                    |
| The test transaction commits, silently dropping the global constraint.       | Unconditional sentinel throw in a `try/finally`, plus the post-rollback re-assertion.                                                                                                                                                                      |
| `lock_timeout` expiry (`55P03`).                                             | 35 rows, two ms-scale builds, one metadata-only ALTER, and neither build can raise `23505`. Recovery is a `workflow_dispatch` re-run; the pending migration also wedges `db:seed`, whose runbook heading this PR promotes out of a `_TODO_` neighbourhood. |
| Household deletion aborts with `23503`.                                      | Measured, and fixed in this PR — including the count block, the renumbering and the step-3 pre-flight.                                                                                                                                                     |
| The 2b→2c cross-household denial window.                                     | Structural; cannot be resequenced away. A named invite precondition in `beta-1.md`, `SECURITY.md` and both backlog rows, **plus** 2b's `23505` fallback so the control is not only prose.                                                                  |
| The twelve-file sentence sweep misses one, or edits an immutable file.       | Two homes plus pointers (less to miss), and a **phrasing-tolerant** `git grep -E` gate with `docs/plans/` and `docs/changelog/` excluded. The draft's literal pattern could never have passed.                                                             |
| Export / portability regresses.                                              | 2a changes no read path, and 2b's correction deletes only zero-reference rows, so no CSV loses its `movements` join. Recorded so the next reviewer need not re-derive it.                                                                                  |

**Rollback.** Additive and forward-only. Reverting the **code** leaves an inert column, two unused
indexes and an unvalidated FK — the property that makes it safe to land ahead of 2b. A `DROP COLUMN`
would be a contract step, not the rollback.

⚠️ **No restore branch, and the draft's "cut one anyway" was wrong.** This migration changes **no
data**, and `runbooks.md` records that a restore branch is a copy-on-write copy of the **whole**
database that cannot be restored per-household until `OPS-3` exists — _"not practically recoverable."_
Cutting one would hold an extra 7-day copy of minors' health data to insure against a failure whose
real recovery is a `workflow_dispatch` re-run. AGENTS.md's rollback rule targets destructive and
backfill steps; this is neither. **2c cuts one** — it drops a constraint and moves rows. What is worth
capturing pre-merge instead is the 35-row inventory this plan already measured, so 2b/2c's assignment
is auditable.

## Out-of-scope / deferred

- **Any reader or writer of the column** — 2b: `findOrCreateMovement`'s signature, the conflict
  targets (**exactly two** in `src/`: `seed.ts` and `writers/movement-catalog.ts`, plus whatever
  `seedProgram`'s `inArray(movements.slug, …)` needs — the draft said "three", and 2c cannot afford
  that drift), `programDayRows`, and the `VALIDATE CONSTRAINT`.
  ⚠️ **2b's new arbiters must use `where:`, not `targetWhere:`** — verified in drizzle 0.45.3's source,
  `onConflictDoNothing` reads `config.where` and **silently drops** `targetWhere`, so the predicate
  would vanish and the partial index could not be inferred (`42P10`, measured). `docs/lessons.md` today
  documents only the `onConflictDoUpdate({ targetWhere })` form — exactly the form 2b must **not** use;
  2a adds the missing half. The predicate must also render as a **literal**, not a bound `$1`.
- **The drizzle predicate helpers** (`household_id IS NULL` / `IS NOT NULL`) and the set-membership
  predicate → one home in `packages/db/src/writers/ownership.ts`, extracted at the **second** consumer
  in 2b, per that file's own documented rule. 2a owes the decision of where, not the code.
- **Moving the find-or-create inside `writeStrengthSession`'s transaction** — 2b, and the reason
  matters: **2b's column change defuses the cross-tenant half on its own**, because a refused session's
  committed row then lands in the caller's **own** namespace rather than the shared one, so the
  ordering fix becomes garbage collection, not an isolation fix. ⚠️ What stays open across 2a: the
  primitive needs **no second household**, and nothing bounds it — the rate limiter is wired to the
  gate login only, so any gate-code holder can mint unbounded permanent `movements` rows of chosen
  text. It is bounded solely by `SECURITY.md`'s sequencing rule, which is why **2b must land before the
  invite**, not merely before AUTH-1. Doing it in 2a would also serialize the `Promise.all`, widen the
  session transaction's lock footprint and flip `entries.test.ts`'s ordering assertion — three
  obligations belonging with 2b's writer change.
- **2c**: the `DROP`, the `NOT VALID` CHECK + its const-parity assertion (and the `VALIDATE` in the PR
  after), the verdict flip, the split backfill and its clone rules, the prod-runnable dry-run reporter,
  and rewriting or retiring mutation patch `04-slug-is-not-the-arbiter`.
  ⚠️ **2c's acceptance gains two preconditions.** (i) `migrate.yml` runs `db:seed` in the **same job**
  immediately after `db:migrate`, so one surviving non-partial `ON CONFLICT (slug)` makes the drop fail
  **2c's own migrate run** and wedge prod — the wedge caused by the contract step itself. So
  `git grep -n "movements.slug" -- packages/db apps/web` must show **no** non-partial arbiter anywhere,
  corrections and seeds included, before the drop merges; and 2c's migration may only apply after 2b's
  app deploy is live. (ii) The seed's shadow guard must exist **before** 2c, since 2c's backfill is the
  other thing that creates household-owned rows.
- **Deleting `scoped.test.ts`'s `findOrCreateMovementId` allowlist entry** and
  **`movements-household-is-dark.test.ts`** — both 2b.
- **The transaction-stripping `CONCURRENTLY` runner** — its own plan, if ever. Not needed here, and it
  would invalidate `.squawk.toml`'s `assume_in_transaction`.
- **The repo-wide "each file is a transaction" correction** (5 places) — a one-line docs PR, recorded
  in `tech-debt.md`. 2a only declines to add a sixth copy.
- **Consolidating the remaining catalog-verdict restatements** to two homes plus links — 2c.
- **Out-of-diff reuse debt**, recorded in `tech-debt.md` and charged to nobody: `verify.ts`'s
  `const UQ = 'uq_entries_profile_day_bodyweight'` re-typing the const `schema.ts` already exports, and
  `seed-ids.ts`'s three hand-typed copies of `SEED_PUBLIC_ID_PREFIX`.

## Open questions

**None blocking.** One the maintainer may want to overrule, and one left for 2c:

1. **The six-line read-side dark assertion.** Two lenses disagreed — scope called a source guard
   ceremony for a one-PR window; security showed the read half was genuinely uncovered and the claimed
   backstop false. Resolved by building the **six-line** version rather than the sixty-line one. If the
   preference is neither, delete the file and the risk row says "review-enforced".
2. **2c's answer for a referencing row whose `profiles.household_id` is NULL** (the tie-break has no
   answer for it). Flagged in the TEN-2c backlog row; it has no bearing on 2a.

## Review-response log (adversarial panel)

Panel: `correctness-reviewer`, `scope-reviewer`, `architecture-reviewer`, `reuse-reviewer`,
`db-safety-reviewer` (required — migration), `security-reviewer` (last leg of tenant isolation),
`privacy-reviewer` (the defect being fixed is one household's typed text reaching another).
**No UX panel: nothing in 2a is user-facing** — no route, component, copy or visible state.

Three lenses ran probes rather than reasoning, and their measurements are now load-bearing in the plan:
the index/arbiter matrix, the `NOT VALID` FK behaviour, and drizzle's migrator transaction scope. The
shape itself (nullable-forever, two partial indexes, global-first, plain `CREATE UNIQUE INDEX`,
`NOT VALID` FK, no backfill) survived all seven lenses; nearly every finding was about the **proofs**,
the **hand-off** and the **documents that promise a parent something**.

### Accepted — blocking

| #   | Lens                                                       | Critique                                                                                                                                                                                                                                                                                                                                                          | What changed                                                                                                                                                                                                                                                                                               |
| --- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | correctness · db-safety · scope                            | Test items (2)/(3) assert constraint names Postgres will never report while `movements_slug_unique` exists (OID order), and the draft's "hedge" pointed at a case it had itself called ambiguous — i.e. it was not a procedure.                                                                                                                                   | The three index facts collapsed into **one rolled-back transaction** after `DROP CONSTRAINT`. Also added the proof the draft lacked entirely: **test 2**, that the old constraint still binds.                                                                                                             |
| B2  | db-safety · correctness                                    | Draft test (3) **commits** a `household_id NOT NULL` row, directly falsifying the dark gate in the same section — and the tempting repair weakens the gate to `<= 1`.                                                                                                                                                                                             | Every non-NULL fixture is inside the rolled-back transaction, and **"no committed statement may set `household_id`"** is now an acceptance item, stated as the invariant the gate encodes.                                                                                                                 |
| B3  | db-safety · architecture                                   | "The 0012 idiom" is not a specification: `expectRejectedBy` closes over module-level `db` so it **hangs** inside a transaction on single-connection PGlite; a failed statement aborts the transaction (`25P02`) so three rejections cannot share one; and the rollback is **not** automatic — a callback that finishes **commits**.                               | All four mechanics specified: `tx`-aware `expectRejectedBy`, household id resolved before the transaction, nested `tx.transaction` savepoints per rejection, unconditional sentinel throw in `try/finally`. Plus: the drop must be `ALTER TABLE … DROP CONSTRAINT`, measured — `DROP INDEX` fails `2BP01`. |
| B4  | **correctness**                                            | 🔴 **The authorship discriminator was wrong.** `SEED_PUBLIC_ID_PREFIX` is the **global** seed namespace shared by every seeded table, so "inside the prefix" ≠ "is a movement seed row" — and it drove a **destructive** delete in 2b. The draft's own measurement table gave it away.                                                                            | Replaced with **exact set membership** in `MOVEMENT_SEED_ROWS`, exported once as `MOVEMENT_SEED_PUBLIC_IDS`. The reuse lens's `isSeedPublicId()` suggestion is **declined** for the same reason — it would enshrine the wrong test. A third assertion direction added. The single best catch of the panel. |
| B5  | db-safety                                                  | The FK — the plan's load-bearing safety claim — had **no** rejection proof, and nothing would catch a lost `NOT VALID` hand-edit, because `generate` emits the FK validated and the drift guard compares `schema.ts` to the snapshot, not the SQL.                                                                                                                | Both proofs added, and **2b flips `convalidated` to `true`**, turning the reminder into a red build.                                                                                                                                                                                                       |
| B6  | db-safety · security                                       | The migration header's lock argument was wrong three ways: `ADD COLUMN` holds `ACCESS EXCLUSIVE` (blocking **reads**) to COMMIT so the `SHARE` reasoning is irrelevant; `lock_timeout` bounds acquisition, not the build; and `households` is locked too and went unmentioned. `tech-debt.md` records the 1d review retracting this exact class of overstatement. | Header rewritten to the truth, with PGlite's inability to check it stated.                                                                                                                                                                                                                                 |
| B7  | **architecture**                                           | 🔴 `docs/plan.md`'s TEN-2b row specifies **household-first** — the order this plan rejects — and the draft's `plan.md` edit did not touch that sentence. A decision recorded only in a plan nobody re-reads is not a decision.                                                                                                                                    | 2a rewrites TEN-2b's resolution sentence and the `seedProgram` bullet to global-first.                                                                                                                                                                                                                     |
| B8  | **security**                                               | 🔴 Keeping the global UNIQUE through 2b creates a **cross-household denial primitive**: A can permanently deny B the ability to log any name A typed first (`23505` out of the writer).                                                                                                                                                                           | Analysed, found **structural** (both resequencings were considered and rejected with reasons), and resolved as a **named invite precondition** in `beta-1.md`, `SECURITY.md` and both backlog rows, **plus** a `23505` fallback in 2b so the control is not only prose.                                    |
| B9  | privacy · security (independently, and I had found it too) | The new FK **aborts the household-deletion runbook** (`23503`), the only erasure path in the repo; `runbooks.md` was not in the file list.                                                                                                                                                                                                                        | Added, then corrected by the architecture lens: the insertion point is **11** (not 12), with renumbering, the "12 DELETEs"→13 fix, the step-3 count-block row, the step-3 pre-flight, and the 2b→2c residual. Measured in PGlite that `NOT VALID` does not disarm the trigger.                             |
| B10 | reuse · architecture · scope (all three)                   | The "eleven files" list missed `apps/web/lib/dal/catalog.ts` (**twice**, one directly above `findOrCreateMovementId`), `docs/architecture.md` and `docs/features/programming.md` — and the acceptance grep matched two **immutable** files while missing the three variants, so it could never pass.                                                              | List corrected to 14 occurrences / 12 editable files; gate replaced with a **phrasing-tolerant** `git grep -E` excluding `docs/plans/` and `docs/changelog/`.                                                                                                                                              |

### Accepted — substantive

| #   | Lens                       | Critique                                                                                                                                                                                                                                                                                                                                        | What changed                                                                                                                                                                                                                                                                                         |
| --- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | security · architecture    | "Provable rather than declarable" was wrong, and a `db:verify` assertion is **weaker** enforcement, not stronger — PGlite never sees production. The invariant needs the prefix (or `pattern`), not the list, and `assertCheckCoversConst` is the existing idiom.                                                                               | 2c now gets **two layers**: a `NOT VALID` `CHECK (household_id IS NOT NULL OR pattern IS NOT NULL)` plus the exact set-membership proof. The "stronger than `NOT NULL`" claim is withdrawn as conflating predicate strength with enforcement.                                                        |
| S2  | reuse                      | The draft wrote a canonical phrase into eleven files while refusing a one-PR-lifetime test as ceremony — but 2b falsifies the phrase too. `tech-debt.md` already proposes the better shape.                                                                                                                                                     | **Two homes plus pointers.** 2b edits two files, not twelve, and the tech-debt entry shrinks instead of gaining a phrasing. A fair hit on an inconsistency in my own reasoning.                                                                                                                      |
| S3  | privacy                    | Production measurements were headed for the **unamendable** migration header; `data-inventory.md` §9 residual 2 is the repo already paying for that (a given name in `0012`'s comment).                                                                                                                                                         | Header carries a pointer, not numbers, with the standing rule stated. Internal ids and batch dates also dropped from the plan, and the measurement's provenance (aggregates only) recorded, since this plan sets the convention.                                                                     |
| S4  | privacy                    | `data-inventory.md` needed **five** edits, not one — it is a classification change; `notice.md` was unassigned across all three PRs; and household-authored movement text had **no retention row at all**.                                                                                                                                      | A whole section assigning all three, split 2a/2b/2c, including the `profiles.pin_hash`-shaped §2 row that arms the file's own re-review trigger.                                                                                                                                                     |
| S5  | privacy                    | The orphan-row correction needed four rules that do not exist: a second sanctioned deletion, never logging the free text, not resting on "unattributable", and ordering after 2b's writer fix.                                                                                                                                                  | All four written in. Deletion confirmed as the privacy-correct answer.                                                                                                                                                                                                                               |
| S6  | **correctness**            | The correction must be a **hard** `DELETE`, and the plan never said so — the registry's only delete precedent is **soft**, which would recreate the exact tombstone defect alternative 5 rejects.                                                                                                                                               | Stated explicitly with rule 8 cited, plus a hard constraint: nothing may set `movements.deleted_at` until the index predicate and resolver filter land together.                                                                                                                                     |
| S7  | correctness · security     | The 2c tie-break used a raw internal `household_id`, reintroducing precisely what TEN-1 1d removed; the clone's `public_id` and the repoint predicate were unspecified; and the clone is a **cross-tenant data copy** the draft framed as a naming nuisance.                                                                                    | Tie-break on `households.public_id`; fresh `newId()`; repoint through `inHousehold(scope)`; and 2c must either derive the clone's name or record the retained text as a named residual rather than leaving §4 reading as closed.                                                                     |
| S8  | **correctness**            | The anti-vacuity guard did not guard the stated risk: `count(*) > 35` is satisfied by extra rows from **any** source, including the plan's own probes. It worked only by luck.                                                                                                                                                                  | Guard is now **property-based**: at least one row outside `MOVEMENT_SEED_PUBLIC_IDS`.                                                                                                                                                                                                                |
| S9  | **correctness**            | The seed-growth hazard's deferral reason was wrong — household count is irrelevant, it splits a **single** household's history — and the guard was a 2b _task_, so a 2c landing first would create the rows it protects.                                                                                                                        | Reason restated ("no non-NULL `household_id` can exist before 2b") and the guard made a **precondition in 2c's acceptance** too.                                                                                                                                                                     |
| S10 | correctness · db-safety    | The verified arbiter fact has a mirror image the plan never drew: `ON CONFLICT (household_id, slug)` against only a partial index fails `42P10`, so the obvious 2b implementation breaks on the first custom movement; and 2c's drop + `db:seed` in the **same job** means one surviving bare arbiter wedges prod via the contract step itself. | Both written into 2b's and 2c's rows, the conflict-target sweep added to 2c's acceptance, and the sites enumerated **exactly** (the draft's "two or three" was itself the drift).                                                                                                                    |
| S11 | **architecture**           | Alternative 3's rejection reason was **false**: `entries` _is_ a two-parent tagged union with two real FKs and an at-most-one-of CHECK, so a future reader would reopen a settled decision on a bad premise.                                                                                                                                    | Replaced with three stronger reasons (expand→contract on the two largest tables, doubled declaration reads, permanent fragmentation, forked id space) and cited `entries` as the idiom deliberately not repeated.                                                                                    |
| S12 | **architecture**           | Alternative 6 is silently coupled to alternative 5's revisit condition: adding `deleted_at IS NULL` makes the predicate no longer implied, so **the FK loses its index**.                                                                                                                                                                       | The revisit condition is now three things in one change, and the coupling is in the migration and `schema.ts` comments. Alternative 6 also demoted from proof to reasoning, since PGlite will seq-scan a 35-row table.                                                                               |
| S13 | db-safety                  | "drizzle wraps each file in a transaction" is **wrong** (verified in 0.45.3's source: one transaction for the whole pending set), and the draft was about to add an eleventh copy — plus plain `SET` leaks timeouts across files.                                                                                                               | Corrected in the plan and the header, with the `SET`-vs-`SET LOCAL` choice made explicitly. The repo-wide fix (5 places) is recorded in `tech-debt.md` as its own one-line PR.                                                                                                                       |
| S14 | db-safety                  | The plan cited `0012` as the index precedent but imported none of its `DO $$` pre-check, without saying why none is needed.                                                                                                                                                                                                                     | Header now states why **neither build can raise `23505`** (subset / zero rows).                                                                                                                                                                                                                      |
| S15 | db-safety                  | "No restore branch required; cut one anyway" is the wrong call — it would hold a 7-day whole-database copy of minors' health data against a failure whose recovery is a `workflow_dispatch` re-run.                                                                                                                                             | Reversed, with the reasoning; **2c** cuts one.                                                                                                                                                                                                                                                       |
| S16 | reuse · architecture       | The two index names are load-bearing strings re-typed in `schema.ts`, three `verify.ts` assertions and 2b's conflict targets; `BODYWEIGHT_DAY_UNIQUE_INDEX` is the precedent.                                                                                                                                                                   | Exported as consts in 2a so 2b imports them — and this directly serves test 3's worry, since a typo then fails at compile time. The **predicates** stay SQL literals, and the docblock records why the asymmetry is deliberate.                                                                      |
| S17 | reuse                      | Test 1 re-implemented the `information_schema` nullability readback at its **second** consumer.                                                                                                                                                                                                                                                 | `columnCatalogShape` extracted beside `columnsOf`, with TEN-1 1a's inline block converted in the same PR.                                                                                                                                                                                            |
| S18 | reuse                      | The inline `-- squawk-ignore` lines are a third copy of a decision `.squawk.toml` records, diverge from `0012`, and would **pre-exempt** the two statements that should be re-reviewed if the rule is re-enabled.                                                                                                                               | Dropped.                                                                                                                                                                                                                                                                                             |
| S19 | reuse                      | `onConflictDoNothing` reads `where`, **not** `targetWhere` (verified in source) — so `docs/lessons.md` documents only the form 2b must **not** use.                                                                                                                                                                                             | 2b's bullet says `where:`, and 2a adds the missing half to `lessons.md`.                                                                                                                                                                                                                             |
| S20 | reuse · architecture       | The resolution rule and the seed hazard were written into five places including the forward-only migration — a rule with a stated expiry frozen into the one artifact that can never be corrected.                                                                                                                                              | Header keeps a one-line **constraint** plus a pointer; the rule's single home is this plan, pointed at from the backlog row.                                                                                                                                                                         |
| S21 | scope · security           | The risk row claimed test (5) gated a **reader**; it gates a writer, and the named `scoped.test.ts` backstop was also false (scope-presence, not column).                                                                                                                                                                                       | Risk row corrected, and the **six-line** read-side assertion added — security showed the hole was real, scope showed sixty lines was too much; six is the resolution.                                                                                                                                |
| S22 | scope                      | The plan was 543 lines for ~240 lines of hand-written diff, with one decision written three times and "seven proofs" where three existed.                                                                                                                                                                                                       | Alternatives 1/4/6 compressed, the CONCURRENTLY section cut, the resolution rule compressed, proof count stated honestly. (The plan then **grew** on net from the findings above; that is the trade I accepted — the measurements and the hand-off rules are the parts no reviewer can reconstruct.) |
| S23 | scope                      | The two "Open questions" were already decided and offering them as a menu costs maintainer time.                                                                                                                                                                                                                                                | Both converted to decisions.                                                                                                                                                                                                                                                                         |
| S24 | architecture               | `docs/spec.md` was absent from the file list with no stated exemption, though it is the data-model source of truth.                                                                                                                                                                                                                             | Added as a one-line edit.                                                                                                                                                                                                                                                                            |
| S25 | architecture · correctness | Stale cross-references after the test restructure, and `profiles.household_id` is **nullable** so 2c's "earliest referencing household" can resolve to NULL.                                                                                                                                                                                    | References renumbered; the NULL case flagged as an open question for 2c.                                                                                                                                                                                                                             |

### Pushed back

| #   | Lens         | Critique                                                                        | Why not                                                                                                                                                                                                                                                                                                                                                         |
| --- | ------------ | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | scope        | Drop test 3(c) (the cross-namespace pair) as 2c's acceptance smuggled in early. | **Declined**, and the reviewer half-conceded it. Without (c) nothing in 2a distinguishes the new indexes from the constraint they replace — tests 1–3 would pass against a migration that created no indexes at all. 2c's version is the same assertion through the **real resolver** with the constraint actually gone, which is a different claim.            |
| P2  | scope        | Move the eleven-file sentence correction to its own PR.                         | **Declined.** The migration is what makes the sentences false, and three are comments asserting a column does not exist directly above code that could now read one. `write-path.md` owns two of the paths, so `guides:check` forces that guide in this PR regardless. The reviewer reached the same conclusion on its own analysis.                            |
| P3  | reuse        | Export `isSeedPublicId()` from `catalog-seed.ts` as the discriminator's home.   | **Declined on the correctness lens's evidence**, which arrived separately: the prefix is the **global** seed namespace, so a prefix helper would enshrine a test that admits `seedPublicId('010')`. The reuse instinct was right, the predicate was not — the single home is `MOVEMENT_SEED_PUBLIC_IDS`. A good illustration of why the lenses run in parallel. |
| P4  | security     | Move `DROP CONSTRAINT` into 2b to close the denial window.                      | **Declined, with the analysis written into the plan.** Code deployed before 2b still says `ON CONFLICT (slug)`; dropping while it is live fails **every** free-text write (`42P10`). The window is structural, so it is resolved as a precondition plus 2b's fallback rather than by resequencing.                                                              |
| P5  | db-safety    | Split the indexes into their own migration.                                     | **Declined**, and the reviewer agreed on its own reasoning: separate files are not separate transactions, so splitting buys nothing and costs AGENTS.md's one-migration-per-PR rule.                                                                                                                                                                            |
| P6  | privacy      | Remove the production measurement table from the plan on exposure grounds.      | **Not required**, and the reviewer said so explicitly — no name, bodyweight, birthdate, `public_id` or email, and the slugs are from a public const. I did accept the narrower parts: internal ids and batch dates dropped, provenance recorded, and nothing in the migration header.                                                                           |
| P7  | architecture | Alternative 5's reason (a) ("2c's drop would quietly loosen a constraint").     | **Conceded and deleted** — the correctness lens made the same point. The partial indexes already loosen the constraint along the namespace axis, which is the point, so reason (a) was reasoning to a conclusion. Reason (b), the tombstone-returning resolver, carries the rejection alone.                                                                    |

### Still open for the maintainer

1. **The 2b→2c precondition is a schedule commitment, not code.** 2a writes it into `beta-1.md`,
   `SECURITY.md` and the backlog, and 2b's `23505` fallback degrades the failure — but the real control
   is that **the invite does not happen between 2b and 2c**. Worth an explicit nod before 2b starts.
2. **2c now owes more than the backlog row said**: a `NOT VALID` CHECK plus its `VALIDATE` in a
   following PR (so TEN-2 may be four PRs, not three), a prod-runnable dry-run reporter, and the clone's
   name decision. Flagged rather than silently absorbed.
3. **Whether the six-line read-side dark assertion is wanted at all** (open question 1).
