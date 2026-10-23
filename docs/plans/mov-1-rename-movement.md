# MOV-1 — a household renames its own mis-typed movement

> Backlog: none yet. MOV-1 is **unfiled** (spec → Unowned work 3); the row is filed in this work's PR
> (`docs/plan.md` is off-limits to the spec branch) · Spec:
> [crud-1-fix-it-yourself.md](../specs/crud-1-fix-it-yourself.md) chunk C4r · Milestone:
> [CRUD-1](../milestones/crud-1-fix-it-yourself.md) step 7 · Branch: `feat/mov-1-rename-movement`
> (staged as four PRs, below).
>
> **Revised after panel round 1** (engineering: correctness, scope, architecture, reuse, DB-safety;
> UX: lenses 1–3). The log is at the bottom. **One decision is the maintainer's and is open:**
> [Open question 1](#open-questions) — may a household relabel past rows, and by which act?

## Goal

Today a household that mis-types a movement has **no way to fix it in the app**.
[ADR 0008](../decisions/0008-deletion.md) makes `movements` unremovable "by decision" (`0008:78`) and
names "`TEN-2c-1` or a successor" as the owner. `TEN-2c-1` turned out to be a measured no-op (the
production census on 2026-10-13 found 35 rows and 0 household-owned, `docs/privacy/data-inventory.md:36-37`),
so the successor does not exist. The gap is latent today. It becomes live the day PICK-1 (C1) ships,
because "use what I typed" makes a household movement one tap away.

After MOV-1, a parent opens **Household settings → Movements your household added**, taps **Rename**,
types the right name and saves. Every past entry keeps its `movement_id`, and the name changes wherever
the household reads it. Only a row whose `movements.household_id` is the session's household can be
renamed. A shared catalog row (`household_id IS NULL`) is never reachable.

🔴 **The panel's blocking finding, stated first.** The case that motivates this work is **refused by
the rename this plan first drafted.** Both prototype fixtures (`docs/prototypes/crud-1/index.html:1451-1454`)
are a household row whose right name **is a catalog row**: "Bulgarian Split Squats" → "Bulgarian Split
Squat" (`packages/shared/src/catalog-movements.ts:186-188`), and "RDL" → "Romanian Deadlift"
(`catalog-movements.ts:171-172`). Both hit D3's `catalog_name` refusal. A household that typed both
spellings as **its own** rows hits `name_taken`. Both refusals point at C4m (merge), which the spec put
"later" because it _"changes past exports"_ (spec line 154). D1 below shows that **rename changes past
exports too**, so that reason no longer separates the two. Open question 1 is therefore one question,
and this plan recommends answering it by pulling a minimal merge (**MOV-1c**) into CRUD-1.

### Where this sits

- **Pillar:** Logging (the Movements track; spec → "Two milestones, five tracks", the `C` subgraph).
- **Milestone:** [CRUD-1 — Fix it yourself](../milestones/crud-1-fix-it-yourself.md), step 7, the last
  step of the Movements track.
- **This work is:** spec chunk C4r (rename), plus, if the maintainer agrees, a minimal C4m (MOV-1c).
- **Next:** CRUD-1 closes when steps 2, 5, E and 7 are done. Without MOV-1c, merge stays [later] and
  waits for Insight.

## What the code does today — the facts this plan rests on

1. **The CSV prints the movement's SLUG, read live at export time.** It does not print the name, and it
   does not print a snapshot. `strengthMonthRows` selects `movementSlug: schema.movements.slug` through
   the entry's `movement_id` (`packages/db/src/queries/export-month.ts:65`). `buildStrengthLog` writes
   `csvMovement(row.movementSlug)` (`packages/shared/src/csv/strength-log.ts:49`), which swaps `_` for
   `-` and nothing else (`packages/shared/src/csv/columns.ts:24-26`). The source is the slug, **never**
   `movements.name` (`columns.ts:18-19`), and the downstream workflow **groups by this exact string**
   (`columns.ts:13-16`).
2. **The slug is derived from the name once, at creation.** `movementSlug(name)` trims, lower-cases and
   turns whitespace into `_` (`packages/shared/src/movements.ts:34-36`). `findOrCreateMovement` writes
   `{slug, name}` from the same typed text (`packages/db/src/writers/movement-catalog.ts:68,92-97`).
   Nothing rewrites either. `slug === movementSlug(name)` is pinned for seed rows
   (`catalog-movements.ts:16,335-338`) and holds for household rows by construction.
3. **The free-text resolver keys on the slug, global-first** (`movement-catalog.ts:80-97`).
4. **Two partial unique indexes arbitrate the slug, one per namespace**
   (`packages/db/src/schema.ts:586-592`; names hoisted at `:451-452`). They are disjoint, so a household
   row may legally share a slug with a catalog row, and global-first then **shadows** it for typed text.
5. **The day page labels a strength entry from `entries.movement_name`, not `movements.name`**
   (`apps/web/lib/dal/entries.ts:132`, mapped at `:274`, returned by
   `apps/web/lib/entries/entry-label.ts:63-64`). The strength writer stores the **as-typed** text per
   entry (`packages/db/src/writers/strength-session.ts:181,354`). This is the column's only reader in
   `apps/web` and `packages/db/src` (grep, 2026-10-23).
6. **Program rows read `movements.name` live** (`packages/db/src/queries/program-day.ts:98`). The
   export's `prescribed` match keys on the **live** slug on both sides (`apps/web/lib/dal/export.ts:124,159`).
   `entries.prescribed_snapshot` holds `sets x reps @ load` and **no movement name**
   (`export.ts:126-130`; column at `schema.ts:205-218`), so no rename or merge can alter it.
7. **The three-part lift** (`schema.ts:538-542`) is the condition for setting `movements.deleted_at`.
   A rename sets no `deleted_at`.
8. **Name validation lives inside the log schema today.** `sessionMovementSchema.movementName` is trimmed,
   1..100, and rejects a comma or line break (`packages/shared/src/strength-session.ts:45-60`). PICK-1
   PR 2 adds an "at least one letter" refine there, using `hasALetter` from its new
   `packages/shared/src/movement-search.ts` (`docs/plans/pick-1-movement-picker.md:128-131,469,492`). The settled seams make PICK-1 PR 2 the home of
   `MOVEMENT_NAME_MAX` and `movementNameSchema` in `movements.ts`, with `hasALetter` in `text.ts`.
9. **The value-guarded amend is the precedent for a stale edit.** `editBodyweightSchema` carries
   `seenValue` (`packages/shared/src/bodyweight.ts:131-137`). One guarded `UPDATE`, then a re-read under
   the same scope to tell stale from not-found (`apps/web/lib/dal/entries.ts:518-540`; copy at
   `apps/web/lib/constants.ts:527-541`).
10. **The settled seams own name equality** (spec → "Seams the plans settled", 2026-10-23). `foldName`
    (accents, curly quotes, spaces, case) is PROF-1's, in `packages/shared/src/text.ts`. **The movement-name
    key** — "same movement" for the picker, a rename collision and CSV grouping — is PICK-1's, exported beside
    its search helpers; PICK-1's plan builds it on `movementNameKey`, which also folds hyphen/underscore and
    one trailing plural (`pick-1-movement-picker.md:200-219,507`). MOV-1 imports the key and defines no rule.

## The decisions

### D1 — A rename that changes the slug DOES change past CSV rows

The spec says a rename leaves the export's bytes unchanged (spec line 154). That holds only when the
slug does not change. The export does not read `movement_id`; it reads `movements.slug` through it
(fact 1).

| Rename                                                               | Slug changes?                                 | Past CSV `movement` cells                                                                                |
| -------------------------------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| case or spacing only (`rdl` → `RDL`)                                 | no                                            | **byte-identical**                                                                                       |
| underscore ↔ hyphen (`Bent over_rows` → `Bent-over rows`)            | **yes** (`bent_over_rows` → `bent-over_rows`) | **byte-identical** — `csvMovement` folds `_` to `-` (`columns.ts:24-26`), so both print `bent-over-rows` |
| a spelling fix (`Bulgarain Split Squats` → `Bulgarian Split Squats`) | **yes** (D2)                                  | every past month's cell for that movement changes on the **next** export                                 |
| a spelling fix with the slug frozen (D2's fallback)                  | no                                            | byte-identical, and the typo stays in the CSV forever                                                    |

The CSV contract says rows are _"chronological, append-only"_ (`docs/csv-export-contract.md:22`) and
the export must be byte-faithful (`:6-9`). A re-export is still deterministic (`export.ts:187`), but a
month the household already downloaded will differ from a new export of it. ADR 0005 decision 5
snapshotted `prescribed` (`schema.ts:205-218`) so that an authoring edit could not do this to the
column next door.

**What the plan cannot answer from the code (correctness S5):** whether the downstream workflow
**re-ingests** every month or appends only new ones. The contract describes files the workflow _reads_
(`csv-export-contract.md:6-9`) and calls them one file per athlete per month, append-only (`:22-25`).
If it re-reads whole months, a relabel reaches it consistently. If it only appends, old months keep the
old label and the two spellings split one movement's history, whichever act caused it. This is part of
Open question 1.

### D2 — The slug is recomputed from the new name

`slug := movementSlug(newName)`, in the same `UPDATE` as `name`.

The slug is the resolver's identity for typed text (fact 3). If it stayed frozen:

- typing the **corrected** name in "use what I typed" would derive a new slug, miss the renamed row and
  **mint a second household row**, which is the duplicate the rename was supposed to remove;
- typing the **old typo** would resolve to the renamed row silently, forever;
- `slug === movementSlug(name)` would fail on a live row for the first time. PICK-1's chunk-2
  reconcile relies on it (next paragraph).

**PICK-1's chunk-2 note, reconciled.** PICK-1's plan says _"C4r breaks the second half — a rename
changes `name`, not `slug` — so C4r's plan must switch that comparison to the movement id"_
(`pick-1-movement-picker.md:629-630`). The comparison is V1-22 chunk 2's `matchPrescribedSnapshot`,
which compares `movementSlug(movement.movementName)` with the prescription's slug. **Under D2 a rename
changes both, so `movementSlug(name) === slug` still holds for every household row** (`db:verify` case 1
asserts it), and that slug comparison stays correct after MOV-1 with no change. **Only if Open question 1
lands on the frozen-slug fallback** does the invariant break. MOV-1b would then switch that comparison
to the movement id, as PICK-1 says. Both outcomes are recorded in the movement-picker guide.

### D3 — Collisions use the picker's equality, and are refused rather than resolved

**The equality is PICK-1's movement-name key, never a second rule** (fact 10). A rename collides when
the key of the new name equals the key of **another** row. That covers slug equality, case,
curly apostrophes, hyphen against underscore (which `csvMovement` already prints identically) and one
trailing plural. A second, slug-only rule would let a household rename to `Bulgarian Split Squats` beside
the catalog's `Bulgarian Split Squat`. The picker would then show two rows that fold as "exact", and
"use as typed" would be hidden for both (`pick-1:219`).

| New name folds equal to…                                                       | DB says                                                     | MOV-1 answers                                                                                                                                                                                                |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **this row's own current name** (case, punctuation, hyphen/underscore, plural) | nothing                                                     | allowed **if no other row has the same key**. Only a slug-equal rename (case/spacing) skips the other checks; a plural or hyphen change is still checked against siblings and the catalog (Exemption, below) |
| **another row in this household**                                              | `23505` on `uq_movements_household_slug` only if slug-equal | `name_taken`, naming that row's display name (UX3 N1)                                                                                                                                                        |
| **a catalog row** (`household_id IS NULL`)                                     | nothing (the indexes are disjoint, fact 4)                  | `catalog_name`, naming the catalog row                                                                                                                                                                       |
| a row in **another** household                                                 | nothing                                                     | allowed and invisible. Namespaces are separate by design (TEN-2c)                                                                                                                                            |

**Why the catalog case is refused even though the database allows it.** A household "Bulgarian Split
Squat" beside the seeded one is unreachable by typed text (global-first). It would show up as a second
row in PICK-1's picker, and it would carry `is_bodyweight: false` and no `unit_default` where the seeded
row carries curated values (`movement-catalog.ts:18-24`). What the parent actually means is "these
entries are Bulgarian Split Squats", and that is a **merge**. See Open question 1.

**Exemption — slug-equal only, never key-equal** (round 2, blocking). The sibling and catalog checks are
skipped **only when `movementSlug(newName) === current.slug`**: a case or spacing fix, which cannot
change the slug and so cannot shadow or collide with anything new. A household row can already share a
slug with a catalog row (a CAT-2 seed added after the household typed it, the seed-growth hazard at
`schema.ts:497-501`), and refusing a case fix on it would block the parent for a reason the rename did
not cause. ⚠️ The exemption must **not** use the movement-name key: that key strips one trailing plural
`s` (`pick-1:207-208`), so "Bulgarian Split Squats" → "Bulgarian Split Squat" would be key-equal to its
own name, skip the catalog check, return `ok` and give the household row the catalog's slug
`bulgarian_split_squat`, contradicting M11. Independently of the key, a rename whose
`movementSlug(newName)` equals a catalog slug and differs from `current.slug` is **always**
`catalog_name`.

**How each check runs.**

- **The fold checks are deliberate pre-checks** (DB-safety N3). One read takes this household's rows
  and the catalog's `{publicId, name}`, which is 35 catalog rows plus the household's own, and compares
  folds in TypeScript. The read happens **before** the `UPDATE`, outside any transaction. Its race
  window is a seed adding a catalog row mid-rename (CAT-2's `db:seed`, which runs on merge to `main`).
  The outcome of losing that race is the shadowed state the seed-growth hazard already allows. Recorded,
  not engineered around.
- **The slug index is the race backstop** for two concurrent renames, or a rename racing
  `findOrCreateMovement` step 3 inserting the same slug. The writer catches `23505` **outside any
  transaction call**, because inside one, the abort poisons the transaction. The matcher is a small
  helper, `isUniqueViolationOn(err, MOVEMENT_HOUSEHOLD_SLUG_UNIQUE_INDEX)` in
  `packages/db/src/writers/unique-violation.ts`. It reads `(err.cause ?? err)`, then `.code === '23505'`
  and `.constraint === <the const>`. drizzle wraps the driver error as
  `DrizzleQueryError { query, params, cause?: Error }` (`packages/db/node_modules/drizzle-orm/errors.d.ts:9-14`).
  node-postgres's `DatabaseError` carries `code` and `constraint`; that is unverified in this repo
  because no live code catches a `23505` today (every grep hit is a docblock). **What proves what:**
  `db:verify` on PGlite proves the branch, including the helper inside an enclosing transaction. The
  node-postgres shape is proved by one `name_taken` path in the rename e2e spec under `pnpm e2e:local`,
  which runs on a real embedded Postgres. **MOV-1b owns that spec outright** (it is in MOV-1b's file
  table and its Definition of Done). **Until it lands, the node-postgres shape is unproven**, and nothing
  before MOV-1b depends on it.
- The caught error is **never re-thrown or logged**. Its message and `detail` carry the typed name
  (`Key (household_id, slug)=(…)`), and SEC-3's scrubber cuts only the `params:` tail
  (`apps/web/lib/sentry-scrub.ts:19-24,74`).

### D4 — Ownership: the household predicate excludes catalog rows by construction

Every lookup and the `UPDATE` use `public_id = $1 AND movementInHousehold(scope)`
(`packages/db/src/writers/ownership.ts:176-178`). `household_id = $n` is never true for `NULL`, so a
catalog row's public id is **not found**. That is the same answer, byte for byte, as an unknown id or
another household's row (ADR 0006's 404 rule; spec contract line 488-489). No new predicate is written. **PICK-1's movement-id resolver is deliberately not used here:** it
resolves global **or** this household's ids (spec → settled seams), and a rename must answer a catalog id
with not-found. The wire key is still `movementPublicId`, as the seams require.

### D5 — One guarded `UPDATE`, the amend precedent

There is no transaction and no row lock (scope S2, DB-safety S2). In order:

1. **Pre-read** `{name}` by `public_id AND movementInHousehold(scope)`. No row ⇒ `not_found`. If
   `current.name === name`, this is a replay or a no-op ⇒ `ok` with `previousName: seenName`, so a
   replay returns exactly what the first call returned, and **no write**. If
   `current.name !== seenName` ⇒ `stale`.
2. **Fold pre-checks** (D3) ⇒ `name_taken` / `catalog_name`.
3. **The guarded write:** `UPDATE movements SET name = $name, slug = movementSlug($name), updated_at = now()
WHERE public_id = $id AND movementInHousehold(scope) AND name = $seenName RETURNING public_id, name`.
   A `23505` ⇒ `name_taken` (D3).
4. **Zero rows** (something changed between 1 and 3) ⇒ re-read by the same predicate and classify: gone
   ⇒ `not_found`; `name === $name` ⇒ `ok` (a concurrent replay landed); otherwise ⇒ `stale`. This is
   `entries.ts:518-540`'s shape.

The `name = $seenName` conjunct is the guard. This meets AGENTS.md backend rule 6 the way the amends
do: a replay is one effect with an identical response, and no idempotency-key table is needed.
`movements` has no `client_id` (`schema.ts:544-566`).

**`seenName`'s bound is named:** `MOVEMENT_SEEN_NAME_MAX = 1000` in `packages/shared/src/movements.ts`.
It is not the name rule, because a legacy row may hold a name today's rule refuses, and the rename is
how that row gets fixed. The bound only caps the payload.

### D6 — The new name on the day page: its own PR, scoped to the entry's household

| Surface                                             | After a rename                                                                                                       |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| PICK-1's picker, program rows (`program-day.ts:98`) | the new name, because both read `movements.name` live                                                                |
| The CSV `movement` column                           | D1                                                                                                                   |
| The CSV `prescribed` column                         | unchanged. Both sides of the match read the live slug (`export.ts:124,159`), and the snapshot holds no name (fact 6) |
| **The day page's logged strength rows**             | **the old typo, unless the read changes** (fact 5)                                                                   |

**MOV-1a2 changes one read.** `listEntriesForDay` adds
`leftJoin(schema.movements, and(eq(schema.entries.movementId, schema.movements.id), movementInHousehold(scope)))`
and selects `ownedMovementName: schema.movements.name`. That value is non-null **only** for a movement
owned by the scope the query already filters on (`isLiveProfile(profilePublicId, scope)`,
`entries.ts:181`). A pure `movementDisplayName(ownedMovementName, entryName)` returns the first if
present, else the as-typed name.

**Why `movementInHousehold(scope)` in the join, and not `movements.household_id = profiles.household_id`
or a hand-typed `household_id is not null`** (correctness S2, DB-safety S4, architecture S1, reuse 4):

- The scoping must be to **this** household. Pre-TEN-2c cross-household references are data
  (`schema.ts:510-523`). An entry pointing at another household's row must never show that household's
  renamed text. An `is not null` test would show it.
- The helper is the single-sourced predicate, read from the one module allowed to touch
  `scope.householdId` (`packages/db/src/scope.test.ts`). An `eq(movements.householdId, profiles.householdId)`
  is a hand-built ownership predicate on a `profiles` column, which is exactly what
  `apps/web/lib/dal/scoped.test.ts` assertion 2 exists to fail.

**Why household-owned only.** An entry that resolved to a **catalog** row stores what was typed
(`box jump`). Switching those labels would change the text of past rows that no rename touched, and the
e2e locators key on that text. (MOV-1c, if approved, needs a wider rule. See its sketch.)

`entries.movement_name` is **not** rewritten (see Alternatives and Risks → privacy).

### D7 — The screen: the prototype's `movements` screen, rename only

This implements the approved prototype's **movements** screen (`vMovements`, `index.html:4301-4339`;
the rename form at `:4853-4863`; submit at `:5291-5297`; route `/settings/movements` at `:2007`; the
settings nav row at `:2298-2302`).

- `<h1>Movements your household added</h1>`, then a `<ul>` with one card per **household-owned**
  movement, **ordered by `created_at`** so a rename never moves a card (UX1 S5, UX2 #2). Each card has
  the name, "Logged N times", and an outline **Rename** button (`aria-label="Rename {name}"`).
- **A visible near-match line, never a dead button** (the maintainer's instruction): when the name folds
  "close" to a catalog or sibling row (PICK-1's `matchMovementOptions`), the card says
  `Looks like “Bulgarian Split Squat” in the app's list.` as plain text. Under answer (a) it becomes
  MOV-1c's **Merge into…** button. The prototype's `later` button (`:4323-4333`) does not ship.
- **Rename** swaps the card for a `<form>`: a labelled "New name" input (`INPUT_CLASS`,
  `apps/web/lib/constants.ts:287`; `enterKeyHint="done"`; prefilled; focused), the hint, then **one**
  `<p role="alert">` above the buttons holding the field error. The input's `aria-describedby` names
  both the hint and that `<p>`. Then **Save name** (`SAVING_LABEL` while pending, `constants.ts:499`)
  and **Cancel**. Ids come from `useId()` combined with the `publicId`, so two cards never share an id.
- **An unchanged name is Cancel** (UX1 N1): no request is sent and the card closes.
- **On `ok`:** the card shows its new name and a visible success line,
  `Renamed “{old}” to “{new}” · Undo`, and **focus moves to Undo** (UX3 S2). Undo calls the same action
  with `name = old, seenName = new`, so it is the same writer and the same guards. The line is the
  shared Undo component from PROF-1 PR b (e.g. `apps/web/components/undo-line.tsx`, spec → settled
  seams), not a new one. (UX1 S3, UX2 #2: the
  confirmation is visible, not only announced.)
- **On `stale` or `not_found`:** the card **closes to idle**, re-seeded from the server's props (the
  name now shown and `seenName` both come from the re-rendered page, never from client state), and the
  line reads `AMEND_ERROR_COPY.staleWrite` / the not-found refusal (UX1 S1, UX3 S3).
- **On a field error** (`name_taken`, `catalog_name`, schema): the form stays open with the error, and
  nothing is revalidated.
- **Focus and the ring:** the card is `tabIndex={-1}` with the receipt's ring classes
  (`apps/web/app/p/[profileId]/bodyweight-receipt.tsx:69-70`). Cancel returns focus to that card's
  Rename button. (The prototype refocuses the first card, `:4864-4865`, which is a bug.)
- **Empty state** (UX1 S3): `Nothing here yet. When someone logs a movement that isn't in the app's
list, it appears here so you can fix its name.` The settings nav subtitle counts the rows:
  `{n} — rename a typo`, or `None yet` when there are none.
- **Deep link** (UX1 S4): `/settings/movements?rename=<publicId>` opens that card in editing state. The
  param is validated as a UUID and ignored if unknown. MOV-1b edits PICK-1's "use what I typed" hint
  (`pick-1:405-413`, which defers it to C4r) to `Added to your household's list when you save. You can
rename it later in Household settings.`
- **Wrapping:** `[overflow-wrap:anywhere]` on the name, the error, the success line and the nav
  subtitle. The back link and the nav rows are `min-h-11`, and a test asserts their height.

**Copy that depends on Open question 1** (UX3 S1, correctness S5; never "replaces" or "removes", UX3 N2):

- (a) or rename-relabels approved: hint = `All {N} past entries will show as “{new}”. Exports made from
now on use “{new}” for them too.`
- frozen-slug fallback: hint = `All {N} past entries will show as “{new}” in the app. Exports keep the
name they were logged with.`

**Departures from the prototype**, for the UX panel's round 2: no `later` button (D7, second bullet); a
blank rename is refused (the prototype keeps the old name silently at `:5293`; spec IXD-7, line 1088
decided "refused"); Cancel focuses its own card; Undo exists (the prototype has none).

**360px width math.** 360 − page gutter `px-4` (2×16) = 328. Card `px-4` (2×16) + border (2×1) ⇒
**294px** of content, matching the spec's measurement at 360px (spec → disagreement 6). The name has its
own line and wraps. **Rename** = `px-2.5` (2×10, `apps/web/components/ui/button.tsx:36-37`) + about 52px
of text ⇒ about 72px, 44px tall (`min-h-11` in the base class, `:10-20`). Edit state: the input is
`w-full` at 294. **Save name** ≈ 86, **Cancel** ≈ 66, `gap-2` 8 ⇒ **160 ≤ 294**. The success line
`Renamed “…” to “…” · Undo` wraps at the quoted names, and Undo is its own `min-h-11` button. The glyph
widths are estimates at 14px Geist. The claim is the 134px of slack, and MOV-1b's 390px screenshots
confirm it.

### D8 — Where the files go

- **The action module is `app/p/movement-actions.ts`** (architecture B1, reuse 3) — the module the spec's
  settled seams assign to MOV-1, beside PROF-1's `app/p/profile-actions.ts` (spec → "Seams the plans
  settled", first row; WP-1 owns the list). ⚠️ **WP-1's plan as written** (`docs/plans/wp-1-shard-actions.md:145`)
  names the module set without `movement-actions.ts`; the seams table supersedes it, and MOV-1b adds the
  module to `write-path.md`'s set and `owns:` if WP-1 has not.
- **The registry:** `MUTATING_ACTIONS.renameMovementAction = { refusal: NO_MOVEMENT_FOUND, scope:
ACTION_SCOPE.household }` (WP-1's shape, `wp-1:155-160`). Test side:
  `ACTION_BINDINGS.renameMovementAction = { fn, writers: [renameMovement] }` and a `VALID_BODY` entry,
  so WP-1's unauth suite, household suite and byte-identical-refusal check cover it with **no** local
  copy (`wp-1:173-183`).
- **The refusal** is `NO_MOVEMENT_FOUND = AMEND_ERROR_COPY.notFound('movement')`, placed in
  `apps/web/lib/constants.ts` immediately after `AMEND_ERROR_COPY` (`:527-541`), beside `NO_PROFILE_*`
  (`:516-519`). It lives there and not in a feature module because the registry and the matrices import
  it, which is the same reason the profile refusals were promoted (`constants.ts:500-515`).
- **`SETTINGS_MOVEMENTS_PATH = '/settings/movements'`** goes in `lib/constants.ts` beside PROF-1's
  `SETTINGS_PATH` (`prof-1:286,430`). It has two consumers: the settings nav row and PICK-1's hint link.
- **`/settings` belongs to PROF-1b** (`prof-1:93,425`), so **MOV-1b is gated on milestone step 2.** The
  fallback that had MOV-1b create the page, and the open question about it, are deleted (scope S3,
  reuse 2). MOV-1b adds one nav row to PROF-1b's page.
- **Guides.** The settings files (`app/settings/movements/**`) join **whichever guide PROF-1b puts
  `/settings` under** (architecture S6). That is noted for PROF-1's reconcile. If PROF-1b creates none,
  MOV-1b records that four `/settings` files across two steps now meet the guide bar. Feature copy goes
  in `apps/web/lib/movements/movement-picker-copy.ts`, which is under PICK-1's new `movement-picker.md`
  (`pick-1:498`), so MOV-1b edits that guide.
- **`ActionState` and `useOnActionSuccess` live under `app/p/[profileId]/`**
  (`apps/web/app/p/[profileId]/use-on-action-success.ts:20-21`). WP-1 does not move them (`wp-1:139-148`,
  grep). PROF-1 already imports them from outside that folder (`prof-1:272-273`). If they have not moved
  by MOV-1b, its **first commit** moves both to `apps/web/lib/actions/`, with every import updated and no
  re-export (reuse 5).

## Acceptance

⚠️ **The spec has no acceptance criterion tagged C4r** (its Movements block ends at 20, spec lines
292-306). These are this plan's, and the PR proposes adding them to the spec.

- **M1.** **When** a parent renames a movement owned by the session's household to a valid name, the
  system **shall** update `name` and set `slug = movementSlug(name)` in one statement, and **shall not**
  change `id`, `public_id`, `household_id`, any `entries.movement_id`, `prescriptions.movement_id`,
  `entries.movement_name` or `entries.prescribed_snapshot`.
- **M2.** **If** the id is unknown, belongs to another household, or names a catalog row, **then** the
  system **shall** return `NO_MOVEMENT_FOUND` byte-identically and write nothing.
- **M3.** **If** the new name, trimmed, is empty, longer than 100 characters, has no letter, or contains
  a comma or a line break, **then** a field error, and nothing is written. The rule has one definition,
  shared with the log path.
- **M4.** **If** the new name has the same movement-name key (PICK-1's) to another row in the
  household, **then** `name_taken` naming that row. **If** it folds equal to a catalog row and not to
  the row's own current name, **then** `catalog_name` naming the catalog row. Either way nothing is
  written.
- **M5.** A replayed submit applies once and returns the same result. A stale `seenName` returns
  `AMEND_ERROR_COPY.staleWrite` and writes nothing.
- **M6.** After a rename, past entries on the athlete's day page show the new name. Entries on catalog
  movements, and entries on another household's movement, render exactly as before.
- **M7.** After a rename, typed text **whose `movementSlug` equals the new slug** resolves to the renamed
  row (`findOrCreateMovement` is slug-exact). A fold-equal variant (a plural, say) still mints a new row
  on the free-text path; PICK-1's picker is what offers the existing row instead (correctness N1).
- **M8.** No MOV-1 code path sets `movements.deleted_at`.
- **M9.** (Depends on Open question 1.) A re-export after a slug-changing rename prints the new slug in
  every month, and `prescribed` is unchanged.
- **M10.** At 360px, every control is ≥44px, the screen is keyboard-only operable, the field error is
  tied by `aria-describedby`, and focus moves on open, save, Undo, cancel and refusal.
- **M11 — the prototype's two fixtures, as named cases** (`index.html:1451-1454`):

  | Fixture                                                                          | Parent types            | Under (a): rename + MOV-1c merge                                                                                                                                                                    | Under (b): rename only, merge stays later                                                                            |
  | -------------------------------------------------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
  | **"Bulgarian Split Squats"**, 2 uses, near the catalog's "Bulgarian Split Squat" | "Bulgarian Split Squat" | the card already says "Looks like “Bulgarian Split Squat” in the app's list" with **Merge into…**. The rename field answers `catalog_name` and points at that button. Merging relabels both entries | `catalog_name`, copy (b) below. Both entries keep showing "Bulgarian Split Squats"                                   |
  | **"RDL"**, 1 use, near the catalog's "Romanian Deadlift"                         | "Romanian Deadlift"     | as above, with **Merge into “Romanian Deadlift”…**                                                                                                                                                  | `catalog_name`, copy (b). The parent can still rename to anything that does not fold equal, e.g. fix a typo in "RDL" |

**Fallback copy (b)** — used if merge stays later. It names the existing row and gives the next step,
and it **never suggests a near-variant** to slip past the check:

- `catalog_name`: `“Bulgarian Split Squat” is already in the app's list, so this one can't take that
name. Your 2 past entries stay as they are for now. Next time, pick “Bulgarian Split Squat” from the
list when you log.`
- `name_taken`: `You already have “Bulgarian split squat”. The two can't share a name yet. Keep using
whichever one you pick from the list.`

## Staging

| PR          | What                                                                                                                                                                                                           | ~lines src / tests | Gate                                                                                                                            |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| **MOV-1a**  | `packages/` only: `movementRenameSchema` (importing PICK-1's `movementNameSchema`), the writer, `isUniqueViolationOn`, the household-movements read, `db:verify` "MOV-1", mutation patch 07, `architecture.md` | 190 / 190          | **C1 (PICK-1 PR 2 + PR 3) merged** — PR 2 lands `movementNameSchema`, PR 3 the movement-name key                                |
| **MOV-1a2** | `apps/web`: the day-label read (D6) and its pure helper, alone                                                                                                                                                 | 40 / 60            | C1. It has no dependency on MOV-1a, so it may go first. It collides on `lib/dal/entries.ts` and `write-path.md` (gate 1, below) |
| **MOV-1b**  | `apps/web`: the DAL, `movement-actions.ts`, the registry rows, `/settings/movements`, the form, copy, PICK-1's hint, tests, docs                                                                               | 380 / 300          | MOV-1a + MOV-1a2 + **milestone step 2 (PROF-1b, `/settings`)** + **WP-1** + **AUTH-1 1c landed** + **Open question 1 answered** |
| **MOV-1c**  | _Proposed, only under answer (a)._ Merge into an existing catalog or sibling row. Sketch below; it gets its own plan and both panels                                                                           | ~300 / ~300        | MOV-1b + the maintainer's (a)                                                                                                   |

No PR has a migration. **Gate-1 collisions to list in the milestone's gate run:** `lib/dal/entries.ts`
and `write-path.md` (MOV-1a2 against track E, B1 and PICK-1), `app/settings/**` and
`lib/constants.ts` (MOV-1b against PROF-1b), and `movement-picker.md` (MOV-1b against PICK-1/PICK-2).

### MOV-1c — merge into an existing row (sketch, not a plan)

This is the spec's own answer to U18 (spec line 995): _"Merge behind a confirm naming the count, the
target and the export effect."_

- **Action** `mergeMovementAction { sourcePublicId, targetPublicId, seenSourceName, seenUses }`, in the
  same module. Household scope. The source must be `movementInHousehold(scope)`. The target is either a
  catalog row or another row in the same household, and is never the source.
- **Writer**, in one transaction: `UPDATE entries SET movement_id = target` for every entry, hidden ones
  included, whose profile is `inHousehold(scope)` and whose `movement_id = source`. The same update runs
  on `prescriptions` through the household's `program_blocks`. It is guarded by `seenUses` (the count
  the confirm showed), so a mismatch is `stale`. Replay is safe: a second run moves zero rows and
  returns the same result.
- **The source row afterwards** is the open question MOV-1c's plan must settle. Hard-deleting it once
  it is unreferenced is "removal", which ADR 0008's rule allows **only by a correction**
  (`0008:83-84`). So either ADR 0008 is amended for this one case, or the source stays with 0 uses and
  the list hides rows with zero uses.
- **Labels:** after merging into a **catalog** row, D6's household-only rule would show the as-typed
  typo again. MOV-1c widens the rule to "use `movements.name` when `movementSlug(entries.movement_name)
≠ movements.slug` and the movement is the household's own or the catalog's". That is still scoped, and
  it is still byte-identical for every untouched catalog entry.
- **Confirm sheet** (U0): `Merge “{source}” into “{target}”? Its {N} past entries will show as
“{target}”, and exports made from now on list them as “{target}”. This can't be undone in the app.`
  (Undo is MOV-1c's own question.)
- **Size:** about 300 lines of source plus about 300 of tests (writer, `db:verify`, action, sheet). It
  needs the DB-safety lens because it is a multi-row repoint, and the privacy lens.

## File-by-file changes

### MOV-1a

| Path                                                                          | Change | What & why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared/src/movements.ts`                                            | EDIT   | `MOVEMENT_SEEN_NAME_MAX` and `movementRenameSchema`. **`MOVEMENT_NAME_MAX` and `movementNameSchema` are PICK-1 PR 2's** (spec → settled seams; earlier drafts had MOV-1a extract them — scope S4 / reuse 6 resolved by the seams table) and are imported, not redefined.                                                                                                                                                                                                                                          |
| `packages/db/src/writers/movement-rename.ts`                                  | NEW    | `renameHouseholdMovement(exec, scope, input)`, the four steps of D5. Fold checks call PICK-1's movement-name key. No throw interpolates `name` or `slug` (`movement-catalog.ts:58-61`).                                                                                                                                                                                                                                                                                                                           |
| `packages/db/src/writers/unique-violation.ts`                                 | NEW    | `isUniqueViolationOn(err, constraint)`, D3's matcher. It is named so the next `23505` catch does not hand-roll the `cause` unwrap.                                                                                                                                                                                                                                                                                                                                                                                |
| `packages/db/src/queries/household-movements.ts`                              | NEW    | `householdMovementRows(db, { scope })` → `{ publicId, name, uses, createdAt }[]`, ordered `created_at, id`. The **docblock says why `uses` is not `movement-ownership.ts`'s "referenced"** (architecture S4, reuse 8). The census counts every FK reference, unscoped, hidden rows and prescriptions included, to answer a cross-tenant question (`packages/db/src/queries/movement-ownership.ts:8-30`). `uses` counts **live entries on live profiles in this household**, which is what "Logged N times" means. |
| `packages/db/src/index.ts`                                                    | EDIT   | Export the three, beside `writers/movement-catalog` (`index.ts:26-31`).                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `packages/db/scripts/verify.ts`                                               | EDIT   | A "MOV-1" section **placed after every assertion an existing `.expect` file names**, so patches 01–06 still redden their own first assertion (DB-safety S3).                                                                                                                                                                                                                                                                                                                                                      |
| `packages/db/scripts/mutations/07-rename-ignores-household.patch` + `.expect` | NEW    | The patch drops `movementInHousehold(scope)` from the writer's `UPDATE`. `.expect`: `MOV-1: a catalog row's public id is not found, and the row is unchanged`.                                                                                                                                                                                                                                                                                                                                                    |
| `packages/db/scripts/mutations/README.md`                                     | EDIT   | Row 07 in the table (`README.md:21-28`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `docs/architecture.md`                                                        | EDIT   | §4 (data model, `:263`): "a household row's slug follows a rename; a catalog row's never changes". Plus one Mermaid flowchart, "Rename a household movement", showing pre-read → fold checks → guarded `UPDATE` → classify (architecture S3). The PR description embeds the same view.                                                                                                                                                                                                                            |
| `docs/features/write-path.md`                                                 | EDIT   | Owns `writers/`. `owns:` += `packages/db/src/queries/household-movements.ts` (architecture S5). Files rows. Traps: a rename recomputes the slug, which the export and resolver both follow; the first `23505` catch and why it runs outside a transaction and is never re-thrown.                                                                                                                                                                                                                                 |

```text
packages/shared
  movementRenameSchema   { movementPublicId: uuidSchema, name: movementNameSchema,
                           seenName: z.string().max(MOVEMENT_SEEN_NAME_MAX) }
packages/db  writers/movement-rename.ts
  RenameMovementResult =
    | { ok: true;  publicId: string; name: string; previousName: string }
    | { ok: false; reason: 'not_found' | 'stale' }
    | { ok: false; reason: 'name_taken' | 'catalog_name'; conflictName: string }
```

`seenName` is **additive to the spec's contract** (`movementRenameSchema { movementPublicId, name }`,
spec line 488). Without it the server cannot tell a replay from a stale write.

### MOV-1a2

| Path                                                           | Change | What & why                                                                                                     |
| -------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------- |
| `apps/web/lib/dal/entries.ts`                                  | EDIT   | D6's scoped `leftJoin` and `ownedMovementName`, mapped at `:274` through the helper. No new `WHERE` predicate. |
| `apps/web/lib/entries/movement-display-name.ts` (+ `.test.ts`) | NEW    | The pure rule.                                                                                                 |
| `docs/features/write-path.md`                                  | EDIT   | Traps: the day label is the movement's name for the household's own movements, and as-typed otherwise.         |

### MOV-1b

| Path                                                                       | Change     | What & why                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/lib/dal/movements.ts`                                            | NEW        | `server-only`. `listHouseholdMovements()` → `HouseholdMovementDTO { publicId, name, uses, near: { name, owner } \| null }`, where `near` is computed with PICK-1's `matchMovementOptions`. `renameMovement(input)`. Each resolves `getHouseholdScope()`; null ⇒ `[]` / `not_found`.                                                                                                                                   |
| `apps/web/app/p/movement-actions.ts`                                       | NEW        | `'use server'`; `renameMovementAction`: boundary call first, Sentry wrap inside the body (`actions.ts:53-62`; no `formData`, no `headers`), zod, DAL. **Revalidate on `ok`, `stale` and `not_found`, never on a field error** (correctness S1, UX1 S1). Targets: `SETTINGS_MOVEMENTS_PATH` and `revalidatePath('/p/[profileId]', 'page')`.                                                                            |
| `apps/web/app/p/[profileId]/mutating-actions.ts`                           | EDIT       | The registry entry (D8).                                                                                                                                                                                                                                                                                                                                                                                              |
| `apps/web/app/p/[profileId]/actions.test.ts`                               | EDIT       | `ACTION_BINDINGS` and `VALID_BODY` rows only. WP-1's matrices then cover unauth, household refusal and byte-identity.                                                                                                                                                                                                                                                                                                 |
| `apps/web/app/p/movement-actions.test.ts`                                  | NEW        | **Rename-specific only:** stale, `name_taken`, `catalog_name`, replay, one bad body (blank) as the mandatory zod case, and the revalidation targets per outcome.                                                                                                                                                                                                                                                      |
| `apps/web/app/pages-are-gated.test.ts`                                     | EDIT       | The pinned module list (`:228`) += `app/p/movement-actions.ts`.                                                                                                                                                                                                                                                                                                                                                       |
| `apps/web/app/settings/movements/page.tsx`                                 | NEW        | RSC, gated (1c's page check). Reads `?rename=`. `<h1>`, `<ul>`, empty state, a back link to `SETTINGS_PATH` (`min-h-11`).                                                                                                                                                                                                                                                                                             |
| `apps/web/app/settings/movements/rename-movement-form.tsx` (+ `.test.tsx`) | NEW        | The client island per card (D7). Component test (UX2): focus on open, cancel, save and Undo; `aria-describedby` names hint and error; two cards render with no duplicate ids; an unchanged name sends nothing; after a stale refusal the card is idle with the server's name.                                                                                                                                         |
| `apps/web/app/settings/page.tsx`                                           | EDIT       | PROF-1b's page: one nav row to `SETTINGS_MOVEMENTS_PATH` with the count-aware subtitle.                                                                                                                                                                                                                                                                                                                               |
| `apps/web/lib/constants.ts`                                                | EDIT       | `NO_MOVEMENT_FOUND`, `SETTINGS_MOVEMENTS_PATH` (D8).                                                                                                                                                                                                                                                                                                                                                                  |
| `apps/web/lib/movements/movement-picker-copy.ts`                           | NEW        | `MOVEMENT_RENAME_COPY`: `nameTaken(conflict)`, `catalogName(conflict, uses)`, `renamed(old, new)`, `hint(uses, new)` per Open question 1, `empty`, `near(name)`. It reuses `AMEND_ERROR_COPY.staleWrite`.                                                                                                                                                                                                             |
| PICK-1's `apps/web/lib/movements/picker-copy.ts`                           | EDIT       | The "use what I typed" hint gains the rename sentence and link (`pick-1:405-413`).                                                                                                                                                                                                                                                                                                                                    |
| `apps/web/lib/actions/{action-state,use-on-action-success}.ts`             | MOVE       | Only if not already moved (D8, reuse 5).                                                                                                                                                                                                                                                                                                                                                                              |
| `apps/web/e2e/a11y.spec.ts`, `apps/web/e2e/<rename>.spec.ts`               | EDIT / NEW | **Owned by MOV-1b** (written in that PR; this plan file only specifies it). `/settings/movements` in `ROUTES` (`a11y.spec.ts:73`) with a fixture household movement whose name is **100 characters with no break**. The fixture is created by logging one set through the form in setup. Scans idle, editing and error at `NARROW` (`:69`). The rename spec includes one `name_taken` path, D3's real-Postgres proof. |
| `docs/features/write-path.md`                                              | EDIT       | Module set and `owns:` += `app/p/movement-actions.ts`; the DAL module.                                                                                                                                                                                                                                                                                                                                                |
| `docs/features/movement-picker.md`                                         | EDIT       | It owns `lib/movements/`. Record the copy, the hint change, and D2's PICK-1 reconcile.                                                                                                                                                                                                                                                                                                                                |
| `docs/privacy/data-inventory.md`                                           | EDIT       | `movements` row (`:131`): a rename overwrites `name` and `slug` in place, and **the as-typed text survives in `entries.movement_name`**, no longer shown.                                                                                                                                                                                                                                                             |
| `docs/csv-export-contract.md`                                              | EDIT       | Only under the relabel answer: the `movement` column follows a household's rename on the next export.                                                                                                                                                                                                                                                                                                                 |
| `docs/changelog/<fragment>.md`, `docs/status.md`                           | NEW / EDIT | Per AGENTS.md.                                                                                                                                                                                                                                                                                                                                                                                                        |

## Test plan

**`packages/shared`.** `movementNameSchema`: trims; rejects `''`, `'   '`, 101 characters, a comma,
`\n`, `\r` and an emoji-only name (no letter); accepts `30" Box Jump` (`strength-session.ts:50-51`). The
schema is PICK-1's; MOV-1a only asserts `movementRenameSchema` composes it (one rule, two callers).

**`db:verify` "MOV-1"** runs `renameHouseholdMovement` itself, with two households and the catalog:

1. Own row renamed: `name` and `slug` updated, and `slug === movementSlug(name)`. `id`, `public_id`,
   `household_id`, the entry count, `entries.movement_name` and `prescribed_snapshot` are all unchanged.
2. A catalog row's public id ⇒ `not_found`, and the row is unchanged. Patch 07 makes this red.
3. Household B's row from A's scope ⇒ `not_found`, unchanged.
4. Folds equal to a sibling: slug-equal (`rdl` beside `RDL`), hyphen/underscore (`Bent-over Rows` beside
   `bent over_rows`) and plural ⇒ `name_taken` with `conflictName`. Both rows are unchanged.
5. Folds equal to a catalog row (`Bulgarian Split Squat`, `Romanian Deadlift`, the M11 fixtures) ⇒
   `catalog_name`. **Including the plural-strip trap:** the household row "Bulgarian Split Squats",
   renamed to "Bulgarian Split Squat", ⇒ `catalog_name`, and the row's `slug` is still
   `bulgarian_split_squats` (round 2).
   5b. **Plural to a sibling:** household rows "Box Jumps" and "Box Jump"; renaming a third row "Box Jumpz"
   to "Box Jumps" ⇒ `name_taken` from the **pre-check**, asserted with the `23505` path unreached (the
   writer's catch is spied and not called), so the result does not lean on the backstop.
6. A row that already shares a catalog **slug**, renamed by case only (slug unchanged) ⇒ `ok` (the D3
   exemption).
7. Stale `seenName` ⇒ `stale`, unchanged. A replay ⇒ `ok`, and the replay's result **deep-equals** the
   first call's, `previousName` included. `updated_at` is unchanged.
   **This is the one-effect proof.**
8. **The `23505` backstop:** `isUniqueViolationOn` returns true for an insert colliding on
   `uq_movements_household_slug` **inside an enclosing `db.transaction`**, and false for another
   constraint. This proves PGlite's error shape only (D3).
9. After case 1, `findOrCreateMovement(newName)` returns the renamed id with no new row, and
   `findOrCreateMovement(oldName)` mints a new row. That is recorded behaviour, not a goal.
10. **What the export reads, pinned** (honest wording, DB-safety N2 / correctness N2): after case 1,
    `strengthMonthRows` returns the **new** slug for an entry on the renamed movement. This proves
    current behaviour and approves nothing. With a hand-seeded prescription on a household movement
    (no household programs exist before PROG-1 D2), the `(day_role, slug)` key still matches
    `programDayRows`.
11. Undo round trip: rename A→B, then B→A with `seenName = B` ⇒ the row's `name` and `slug` are back to
    the originals.
12. No `movements` row has `deleted_at` set.

**`db:mutations`:** patch 07 is red on case 2 (`pnpm verify`).

**`apps/web` (vitest).** WP-1's matrices cover unauth, household refusal and byte-identity through the
registry. `movement-actions.test.ts` covers the rename-specific cases: stale ⇒ `staleWrite` and both
paths revalidated; `name_taken` / `catalog_name` ⇒ a field error naming `conflictName` and **no**
revalidation; one blank body ⇒ zod field error with the DAL not called; `ok` ⇒ both named paths
revalidated. **The replay test is honest about its reach** (correctness N2): with the DAL mocked, it
proves the action passes an identical result through twice. The one-effect claim is `db:verify` case 7.
`movement-display-name.test.ts` covers: owned ⇒ the movement's name; catalog ⇒ as-typed; **owned by
another household ⇒ as-typed** (the join returns null); no movement ⇒ as-typed. Then the form's
component test (MOV-1b table). `pages-are-gated`, `use-server-exports` and `scoped.test.ts` cover the
new module and DAL.

**e2e and screenshots (MOV-1b):** `pnpm e2e:local` runs the rename spec and the a11y scan.
`screenshot:ephemeral /settings/movements` at three widths: idle, editing, field error, success with
Undo, and the **empty state**.

## AUTH-1 — what MOV-1b re-verifies once 1c lands

AUTH-1 1a, 1b-bis and 1c-pre have shipped. 1b, 1c and 1d have not, and 1c is the one-way door
(`docs/plans/auth-1-clerk-google.md:543-550`). MOV-1b adds one action and one page beyond 1c's 12
entry points (`auth-1-clerk-google.md:549`), so it is written after 1c. Before starting it, re-read:

1. `pages-are-gated.test.ts`'s `BOUNDARY_CALL` (`:217`). 1c switches it and must not widen it. The
   action's first line uses what it now asserts, and the page uses 1c's replacement for
   `requireGatedPage()`.
2. `getHouseholdScope()`'s new body. A session with no membership ⇒ `null` ⇒ `NO_MOVEMENT_FOUND` / an
   empty list, and 1c's no-household screen comes first.
3. 1c's mutation limiter (`lib/rate-limit.ts:13-17` defers it to Clerk). The new action is limited the
   same way, through whatever list 1c uses.
4. WP-1's registry and household suite as they stand after 1c (`wp-1:226`).
5. `lib/constants.ts`, which 1c edits. MOV-1b's two constants rebase onto it.

MOV-1a and MOV-1a2 touch no AUTH-1 file.

## Alternatives considered

| Alternative                                                               | Rejected because                                                                                                                                                                                          |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Freeze the slug; change `name` only**                                   | D2. It is the **fallback** if the maintainer refuses relabelling, with its costs stated, and it then forces PICK-1's id switch.                                                                           |
| **Export the per-entry snapshot** (`movementSlug(entries.movement_name)`) | It changes the export's source to avoid changing its bytes, and it splits one movement's history at the rename date, which is worse for the grouping the workflow does (`columns.ts:13-16`).              |
| **Rewrite `entries.movement_name`** too                                   | A bulk `UPDATE` of log rows, bumping `updated_at` that v1.5's LWW sync will compare (`schema.ts:37`), to change a column only the day label reads. D6 reaches the same screen with no write to `entries`. |
| **Label every entry from `movements.name`**                               | It changes past rows no rename touched, and the e2e locators.                                                                                                                                             |
| **Slug-only collision checks**                                            | They pass a rename the picker would treat as an exact duplicate (D3). PICK-1's fold is the one rule (`pick-1:507`).                                                                                       |
| **A transaction with `SELECT … FOR UPDATE`** (the first draft)            | A guarded `UPDATE` plus a re-read does the same with no lock and no precedent to invent (`entries.ts:518-540`), and a `23505` inside a transaction would abort it (scope S2, DB-safety S2).               |
| **Catch `23505` without a helper**                                        | The `cause` unwrap is the part that differs between PGlite and node-postgres. One helper is one place to get it right.                                                                                    |
| **Allow a rename onto a catalog name**                                    | It is a merge in disguise and creates a shadowed duplicate (D3).                                                                                                                                          |
| **Ship the prototype's `later` merge button**                             | A control that does nothing reads as broken. The near-match line carries the information.                                                                                                                 |
| **Put the action in `app/p/[profileId]/actions.ts`**                      | It is household-addressed, and WP-1 sends new actions to their feature module.                                                                                                                            |
| **Do the three-part lift now** (the spec's stated gate)                   | A rename sets no `deleted_at`. See "Where this disagrees with the spec".                                                                                                                                  |

## Risks / rollback

| Risk                                                                                                                | Mitigation                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The motivating case is refused** (both fixtures fold equal to catalog rows)                                       | Open question 1. M11 says what the parent sees under each answer. Copy (b) gives a real next step.                                                                                                                                     |
| A comma reaches the CSV through a renamed name                                                                      | M3 from the one shared rule.                                                                                                                                                                                                           |
| A catalog row is renamed for every household                                                                        | D4. `db:verify` case 2, and patch 07 proves it can fail.                                                                                                                                                                               |
| A cross-household rename, or a label leak through a pre-TEN-2c cross reference                                      | D4 for the write, D6's scoped join for the read, and the "another household ⇒ as-typed" test.                                                                                                                                          |
| Past CSV rows change unexpectedly                                                                                   | Open question 1 (including re-ingest), the hint copy, and M9.                                                                                                                                                                          |
| A driver error leaks the typed name                                                                                 | Caught outside the transaction, never re-thrown. The scrubber is a second layer, not the first.                                                                                                                                        |
| The `23505` shape differs on node-postgres                                                                          | PGlite proves the branch. One `name_taken` path in `e2e:local` runs on real Postgres.                                                                                                                                                  |
| **Race:** a rename against `findOrCreateMovement` inserting the new slug                                            | The index refuses the second writer. A rename gets `name_taken`. A resolver insert hits `ON CONFLICT DO NOTHING` and re-selects the renamed row (`movement-catalog.ts:92-103`), so the set lands on it, which is the intended outcome. |
| **Privacy: a rename is mistaken for erasure** (`docs/privacy/notice.md:197-203` warns about typing a person's name) | The name is gone from `movements` and every screen, but it survives in `entries.movement_name` and in downloaded exports. The inventory says so. Open question 2.                                                                      |
| Gate-1 collisions                                                                                                   | Listed under Staging for the milestone's gate run.                                                                                                                                                                                     |

**Rollback.** There is no migration, so each PR reverts cleanly. A rename already made is valid data in
every code state, and Undo or another rename reverses it. A downloaded export is outside reach, as with
any edit. "The LLM never authors loads" is untouched: no load, no model.

## Out-of-scope / deferred

- **Merge**, unless the maintainer chooses (a). Then it is MOV-1c with its own plan.
- **Hiding or deleting a household movement.** It needs the three-part lift (`schema.ts:538-542`).
- **Renaming catalog rows**, and promoting a household row into the catalog (spec → Out of scope).
- **Keeping the old name as an alias.** That is PICK-2's near-match job.
- **Editing a household movement's `unit_default`, `is_bodyweight` or `pattern`.** That is a definition
  edit and its own row.
- **A cross-household scope-miss event for movement ids.** Open question 3.
- **Two stale TEN-2d remnants** found while reading. `ownership.ts:82-84` says the `23505` fallback
  "survives one more PR", while `movement-catalog.ts:26-40` says TEN-2d deleted it. And
  `DROPPED_GLOBAL_SLUG_UNIQUE` (`movement-catalog.ts:116`) has no reader. They are not MOV-1's to fix.

## Where this disagrees with the spec

1. **"No export byte changes" (spec line 154)** is false for any rename that changes the slug, except a
   hyphen ↔ underscore swap (D1).
2. **"Merge changes past exports" is the reason merge is deferred (spec lines 154, 887), but rename does
   too** (D1). The deferral reason no longer separates them. Open question 1.
3. **"Gated on … the three-part lift" (spec line 154).** The lift is the precondition for setting
   `deleted_at`. MOV-1 does not set it. MOV-1c might, if it hides the source.
4. **`movementRenameSchema` (spec line 488)** gains `seenName` (D5).
5. **No acceptance criterion is tagged C4r.** M1–M11 are proposed.
6. **The prototype keeps the old name on a blank rename** (`:5293`). The spec refuses it (IXD-7). This
   plan follows the spec.
7. **WP-1's plan text lacks `movement-actions.ts`** (`wp-1:145`); the spec's settled seams name it (D8).

## Open questions

1. **(The maintainer, who owns the Insight pillar. Blocks MOV-1b.) May a household relabel past rows,
   by renaming a movement, or by merging it into a catalog or sibling row?** Both change the
   `movement` column of past months on the next export (D1). Sub-question, which only the maintainer can
   answer: **does the downstream workflow re-ingest every month's file, or only append new ones**
   (`csv-export-contract.md:6-9,22-25`)? If it appends only, any relabel splits one movement's history
   across old and new files.
   - **(a) Recommended: relabel by both, in CRUD-1.** MOV-1b ships rename with the "exports from now on"
     hint, and **MOV-1c** (sketched above) adds merge into an existing row behind U18's confirm. The
     two prototype fixtures then work (M11, column a). The cost is about 600 more lines and one more
     plan with both panels.
   - **(b) Relabel by rename only; merge stays later.** The fixtures get copy (b). Most real typos in
     those fixtures stay unfixable until C4m.
   - **(c) No relabel.** The slug is frozen (D2's fallback), so exports keep the logged name, the
     resolver duplicates, and MOV-1b switches PICK-1's chunk-2 comparison to ids (D2).
2. **(Privacy lens)** Does `notice.md` need a sentence saying a rename does not erase what was typed?
   The inventory edit ships regardless.
3. **(Security lens)** ADR 0006's scope-miss event (`0006:332-337`) is emitted for profile ids only
   (`household.ts:176-214`). Recommendation: **not in MOV-1**, because it widens the one allowlisted
   unscoped probe. File it as a row if the lens wants it.

## Review-response log

### Engineering panel, round 1 (correctness, scope, architecture, reuse, DB-safety)

| #   | Lens                                                   | Critique                                                                                                        | Verdict  | Resolution                                                                                                                                                                                                                                                           |
| --- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Architecture B1, reuse 3                               | MOV-1b ignored WP-1: wrong module location, no registry entry, re-tested the matrix locally                     | accepted | D8: `app/p/movement-actions.ts`, the `{refusal, scope: household}` entry, `ACTION_BINDINGS` writers, `NO_MOVEMENT_FOUND`'s home, `owns:`. The local suite is rename-specific only. the module is the spec's settled-seams entry; WP-1's plan text lacks it, noted    |
| 2   | Scope S2, DB-safety S2                                 | The transaction plus `FOR UPDATE` was unprecedented and unnecessary                                             | accepted | D5 rewritten to one guarded `UPDATE` plus re-read (`entries.ts:518-540`). The catalog read stays as a deliberate pre-check (DB-safety N3)                                                                                                                            |
| 3   | DB-safety S1, correctness S4, DB-safety N1, reuse 7    | A `23505` inside a transaction aborts it; the error shape was unverified; the matcher would be hand-rolled      | accepted | D3: the catch sits outside any transaction; `isUniqueViolationOn` reads `(cause ?? err)`; cites drizzle's `DrizzleQueryError` (`errors.d.ts:9-14`); `db:verify` case 8 runs inside an enclosing transaction; real Postgres in `e2e:local`                            |
| 4   | Correctness S2, DB-safety S4, architecture S1, reuse 4 | The label join keyed on `household_id is not null` would show another household's renamed text                  | accepted | D6: `movementInHousehold(scope)` in the join `ON`, chosen over `= profiles.household_id` because `scoped.test.ts` assertion 2 fails a hand-built `profiles` predicate. New test case "another household ⇒ as-typed"                                                  |
| 5   | Correctness S1, architecture S2                        | No revalidation after stale or not_found left the page lying; targets were unnamed                              | accepted | Revalidate on `ok`, `stale` and `not_found`, never on field errors. Two named targets, asserted per outcome                                                                                                                                                          |
| 6   | Correctness S3, reuse B1                               | Slug-only collisions miss hyphen/underscore, case and apostrophe twins that the picker and the CSV treat as one | accepted | D3 uses PICK-1's movement-name key (spec → settled seams; built on `movementNameKey`, `pick-1:200-219,507`). Hyphen/underscore rows added to D1 and D3. PICK-1's `:629-630` note reconciled in D2: the slug comparison stays valid because MOV-1 recomputes the slug |
| 7   | Scope S3, reuse 2, architecture S6                     | D8's fallback of creating `/settings` duplicated PROF-1b                                                        | accepted | The fallback and the old question 4 are deleted. MOV-1b is gated on step 2. `SETTINGS_MOVEMENTS_PATH` goes in `lib/constants.ts`. The settings files follow PROF-1b's guide, noted for its reconcile                                                                 |
| 8   | Scope S4, reuse 6                                      | Name-schema extraction had two possible owners                                                                  | accepted | Settled by the spec's seams table: PICK-1 PR 2 owns `movementNameSchema` and `MOVEMENT_NAME_MAX`; MOV-1a imports them and edits no `strength-session.ts`                                                                                                             |
| 9   | Scope S5                                               | The label change is a separable concern                                                                         | accepted | Now its own PR, MOV-1a2. `entries.ts` and `write-path.md` are added to the gate-1 list                                                                                                                                                                               |
| 10  | Architecture S3, S5, S4; reuse 8                       | No architecture diagram; the query was not in `owns:`; "uses" clashes with the census's "referenced"            | accepted | `architecture.md` edit plus Mermaid; `owns:` row; a docblock that contrasts with `movement-ownership.ts:8-30`                                                                                                                                                        |
| 11  | DB-safety S3                                           | The mutation patch had no `.expect`, no README row and no placement rule                                        | accepted | `07-rename-ignores-household.{patch,expect}`, README row, section after existing expected assertions                                                                                                                                                                 |
| 12  | DB-safety N2, correctness N2                           | Case 9 and the replay test over-claimed                                                                         | accepted | Reworded (now cases 10 and the action-test note)                                                                                                                                                                                                                     |
| 13  | Reuse 5                                                | `ActionState` / `useOnActionSuccess` are stranded under `[profileId]`                                           | accepted | WP-1 does not move them (checked). MOV-1b's first commit moves them if no one has                                                                                                                                                                                    |
| 14  | Reuse 7                                                | The `seenName` bound was a magic number                                                                         | accepted | `MOVEMENT_SEEN_NAME_MAX`                                                                                                                                                                                                                                             |
| 15  | Correctness N1                                         | M7 overstated resolver convergence                                                                              | accepted | Qualified to slug-exact; fold variants are the picker's job                                                                                                                                                                                                          |
| 16  | Correctness S5                                         | Re-ingest is unknown and decides whether any relabel is safe                                                    | accepted | Part of Open question 1                                                                                                                                                                                                                                              |
| 17  | Also found                                             | The rename/resolver race; the `prescribed_snapshot` clause                                                      | accepted | Race row in Risks. Fact 6 and M1 cover the snapshot                                                                                                                                                                                                                  |

### UX panel, round 1 (lens 1 interaction/first-run, lens 2 a11y/360px, lens 3 trust/data entry)

| #   | Lens                     | Critique                                                                                                                                                                                   | Verdict                             | Resolution                                                                                                                                                                                                                                                                                                        |
| --- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B   | Lenses 1 and 3, BLOCKING | The motivating case is refused: both prototype fixtures fold equal to catalog rows (`catalog-movements.ts:171-172,186-188`), and a household twin hits `name_taken`. Both point at "later" | **open: the maintainer's decision** | Framed as Open question 1 with re-ingest. Recommended (a) with a MOV-1c sketch; fallback copy (b) written; M11 names both fixtures under each answer; a visible near-match line on the card, no dead button                                                                                                       |
| 1   | Lens 1 S1, lens 3 S3     | After a stale refusal the card kept client state and a wrong `seenName`                                                                                                                    | accepted                            | It closes to idle, re-seeded from server props                                                                                                                                                                                                                                                                    |
| 2   | Lens 3 S2                | No way back from a wrong rename                                                                                                                                                            | accepted                            | `Renamed “old” to “new” · Undo`, the same writer, focus on Undo, `db:verify` case 11                                                                                                                                                                                                                              |
| 3   | Lens 1 S3                | No empty state; the nav subtitle was static                                                                                                                                                | accepted                            | Copy written, a count-aware subtitle, the empty state in screenshots                                                                                                                                                                                                                                              |
| 4   | Lens 1 S4                | No path from "use as typed" to the fix                                                                                                                                                     | accepted                            | PICK-1's hint edited, plus the `?rename=<publicId>` deep link                                                                                                                                                                                                                                                     |
| 5   | Lens 1 S5, lens 2 #2     | Ordering by name moves the card under the user; the confirmation was announce-only                                                                                                         | accepted                            | Order by `created_at`; a visible success line                                                                                                                                                                                                                                                                     |
| 6   | Lens 1 N1                | Saving an unchanged name should not be a request                                                                                                                                           | accepted                            | Treated as Cancel                                                                                                                                                                                                                                                                                                 |
| 7   | Lens 2                   | No component test; the a11y scan lacked a long-name fixture; id collisions; error placement; overflow; tap height; focus ring; reuse of input and saving constants                         | accepted                            | `rename-movement-form.test.tsx`; the a11y route with a 100-character fixture at `NARROW`; `useId` + `publicId`; one `role=alert` `<p>` above the buttons; `overflow-wrap`; `min-h-11` plus a height assertion; the receipt's ring (`bodyweight-receipt.tsx:69-70`); `INPUT_CLASS`, `enterKeyHint`, `SAVING_LABEL` |
| 8   | Lens 3 S1                | The hint did not say what happens to past entries and exports, with numbers                                                                                                                | accepted                            | Per-answer hint with `{N}`                                                                                                                                                                                                                                                                                        |
| 9   | Lens 3 N1                | `name_taken` should name the colliding row, never an id                                                                                                                                    | accepted                            | `conflictName` in the result and the copy                                                                                                                                                                                                                                                                         |
| 10  | Lens 3 N2                | "Replaces" / "removes" overclaims                                                                                                                                                          | accepted                            | Banned from the copy                                                                                                                                                                                                                                                                                              |

No pushbacks this round: every finding checked against the code held.

### Re-review (round 2)

| #   | Severity | Critique                                                                                                                                                                                                    | Verdict  | Resolution                                                                                                                                                                                                                                                              |
| --- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | BLOCKING | D3's own-name exemption used the movement-name key, which strips a plural `s`. So "Bulgarian Split Squats" → "Bulgarian Split Squat" was exempted and took the catalog's slug, contradicting M11 and case 5 | accepted | The exemption is now `movementSlug(new) === current.slug` only, and a new slug equal to a catalog slug is always `catalog_name`. `db:verify` case 5 adds that rename; new case 5b asserts plural-to-sibling ⇒ `name_taken` from the pre-check, not the `23505` backstop |
| 2   | SHOULD   | A replay's result was not identical to the first call's (`previousName`)                                                                                                                                    | accepted | D5 step 1 returns `previousName: seenName`; case 7 asserts deep equality                                                                                                                                                                                                |
| 3   | SHOULD   | The node-postgres `23505` proof rested on an e2e spec the plan only "proposed"                                                                                                                              | accepted | MOV-1b owns the rename e2e spec outright; D3 says the shape is unproven until it lands                                                                                                                                                                                  |
