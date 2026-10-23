# MOV-1 — a household renames its own mis-typed movement

> Backlog: none yet. MOV-1 is **unfiled** (spec → Unowned work 3); the row is filed in this work's PR
> (`docs/plan.md` is off-limits to the spec branch) · Spec:
> [crud-1-fix-it-yourself.md](../specs/crud-1-fix-it-yourself.md) chunk C4r · Milestone:
> [CRUD-1](../milestones/crud-1-fix-it-yourself.md) step 7 · Branch: `feat/mov-1-rename-movement`
> (staged as `feat/mov-1a-rename-writer` then `feat/mov-1b-rename-screen`, below).
>
> **Merge (C4m) is not in this plan.** It is [later] in the spec and needs the Insight pillar's sign-off.

## Goal

Today a household that mis-types a movement ("Bulgarain Split Squats") has **no way to fix it in the
app**. [ADR 0008](../decisions/0008-deletion.md) makes `movements` unremovable "by decision" (`0008:78`)
and names "`TEN-2c-1` or a successor" as the owner; `TEN-2c-1` turned out to be a measured no-op
(production census 2026-10-13: 35 rows, 0 household-owned — `docs/privacy/data-inventory.md:36-37`),
so the successor does not exist. The gap is latent today and becomes live the day PICK-1 (C1) ships,
because "use what I typed" makes a household movement one tap away.

After MOV-1, a parent opens **Household settings → Movements your household added**, taps **Rename** on
a row, types the right name and saves. Every past entry keeps its `movement_id`; the name changes where
the household reads it. Only a row whose `movements.household_id` is the session's household can be
renamed; a shared catalog row (`household_id IS NULL`) is never reachable.

### Where this sits

- **Pillar:** Logging (the Movements track; spec → "Two milestones, five tracks", `C` subgraph).
- **Milestone:** [CRUD-1 — Fix it yourself](../milestones/crud-1-fix-it-yourself.md), step 7, the last
  step of the Movements track.
- **This PR is:** the rename half of spec chunk C4r — the only fix a household has for a typo until C4m.
- **Next:** CRUD-1 closes when steps 2, 5, E and 7 are done. C4m (merge) waits for Insight.

## What the code does today — the facts this plan rests on

Each was opened and is cited; the decisions below follow from them.

1. **The CSV prints the movement's SLUG, read live at export time — not the name, and not a snapshot.**
   `strengthMonthRows` selects `movementSlug: schema.movements.slug` through the entry's `movement_id`
   (`packages/db/src/queries/export-month.ts:65`); `buildStrengthLog` writes `csvMovement(row.movementSlug)`
   (`packages/shared/src/csv/strength-log.ts:49`), which only swaps `_` for `-`
   (`packages/shared/src/csv/columns.ts:24-26`). The column's docblock says the source is the slug,
   **never** `movements.name` (`columns.ts:18-19`), and that the downstream workflow **groups by this
   exact string** (`columns.ts:13-16`).
2. **The slug is derived from the name, once, at creation.** `movementSlug(name)` = trim, lower-case,
   whitespace → `_` (`packages/shared/src/movements.ts:34-36`); `findOrCreateMovement` writes
   `{slug, name}` from the same typed text (`packages/db/src/writers/movement-catalog.ts:68,92-97`).
   Nothing ever rewrites either. `slug === movementSlug(name)` is pinned only for seed rows
   (`packages/shared/src/catalog-movements.ts:16,335-338`).
3. **The free-text resolver keys on the slug, global-first.** Step 1 looks up `slug` among
   `household_id IS NULL`, step 2 among this household, step 3 inserts
   (`movement-catalog.ts:80-97`). So the slug is the movement's **identity for typed text**.
4. **Two partial unique indexes arbitrate the slug, per namespace.** `uq_movements_slug_global` on
   `(slug) WHERE household_id IS NULL` and `uq_movements_household_slug` on `(household_id, slug) WHERE
household_id IS NOT NULL` (`packages/db/src/schema.ts:586-592`; names hoisted at `schema.ts:451-452`).
   Neither carries `deleted_at`; a household row may legally share a slug with a global row (the
   indexes are disjoint), and global-first then **shadows** it for typed text forever.
5. **The day page labels a strength entry from `entries.movement_name`, not `movements.name`.**
   `listEntriesForDay` selects `schema.entries.movementName` (`apps/web/lib/dal/entries.ts:132`) and maps
   it straight into `EntryDTO.movementName` (`entries.ts:274`); `entryLabel` returns it
   (`apps/web/lib/entries/entry-label.ts:63-64`). The strength writer stores the **as-typed** text in that
   column per entry (`packages/db/src/writers/strength-session.ts:181,354`). It is the only reader of the
   column in `apps/web` and `packages/db/src` (grep, 2026-10-23).
6. **Program rows read `movements.name` live** (`packages/db/src/queries/program-day.ts:98`), and the
   export's `prescribed` match keys on the **live** slug on both sides (`apps/web/lib/dal/export.ts:124,159`).
7. **The three-part lift** (`schema.ts:538-542`) is the condition for setting `movements.deleted_at`:
   add `deleted_at IS NULL` to both indexes, a `deleted_at` filter to the resolver, and a plain
   `idx_movements_household`. A rename sets no `deleted_at`.
8. **Name validation exists once, inside the log schema.** `sessionMovementSchema.movementName` is
   trimmed, 1..100, and rejects a comma or line break because the name reaches the CSV raw
   (`packages/shared/src/strength-session.ts:45-60`). `movementSlug` keeps a comma, so a comma in a
   renamed name would put one in the exported cell.
9. **The value-guarded amend is the precedent for a stale edit.** `editBodyweightSchema` carries
   `seenValue` (`packages/shared/src/bodyweight.ts:131-137`); a refused amend re-reads under the same
   scope and answers `AMEND_ERROR_COPY.staleWrite` or `notFound` (`apps/web/lib/dal/entries.ts:518-540`;
   copy at `apps/web/lib/constants.ts:527-541`).

## The decisions

### D1 — 🔴 A rename that changes the slug DOES change past CSV rows. The spec says it does not.

The spec's C4r row says _"a rename fixes the typo without touching a past entry's `movement_id`, so no
export byte changes"_ (spec line 154). The first half is true; **the conclusion is not**. The export
does not read `movement_id`; it reads `movements.slug` through it (fact 1). So:

| Rename                                                  | Slug changes?                | Past CSV rows                                                                       |
| ------------------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------- |
| case or spacing only (`rdl` → `RDL`)                    | no                           | **byte-identical**                                                                  |
| a spelling fix (`Bulgarain Split Squats` → `… Squat`)   | **yes**, if D2 recomputes it | every past month's `movement` cell for that movement changes on the **next** export |
| a spelling fix, slug frozen (D2's rejected alternative) | no                           | byte-identical — and the typo stays in the CSV forever                              |

The CSV contract says rows are _"chronological, append-only"_ (`docs/csv-export-contract.md:22`) and
the export must be byte-faithful (`:6-9`). A re-export after a slug-changing rename is still
deterministic (`export.ts:187`), but a month the household already downloaded will differ from a new
export of the same month. ADR 0005 decision 5 snapshotted `prescribed` (`schema.ts:205-218`)
precisely so an **authoring** edit cannot rewrite a past month; a rename is the same class of change on
the next column over.

**Proposed answer:** the slug follows the name (D2), so past rows change on the next export, and the
change is the **point**: the downstream workflow groups by this string (`columns.ts:13-16`), so a
movement whose old rows say `bulgarain-split-squats` and whose new rows say `bulgarian-split-squat`
would split one movement's history in two. Rewriting history consistently is the lesser harm than
splitting it. The rename screen says so in one line of copy (D6).

⚠️ **This is a byte-affecting change to the CSV contract, which the Insight pillar owns**
([roadmap.md](../roadmap.md) → Seams, "The byte-faithful CSV contract … **Insight**"). It is the same
reason C4m waits. So it is **Open question 1, blocking MOV-1b**, not something this plan decides.
MOV-1a is written so either answer ships without rework: the writer takes the slug policy as one
branch.

**If Insight says no:** the fallback is D2's alternative (freeze the slug), with the costs listed
there. A third option — make the export print the per-entry snapshot (`movementSlug(entries.movement_name)`)
so a rename is byte-neutral by construction — is listed under Alternatives and rejected.

### D2 — The slug is recomputed from the new name

`slug := movementSlug(newName)`, in the same `UPDATE` as `name`.

**Why, beyond D1:** the slug is the resolver's identity for typed text (fact 3). If it stayed frozen:

- typing the **corrected** name in "use what I typed" would derive a new slug, miss the renamed row in
  step 2 and **mint a second household row** — the duplicate the rename existed to remove;
- typing the **old typo** would silently resolve to the renamed row, forever;
- `slug` and `name` would disagree for the first time on a live row, and every later reader that assumes
  `slug === movementSlug(name)` (the seed's invariant, `catalog-movements.ts:16`) would be wrong for
  household rows only.

After a recompute, typing the old typo mints a fresh row (step 3). That is the honest outcome — the typo
is a new typo — and PICK-2 is the row that stops it.

### D3 — Collisions are refused, never resolved by merging

Three cases, each a typed field error on the name, none a write:

| New slug equals…                                  | DB says                                                                    | MOV-1 answers                                                                                                         |
| ------------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **this row's own slug** (case/spacing change)     | nothing                                                                    | allowed; `name` changes, `slug` is unchanged, no CSV change                                                           |
| **another row in this household**                 | `23505` on `uq_movements_household_slug` (`schema.ts:590-592`)             | `name_taken` — "You already have a movement called {name}." Merging the two is C4m                                    |
| **a shared catalog row** (`household_id IS NULL`) | **nothing** — the indexes are disjoint (fact 4), so the DB would accept it | `catalog_name` — refused by an explicit read, because accepting it creates a row global-first shadows forever (below) |
| a row in **another** household                    | nothing                                                                    | allowed and invisible; namespaces are separate by design (TEN-2c)                                                     |

**Why the catalog case must be refused even though the database allows it.** A household row named
"Box Jump" next to the seeded `box_jump` is unreachable by typed text (global-first, fact 3), shows as
two "Box Jump"s in PICK-1's picker, and carries `is_bodyweight: false` / no `unit_default` where the
seeded row has the curated values (`movement-catalog.ts:18-24`). That is a merge in disguise, without
merge's semantics. The parent's real intent — "these entries are Box Jumps" — is C4m.

**Exempt from the catalog check:** a rename whose slug does not change. A household row can already
share a slug with a global row (a CAT-2 seed added after the household typed it — the seed-growth
hazard, `schema.ts:497-501`); refusing a case-only fix on it would leave the parent stuck for a reason
the rename did not cause.

**How the household case is detected.** By catching `23505` whose constraint is
`MOVEMENT_HOUSEHOLD_SLUG_UNIQUE_INDEX` (the const, never a re-typed literal), not by a pre-check: a
pre-check races (write-path.md invariant 5's argument), and the catch is needed for the race anyway, so
one mechanism is simpler than two. ⚠️ **No live code catches a `23505` today** (grep, 2026-10-23:
every hit is a docblock); this is the first, so its exact error shape — whether drizzle surfaces pg's
`code`/`constraint` on the error or on `.cause` — is **unverified** and MOV-1a pins it with a
`db:verify` case before the action relies on it. The catch never re-throws the driver error: its
message and `detail` carry the typed name (`Key (household_id, slug)=(…)`), and SEC-3's scrubber cuts
only the `params:` tail (`apps/web/lib/sentry-scrub.ts:19-24,74`).

The catalog case is a read inside the same transaction. It can race only with a seed adding a global
row mid-rename — CAT-2's `db:seed`, which runs on merge to `main`. The window is one statement and the
outcome is the shadowed state the seed-growth hazard already allows; recorded, not engineered around.

### D4 — Ownership: the household predicate excludes catalog rows by construction

The writer's row lookup is `public_id = $1 AND movementInHousehold(scope)`
(`packages/db/src/writers/ownership.ts:176-178`). `household_id = $n` is never true for `NULL`, so a
catalog row's public id is **not found** — the same answer as an unknown id or another household's row,
byte-identical (ADR 0006: 404 semantics; spec contract, `movementRenameSchema`, spec line 488-489).
No new ownership predicate is written: `movementInHousehold` already lives in the one module allowed to
read `scope.householdId` (`ownership.ts:158-163`; `packages/db/src/scope.test.ts`).

### D5 — Stale edits and replays: `seenName`, under a row lock

The form carries the name it rendered as `seenName` (the `seenValue` precedent, fact 9). The writer, in
one transaction:

1. `SELECT id, name, slug … WHERE public_id = $1 AND movementInHousehold(scope) FOR UPDATE` → no row ⇒
   `not_found`.
2. `row.name !== seenName` ⇒ if `row.name === name`, this is a **replay** of a rename that already
   landed ⇒ `ok` with the identical result and **no write**; otherwise ⇒ `stale`.
3. `row.name === name` (a no-op save) ⇒ `ok`, no write.
4. `slug := movementSlug(name)`; if `slug !== row.slug` and a global row has `slug` ⇒ `catalog_name`.
5. `UPDATE movements SET name, slug, updated_at = now() WHERE id = row.id` — `23505` on the household
   index ⇒ `name_taken`.

This satisfies AGENTS.md backend rule 6 the way the amends do — the value guard makes a replay one
effect with an identical response — without an idempotency-key table. `movements` has no `client_id`
(it is a catalog, `schema.ts:544-566`), and adding one for a rename would be a migration buying nothing
the guard does not. ⚠️ **`FOR UPDATE` has no precedent in `packages/db/src`** (grep for `.for(`, 2026-10-23
— none); PGlite parses it, but `db:verify` runs one connection, so it proves the branches, not the lock.
The lock's job is only to make steps 1–5 see one row version; under READ COMMITTED without it, a
concurrent rename between 1 and 5 would be overwritten, which is the LWW-on-server-clock behaviour the
V1-22 spec already accepts for value edits — so the lock is cheap belt-and-braces, and the panel may
strike it.

### D6 — Where the new name shows, and where it does not

| Surface                                             | After a rename                                                                                                                                    |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| PICK-1's picker, program rows (`program-day.ts:98`) | the new name — both read `movements.name` live                                                                                                    |
| The CSV `movement` column                           | the new slug on the next export, for every month (D1) — **pending Insight**                                                                       |
| The CSV `prescribed` column                         | unchanged: both sides of the `(day_role, slug)` match read the live slug (`export.ts:124,159`), so the match survives                             |
| **The day page's logged strength rows**             | **the old typo — unless MOV-1b changes the read.** Fact 5. A rename that leaves every past row on the athlete's day showing the typo looks broken |

**So MOV-1b changes one read:** `listEntriesForDay` left-joins `movements` on `entries.movement_id` (a PK
join, no fan-out) and labels a strength entry with `movements.name` **when the movement is
household-owned**, else with `entries.movement_name` as today. A pure helper decides it, so it is unit
tested without a database.

**Why household-owned only, not every movement.** An entry that resolved to a **catalog** row stores
what the athlete typed (`box jump`), while the catalog row's name is `Box Jump`. Switching those labels
too would change the text of every past strength row on every day page, which nobody asked for, which no
rename can cause (catalog rows are never renamed), and which the e2e locators key on. Scoping the switch
to household rows makes the label change exactly as wide as the rename.

**`entries.movement_name` is not rewritten.** It stays the as-typed record per entry; see Alternatives
and the privacy note.

### D7 — The screen: the prototype's `movements` screen, rename only

Implements the approved prototype's **movements** screen (`docs/prototypes/crud-1/index.html`,
`vMovements` at `:4301-4339`, the rename form at `:4853-4863`, the submit at `:5291-5297`, the route
`/settings/movements` at `:2007`, the settings nav row at `:2298-2302`):

- `<h1>Movements your household added</h1>`, a `<ul>` of cards, one per **household-owned** movement:
  its name and "Logged N times" (live entries of live profiles in the household).
- Each card: an outline **Rename** button, `aria-label="Rename {name}"`.
- **Rename** swaps the card for a `<form>`: a labelled "New name" input (prefilled, focused), the hint,
  **Save name** and **Cancel**. Submit → `useActionState`; a field error sits under the input and is
  referenced by `aria-describedby` (spec → For the implementation plans, A11Y-2).
- On success the card returns with the new name, focus moves to that card, and the persistent polite
  live region announces "Renamed to {name}." (prototype `:5295-5297`).
- An empty household list says so in one line (the prototype has no empty state — **for the UX panel**).

**Deliberate departures from the prototype**, each for the UX panel:

1. **No "Merge into X… later" button.** The prototype shows one with a `later` tag (`:4323-4333`) as a
   review flag. Shipping a control that does nothing reads as broken; C4m adds it.
2. **A blank rename is refused** with a field error. The prototype silently keeps the old name
   (`:5293`, `if (nn)`); the spec's panel round 2 decided "a blank rename refused" (IXD-7, spec
   line 1088).
3. **Cancel returns focus to that card's Rename button**, not to the first card (`:4864-4865` re-renders
   `#hm-0`, a prototype bug).
4. **The hint gains one sentence if D1 is approved:** "Every entry keeps pointing at this movement. Only
   the name changes. Exports made from now on use the new name." — copy for the UX panel's trust lens.

**360px width math** (AGENTS.md → UI PR rules). Viewport 360 − page gutter `px-4` (2×16) = 328; card
`px-4` (2×16) + border (2×1) ⇒ **294px** of content — the same 294 the spec measured for a card at
360px (spec → disagreement 6). The name sits on its own line above the button row and wraps
(`break-words`, plus `[overflow-wrap:anywhere]` for a 100-character unbroken string). Button row:
**Rename** = `px-2.5` (2×10) + "Rename" at `text-sm` ≈ 52 ⇒ ~72px, `min-h-11` from the base class
(`apps/web/components/ui/button.tsx:10-20`) ⇒ 44px tall. Edit state: input `w-full` = 294; **Save
name** ≈ 20 + 66 = 86, **Cancel** ≈ 20 + 46 = 66, `gap-2` 8 ⇒ **160 ≤ 294**, one line, no wrap luck.
⚠️ The `px-2.5` default padding is read from `button.tsx:36-37`; the glyph widths are estimates at 14px
Geist — MOV-1b's screenshots at 390px confirm them, and the plan's claim is only that 160 has 134px of
slack.

### D8 — Entry point and the settings page

The prototype reaches the screen from **Household settings** (`:2298-2302`), itself linked from the
picker (`:2102`). **No `/settings` route exists today** (`apps/web/app/` lists `design`, `gate`, `p`,
`privacy`, `sign-in`). The milestone puts archive in Household settings (milestone → Decisions, Q1),
so PROF-1b (step 2) is expected to create `/settings`, and it lands before step 7 in the chart. That is
**unverified** — the PROF-1 plan is not written yet. So:

- if `/settings` exists when MOV-1b starts, MOV-1b adds **one nav row** to it;
- if it does not, MOV-1b creates the minimal `app/settings/page.tsx` (an `<h1>` and a `<nav>` list with
  this one row) and the link from `/p`, and **records the gate-1 collision** with PROF-1b in the PR.

Either way the milestone's gate run must list `app/settings/**` as shared by steps 2 and 7.

## Acceptance

⚠️ **The spec has no acceptance criterion tagged C4r**: its "Movements (C1–C4)" block stops at 20
(spec lines 292-306), and the milestone cites "spec unowned 3" in place of criteria (milestone step 7).
These are this plan's; the PR proposes adding them to the spec.

- **M1.** **When** a parent renames a movement owned by the session's household to a valid new name,
  the system **shall** update that row's `name` and set `slug = movementSlug(name)` in one statement,
  and **shall not** change its `id`, `public_id` or `household_id`, or any `entries.movement_id`,
  `prescriptions.movement_id` or `entries.movement_name`.
- **M2.** **If** the movement public id is unknown, belongs to another household, or names a catalog row
  (`household_id IS NULL`), **then** the system **shall** answer with one byte-identical not-found
  envelope and write nothing.
- **M3.** **If** the new name, trimmed, is empty, longer than 100 characters, or contains a comma or a
  line break, **then** the system **shall** return a field error and write nothing (the same rule as
  `sessionMovementSchema.movementName`, from one definition).
- **M4.** **If** the new slug equals another movement's slug in the same household, **then** the system
  **shall** return `name_taken` and write nothing; **if** it equals a catalog row's slug and differs
  from the row's current slug, **then** `catalog_name` and write nothing.
- **M5.** **When** a rename submit is replayed, the system **shall** apply it once and return the same
  result; **when** the row's name changed since the form rendered (another device), the system
  **shall** return `AMEND_ERROR_COPY.staleWrite` and write nothing.
- **M6.** **When** a movement has been renamed, every past strength entry referencing it **shall** show
  the new name on the athlete's day page; entries referencing catalog movements **shall** render
  exactly as before.
- **M7.** **When** typed text equals the new name, `findOrCreateMovement` **shall** return the renamed
  row's id (no second row).
- **M8.** No code path in MOV-1 **shall** set `movements.deleted_at`.
- **M9.** (**pending Open question 1**) A re-export after a slug-changing rename **shall** print the new
  slug in the `movement` column for every month, and the `prescribed` column **shall** be unchanged.
- **M10.** The screen meets the UI rules: every control ≥44px at 360px, keyboard-only operable, the
  field error tied by `aria-describedby`, focus moved on open, save and cancel.

## Staging

| PR         | What                                                                                                                                     | ~lines (src + tests) | Gate                                                                                           |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------- |
| **MOV-1a** | `packages/` only: the shared name/rename schemas, the writer, the household-movements read, `db:verify` proofs, one `db:mutations` patch | ~330                 | **C1 (PICK-1) merged** — it creates the household rows and may already extract the name schema |
| **MOV-1b** | `apps/web`: the DAL, the Server Action, `/settings/movements`, the rename form, the day-label read, tests, guide + privacy + changelog   | ~400                 | MOV-1a merged · **Open question 1 answered** · **AUTH-1 1c landed** (see AUTH-1 below)         |

No migration in either: the schema, both indexes and the CHECKs stay as they are. MOV-1a is inert (no
caller), so it can land as soon as C1 does, while Insight decides D1.

## File-by-file changes

### MOV-1a

| Path                                                             | Change | What & why                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared/src/movements.ts`                               | EDIT   | Add `movementNameSchema` (trim, 1..`MOVEMENT_NAME_MAX` = 100, no comma/line break via `hasCommaOrLineBreak` from `./text`) and `movementRenameSchema`. **If C1 already extracted the name schema, reuse it and add only the rename schema** — the second consumer is the extraction trigger (AGENTS.md → Constants). |
| `packages/shared/src/strength-session.ts`                        | EDIT   | `sessionMovementSchema.movementName` becomes `movementNameSchema` — one rule for "a name a household typed". Same messages, so no copy changes. **Skipped if C1 did it.**                                                                                                                                            |
| `packages/db/src/writers/movement-rename.ts`                     | NEW    | `renameHouseholdMovement(exec, scope, input)`, D5's five steps in one transaction. Uses `movementInHousehold`, `movementIsGlobal`, `MOVEMENT_HOUSEHOLD_SLUG_UNIQUE_INDEX`, `movementSlug`. No throw interpolates `name` or `slug` (the `movement-catalog.ts:58-61` rule).                                            |
| `packages/db/src/queries/household-movements.ts`                 | NEW    | `householdMovementRows(db, { scope })` → `{ publicId, name, uses }[]`, `movementInHousehold(scope)`, `uses` = count of live entries on live profiles `inHousehold(scope)`; ordered by `lower(name)` via a drizzle `sql` template (never `sql.raw`).                                                                  |
| `packages/db/src/index.ts`                                       | EDIT   | Export both, beside `writers/movement-catalog` (`index.ts:26-31`).                                                                                                                                                                                                                                                   |
| `packages/db/scripts/verify.ts`                                  | EDIT   | A "MOV-1" section — see Test plan.                                                                                                                                                                                                                                                                                   |
| `packages/db/scripts/mutations/<nn>-mov-1-rename-unscoped.patch` | NEW    | Drops `movementInHousehold(scope)` from the writer's lookup; `db:verify` must go RED on the cross-household and catalog cases. A boundary that cannot fail is not coverage (AGENTS.md → `db:mutations`).                                                                                                             |
| `docs/features/write-path.md`                                    | EDIT   | Owns `packages/db/src/writers/` (frontmatter). Files row for the writer; Traps: "a rename recomputes the slug — the export's `movement` column and the resolver both follow it"; the first `23505` catch and why it never re-throws.                                                                                 |
| `docs/features/strength-logging.md`                              | EDIT   | **Only if** `strength-session.ts` is edited (it owns that file): one line saying the name rule now lives in `movements.ts`.                                                                                                                                                                                          |

**Shapes** (types, not code):

```text
packages/shared
  MOVEMENT_NAME_MAX = 100
  movementNameSchema     z.string().trim().min(1, 'Enter a movement.').max(MOVEMENT_NAME_MAX)
                           .refine(!hasCommaOrLineBreak, 'A movement name can’t contain a comma or a line break.')
  movementRenameSchema   { movementPublicId: uuidSchema, name: movementNameSchema,
                           seenName: z.string().max(<generous bound, e.g. 1000>) }
                         ← seenName is NOT the name rule: a legacy row may hold a name today's rule
                           refuses, and the rename is how it gets fixed

packages/db  writers/movement-rename.ts
  RenameMovementResult =
    | { ok: true;  publicId: string; name: string }
    | { ok: false; reason: 'not_found' | 'stale' | 'name_taken' | 'catalog_name' }
```

⚠️ **`seenName` is additive to the spec's contract** (`movementRenameSchema { movementPublicId, name }`,
spec line 488). The spec's shape cannot tell a replay from a stale write; this one can.

### MOV-1b

| Path                                                           | Change      | What & why                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/lib/dal/movements.ts`                                | NEW         | `import 'server-only'`. `listHouseholdMovements()` and `renameMovement(input)`: each `getHouseholdScope()` → null ⇒ `[]` / `not_found`, then the `packages/db` function. Returns `HouseholdMovementDTO { publicId, name, uses }` — never `id` or `household_id`. Shape satisfies `scoped.test.ts` assertion 1 without an allowlist entry.                                                                       |
| `apps/web/app/settings/movements/actions.ts`                   | NEW         | `'use server'`; `renameMovementAction(prev, formData)`: boundary call **first** (the one `pages-are-gated.test.ts` asserts — `hasGateAccess` before 1c, the session check after), Sentry wrap inside the body (`actions.ts:53-62` idiom; no `formData`, no `headers`), zod, DAL, the result → `ActionState`, `revalidatePath` on success only. **Placement follows WP-1** if it lands first (milestone step 0). |
| `apps/web/app/settings/movements/page.tsx`                     | NEW         | RSC; `await requireGatedPage()` (or 1c's replacement); `listHouseholdMovements()`; the `<h1>`, the `<ul>`, an empty state; a back link to `/settings`.                                                                                                                                                                                                                                                          |
| `apps/web/app/settings/movements/rename-movement-form.tsx`     | NEW         | `'use client'` island per card: idle (name, uses, Rename) ↔ editing (`<form>`, label, input, hint, Save name, Cancel). `useActionState`; focus management per D7. Keyed by `publicId`.                                                                                                                                                                                                                          |
| `apps/web/app/settings/movements/actions.test.ts`              | NEW         | The boundary suite (Test plan).                                                                                                                                                                                                                                                                                                                                                                                 |
| `apps/web/lib/movements/rename-copy.ts`                        | NEW         | `MOVEMENT_RENAME_COPY` — `nameTaken(name)`, `catalogName(name)`, `renamed(name)`, the hint. App-only, feature-local (AGENTS.md → Constants); `notFound` and `staleWrite` **reuse** `AMEND_ERROR_COPY` (`constants.ts:527-541`), not re-worded. Deliberately not `lib/constants.ts`, an AUTH-1 1c file.                                                                                                          |
| `apps/web/lib/entries/movement-display-name.ts` (+ `.test.ts`) | NEW         | Pure `movementDisplayName({ entryName, movementName, movementOwned })` → D6's rule.                                                                                                                                                                                                                                                                                                                             |
| `apps/web/lib/dal/entries.ts`                                  | EDIT        | `listEntriesForDay`: `leftJoin(schema.movements, eq(schema.entries.movementId, schema.movements.id))`; select `movementName` from both tables and `movementOwned` as a `sql<boolean>` template of `household_id is not null`; map through the helper at `:274`. No new predicate in `WHERE`.                                                                                                                    |
| `apps/web/app/settings/page.tsx`                               | NEW or EDIT | D8: one nav row, or the minimal page.                                                                                                                                                                                                                                                                                                                                                                           |
| `apps/web/app/pages-are-gated.test.ts`                         | EDIT        | The known-modules list (`:228`) gains `'app/settings/movements/actions.ts'` — the visible edit the guard exists to force. The page is covered by the `**/page.tsx` glob with no edit.                                                                                                                                                                                                                           |
| `docs/features/write-path.md`                                  | EDIT        | Owns `apps/web/lib/dal/`: the new DAL module; invariant 1 now names a second action module; the label rule in Traps.                                                                                                                                                                                                                                                                                            |
| `docs/privacy/data-inventory.md`                               | EDIT        | `movements` row (`:131`): a rename overwrites `name` and `slug` in place; **the as-typed text survives in `entries.movement_name`** for every entry logged before the rename, and is no longer shown. See Risks → privacy.                                                                                                                                                                                      |
| `docs/csv-export-contract.md`                                  | EDIT        | **Only if Open question 1 is approved:** one paragraph — the `movement` column follows a household rename on the next export.                                                                                                                                                                                                                                                                                   |
| `docs/changelog/<fragment>.md`, `docs/status.md`               | NEW / EDIT  | Per AGENTS.md → "Status rides with the work".                                                                                                                                                                                                                                                                                                                                                                   |

**No feature guide owns `apps/web/app/settings/**`.** Four files across two packages in MOV-1b alone
meets the guide threshold (AGENTS.md → Feature guides) only if Household settings grows into one
feature; PROF-1's plan is the place to decide whether `docs/features/household-settings.md` exists.
Recorded, not created here.

## Test plan

**`packages/shared` (vitest).** `movementNameSchema`: trims; rejects `''`, `'   '`, 101 characters, a
comma, `\n`, `\r`; accepts `30" Box Jump` (the `"` precedent, `strength-session.ts:51-52`).
`movementRenameSchema` rejects a non-UUID id. If `sessionMovementSchema` switched to the shared schema,
its existing tests stay green unchanged (that is the proof the extraction changed nothing).

**`db:verify` "MOV-1"** — runs `renameHouseholdMovement` itself (write-path.md invariant 3), with two
households and the seeded catalog, each case asserting the rows **after**:

1. Own row renamed: `name` and `slug` updated; `id`, `public_id`, `household_id` unchanged; the count of
   `entries` with that `movement_id` unchanged; `entries.movement_name` unchanged (M1).
2. A catalog row's public id ⇒ `not_found`, row byte-unchanged (M2).
3. Household B's row from household A's scope ⇒ `not_found`, unchanged (M2). The mutation patch turns
   this and case 2 red.
4. Rename onto a sibling household row's slug ⇒ `name_taken`, **both** rows unchanged — and the `23505`
   shape is pinned here (D3's unverified point) (M4).
5. Rename onto a catalog slug (`box_jump`) ⇒ `catalog_name` (M4).
6. A household row sharing a catalog slug, case-only rename ⇒ `ok`, slug unchanged (D3's exemption).
7. `seenName` stale ⇒ `stale`, unchanged; replay (`seenName` old, `name` = current) ⇒ `ok`, identical
   result, `updated_at` unchanged — one effect (M5).
8. After case 1, `findOrCreateMovement(newName)` returns the renamed id and the movement count is
   unchanged; `findOrCreateMovement(oldName)` mints a new row (D2, recorded behaviour) (M7).
9. After case 1, `strengthMonthRows` for an entry on the renamed movement returns the **new** slug, and
   the `(day_role, slug)` key still matches `programDayRows` for a household movement in a program —
   pins D1 whichever way Insight answers (M9).
10. No row in `movements` has `deleted_at` set after the section (M8).

**`apps/web` (vitest, MOV-1b).** `actions.test.ts` mocks the DAL the way `p/[profileId]/actions.test.ts`
does (Server Actions tested as plain async functions, AGENTS.md → Testing gotchas):

- **unauth → reject:** boundary refused ⇒ not-found envelope, `renameMovement` **not called**;
- **wrong-owner → 404:** DAL `not_found` for a foreign id and for a catalog id ⇒ the **same bytes** as
  an unknown id;
- **bad body → zod-reject:** blank, 101 chars, comma, non-UUID ⇒ `fieldErrors.name` / refusal, DAL not
  called;
- **replay → one effect + identical response:** two submits, DAL `ok` both times ⇒ identical
  `ActionState`;
- `stale` ⇒ `AMEND_ERROR_COPY.staleWrite`; `name_taken` / `catalog_name` ⇒ a field error naming the
  typed name, never another household's anything;
- `revalidatePath` called on `ok` only.

`movement-display-name.test.ts`: household-owned ⇒ `movements.name`; catalog ⇒ `entries.movement_name`;
no movement (a legacy row with `movement_id` NULL) ⇒ `entries.movement_name` (M6).
`pages-are-gated.test.ts`, `use-server-exports.test.ts` and `scoped.test.ts` cover the new module and
DAL with the one list edit above.

**e2e** (MOV-1b; `apps/web/e2e/**` is not edited by this plan, only proposed): log a strength set with a
new free-text name → `/settings/movements` → rename → the day page shows the new name. Add
`/settings/movements` (idle and editing) to the a11y scan (spec unowned 8). Run with `pnpm e2e:local`.

**Screenshots:** `pnpm --filter web screenshot:ephemeral /settings/movements` at the three widths, idle
and editing and with a field error, published per the `ui-screenshot` skill.

**Local run:** `pnpm verify` (includes `db:verify` and `db:mutations`), then `pnpm e2e:local` for 1b.

## AUTH-1 — what MOV-1b re-verifies once 1c lands

AUTH-1 1a, 1b-bis and 1c-pre have shipped; 1b, 1c and 1d have not, and 1c is the one-way door
(`docs/plans/auth-1-clerk-google.md:543-550`). MOV-1b is gated on 1c because it adds a **13th** entry
point pair to the 12 that 1c converts (7 actions + 4 pages + 1 Route Handler, `auth-1-clerk-google.md:549`), and an
entry point written against the gate would be converted by 1c's diff or missed by it. Once 1c is on
`main`, MOV-1b's implementer re-reads and re-verifies:

1. **The boundary call.** `pages-are-gated.test.ts`'s `BOUNDARY_CALL` (`:217`) — 1c **switches** it
   from `hasGateAccess` and must not widen it (`:211-215`); the action's first line uses whatever it
   now asserts, and the page uses 1c's replacement for `requireGatedPage()`.
2. **`getHouseholdScope()`'s new body** (session → `household_members`): a session with no membership
   is `null` ⇒ the DAL's `not_found` / empty list, and the no-household screen 1c adds is reached before
   this page renders.
3. **The mutation limiter** 1c introduces (`lib/rate-limit.ts:13-17` defers it to Clerk): the new action
   is limited like the others, by whatever single-source list 1c uses.
4. **The single-source action list** (`p/[profileId]/mutating-actions.ts` today): if 1c (or WP-1)
   generalises it beyond one route, the new action is registered there and its non-vacuity floor moves.
5. **`ScopeMissEvent.actor`** (`household.ts:196-201`, `'gate_session'` today) — only relevant if Open
   question 3 adds a movement miss event.
6. **`AUTH-1 1c` edits `lib/constants.ts`**, which is why MOV-1b's copy lives in `lib/movements/`.

MOV-1a touches no AUTH-1 file and is not gated on 1c.

## Alternatives considered

| Alternative                                                                                           | Rejected because                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Freeze the slug; change `name` only**                                                               | D2: the corrected name, typed again, mints a duplicate; the typo resolves silently forever; the typo stays in the CSV. It is the **fallback** if Insight refuses D1, with those costs stated in the PR.                                                                                        |
| **Export the per-entry snapshot** (`movementSlug(entries.movement_name)`) so a rename is byte-neutral | A change to the export's source (Insight's file, `export.ts`) to avoid a change to the export's bytes; and it splits one movement's history in the CSV at the rename date — old rows keep the typo, new ones the fix — which is worse for the grouping the workflow does (`columns.ts:13-16`). |
| **Also rewrite `entries.movement_name`** for every entry on the movement                              | A bulk `UPDATE` of a household's log rows, bumping `updated_at` on entries v1.5's LWW sync will compare (`schema.ts:37`), to change a column only the day label reads. D6's read change reaches the same screen with zero writes to `entries`.                                                 |
| **Label every entry from `movements.name`** (catalog included)                                        | Changes the text of past rows that no rename touched (`box jump` → `Box Jump`) and the e2e locators that key on it. D6 scopes the switch to the rename's own blast radius.                                                                                                                     |
| **Allow a rename onto a catalog name**                                                                | The DB accepts it, and the result is a row global-first hides from typed text forever, a duplicate in the picker, and worse metadata than the seeded row (D3). It is merge without merge's semantics.                                                                                          |
| **Pre-check the household collision instead of catching `23505`**                                     | Races; the catch is needed for the race anyway (D3).                                                                                                                                                                                                                                           |
| **An idempotency-key table for the rename**                                                           | `movements` has no `client_id`; `seenName` gives one effect and an identical response on replay, the way the amends do (D5).                                                                                                                                                                   |
| **Rename inside a U0 sheet**                                                                          | One field: an inline form keeps the row in view, which is what the approved prototype does. The sheet is for the picker's long list.                                                                                                                                                           |
| **Put the action in `app/p/[profileId]/actions.ts`**                                                  | A rename is not profile-addressed; its refusal copy (`NO_PROFILE_*`) would lie, and that file is the gate-1 hotspot every CRUD-1 track queues on (spec → The critical path).                                                                                                                   |
| **Do the three-part lift now** (spec's stated gate)                                                   | A rename sets no `deleted_at`; lifting the prohibition is a soft-delete's cost, and doing it with no soft-delete to prove it would add a filter and an index nothing exercises. See "Where this disagrees with the spec".                                                                      |

## Risks / rollback

| Risk                                                                                                                                                                                                        | Mitigation                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **A renamed name carries a comma into the CSV** (`movementSlug` keeps commas, the export joins raw)                                                                                                         | M3 from the one shared rule; `db:verify` case 1 renames to a name with a `"` and asserts the exported row parses.                                                                                                                                                  |
| **A catalog row is renamed for every household** (BOLA on shared reference data)                                                                                                                            | D4: the lookup is `movementInHousehold(scope)`, which `NULL` never satisfies; `db:verify` case 2; the mutation patch proves the case can fail.                                                                                                                     |
| **A cross-household rename**                                                                                                                                                                                | Same predicate; `db:verify` case 3; the action test's wrong-owner bytes.                                                                                                                                                                                           |
| **Past CSV rows change without the household or the workflow expecting it**                                                                                                                                 | Open question 1 (Insight) before MOV-1b; the hint says so (D7.4); M9 pins whichever answer ships.                                                                                                                                                                  |
| **A driver error leaks the typed name to Sentry**                                                                                                                                                           | `23505` is caught and mapped, never re-thrown; no throw interpolates `name`/`slug`; SEC-3's scrubber is the second layer, not the first.                                                                                                                           |
| **The day label changes for rows nobody renamed**                                                                                                                                                           | Household-owned only (D6). For a household row, entries typed as a slug-equal variant (`RDL` vs `rdl`) now show the row's name — the one visible change, stated in the PR.                                                                                         |
| **Privacy: a rename is mistaken for erasure.** A household that typed a person's name as a movement (the notice warns about exactly this, `docs/privacy/notice.md:197-203`) renames it and believes it gone | It is gone from `movements` and from every screen, but **survives in `entries.movement_name`** for each past entry and in any export already downloaded. The inventory says so (MOV-1b); whether `notice.md` must say so is Open question 2, for the privacy lens. |
| **`FOR UPDATE` is new here**                                                                                                                                                                                | D5 says what it buys and that the panel may strike it; `db:verify` proves the branches either way.                                                                                                                                                                 |
| **Gate-1 collision on `app/settings/**` with PROF-1b**                                                                                                                                                      | D8; the milestone's gate run lists it.                                                                                                                                                                                                                             |

**Rollback.** No migration, so both PRs revert cleanly. A rename already made is data: reverting the
code leaves renamed rows renamed, which is valid in every state (the schema did not change). Undoing a
specific rename is another rename. The only irreversible effect is an export a household downloaded in
between — the same as any edit.

**The rule "the LLM never authors loads"** is untouched: a rename carries no load, and no model is
involved in MOV-1.

## Out-of-scope / deferred

- **Merge (C4m)** — repointing `entries.movement_id`; [later], Insight's sign-off (spec line 154, 887).
- **Hiding or deleting a household movement** — needs the three-part lift (`schema.ts:538-542`) and
  ADR 0008's mechanical rule; nothing here sets `deleted_at`.
- **Renaming catalog rows**, or promoting a household row into the catalog — spec → Out of scope.
- **Keeping the old name as an alias** so the typo still finds the row — that is PICK-2's near-match job.
- **Editing a household movement's `unit_default`, `is_bodyweight` or `pattern`** — a definition edit,
  not a typo fix; `findOrCreateMovement` cannot author them (`movement-catalog.ts:18-24`), and doing so
  is its own row.
- **A cross-household scope-miss event for movement ids** — Open question 3.
- **The two stale TEN-2d remnants** found while reading: `ownership.ts:82-84` still says the `23505`
  fallback "survives one more PR (TEN-2d)" while `movement-catalog.ts:26-40` says TEN-2d deleted it, and
  `DROPPED_GLOBAL_SLUG_UNIQUE` (`movement-catalog.ts:116`) has no remaining reader (grep, 2026-10-23).
  Not MOV-1's to fix; noted for whoever next edits those files.

## Where this disagrees with the spec

1. **"No export byte changes" (spec line 154)** — false for any rename that changes the slug (D1).
2. **"Gated on … the three-part lift at `schema.ts` above `movements`" (spec line 154)** — the lift
   (`schema.ts:538-542`) is the precondition for **setting `deleted_at`**. A rename does not, so MOV-1
   does not need it. C4m needs it only if merge hides the source row; that is C4m's plan's question.
3. **`movementRenameSchema { movementPublicId, name }` (spec line 488)** — this plan adds `seenName` (D5).
4. **No acceptance criterion is tagged C4r** — M1–M10 above are proposed for the spec.
5. **Prototype vs spec on a blank rename** — the prototype keeps the old name silently (`:5293`); the
   spec's panel decided "refused" (IXD-7). This plan follows the spec (D7.2).

## Open questions

1. **(Insight, blocks MOV-1b)** Approve D1: a rename that changes the slug changes the `movement` column
   of every past month on the next export. If refused, MOV-1b ships D2's fallback (frozen slug) with its
   costs in the PR.
2. **(Privacy lens)** Does `notice.md` need a sentence that renaming a movement does not erase what was
   typed (it stays on each past entry, unseen, until the household is deleted)? The inventory edit is in
   MOV-1b regardless.
3. **(Security lens)** ADR 0006 asks for a structured event on a scope miss (`0006:332-337`); today it is
   emitted for profile ids only (`household.ts:176-214`). Does a movement public id miss need one?
   Recommendation: **not in MOV-1** — it would widen the one allowlisted unscoped probe in an AUTH-1 1c
   file; file it as a row if the lens wants it.
4. **(Milestone)** Who creates `/settings` — PROF-1b or MOV-1b (D8)?

## Review-response log

_Pending: engineering panel + UX panel (round 1)._
