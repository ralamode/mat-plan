# RETIRE-1 — archive a program so it stops appearing, without losing its history

> Backlog: [plan.md](../plan.md) row **RETIRE-1** (`docs/plan.md:1966`) · Spec:
> [crud-1-fix-it-yourself.md](../specs/crud-1-fix-it-yourself.md) chunk **D6** · Milestone:
> [PROG-1](../milestones/prog-1-programs-and-scheduling.md) step 8 · Branch: `feat/retire-1-archive-program`
> (staged as four branches, below).
>
> **Plan only. No implementation code, no migration, no schema edit in this PR.** Status: draft, awaiting
> the engineering panel (with the DB-safety lens) and the UX panel.

## Goal

CLONE-1 makes old programs pile up: every "save as a copy" leaves the source behind, and the household's
Programs page, the editor's program list, the copy source list and the assignment sheet's "which program?"
list keep offering all of them. RETIRE-1 lets a parent **archive** a program: it leaves those lists, and
nothing about the past changes — entries, their snapshotted prescriptions, the assignment rows and dates,
the day page for a past date and the CSV export all read exactly as before. An archived program is
listed under **"Archived programs (n)"** and can be restored.

It lands the decision the spec recorded as **Q3** (`crud-1-fix-it-yourself.md:846`): _"**Resolve in place**
(Move / Take off beside each name, then archive). Undo restores the archive and the assignments as one
event."_ Archive therefore composes with SCHED-1's `active_to` by **never coexisting with an open
assignment**: a program is archivable only once nobody is on it, and the server holds that invariant.

Why now: it is PROG-1 step 8, gated on CLONE-1 (which creates the pile) and SCHED-1 (whose `active_to`
it must compose with) — `crud-1-fix-it-yourself.md:163`.

## Acceptance

### Verbatim from the backlog row (`docs/plan.md:1966-1985`)

> **RETIRE-1 — archive a program so it stops appearing, without losing its history.** _(Maintainer,
> 2026-10-08.)_ CLONE-1 makes old versions pile up: every replacement leaves the previous program behind.
> Archiving hides a program from the program editor, from the list of programs to clone, and from new
> assignments. It changes nothing about the past: entries, their snapshotted prescriptions, and the
> assignment dates still render and export exactly as before.
>
> - **Archived is not deleted.** An archived program's history must stay readable, so archiving needs its
>   own marker, and the plan decides its shape. […]
> - **Undo is required:** an archived program can be restored.
> - **Open for the plan:** archiving a program that an athlete is still assigned to. Either it is
>   refused, or it closes the open assignments; both are defensible, and the UX panel should weigh which
>   one surprises a parent less.

The open question is **answered by Q3** (resolve in place; the UX panel overturned "close all" — spec
`:846`, `:1001`).

### Spec criteria this plan carries (`crud-1-fix-it-yourself.md:330-336`)

> 26. **While** anyone is on a program, archiving it **shall** first resolve each of them (move or take
>     off) in place — or, under Q3's other answer, close their assignments and say they have no program
>     in its place; **either way** Undo **shall** restore the archive **and** every assignment it closed
>     as one event. **(R1)** _(D6)_
> 27. **While** a program is archived, it **shall not** appear in the editor's program list, the copy
>     source list, or the move-to list, and every past entry against it **shall** render and export as
>     before. _(D6)_

Plus the slice of criterion 33 (`:361-367`) this chunk makes reachable: _"When the household has no live
program — after ONB-2 that happens only when every program has been archived — that step shall offer
exactly two paths, 'Start from The Daily Five' and 'Create a program'."_ RETIRE-1 owns the predicate
"live program" (archived counts as not live); D4c owns the two paths.

### Done when (observable)

1. `program_blocks.archived_at timestamptz NULL` exists in prod, applied by `migrate.yml`, before any code
   reads it (PR a observed applied before PR b merges).
2. Archiving a program **with nobody on it** sets `archived_at`; it leaves every list in criterion 27 and
   the Programs page's live list, and appears under "Archived programs (n)".
3. Archiving a program **with someone on it** is refused server-side with a typed `in_use` result naming
   them, writing nothing — unless the request names exactly the open assignments to take off, in which
   case they close and the program archives **in one transaction** (the prototype's "last Take off
   archives", below).
4. **Undo** after an archive restores `archived_at = NULL` **and** reopens exactly the assignments that
   archive closed, as one all-or-nothing event; if any of them changed since, it returns
   `AMEND_ERROR_COPY.staleWrite` (`apps/web/lib/constants.ts:540`) and writes nothing.
5. **Restore** from "Archived programs (n)" clears `archived_at` and reopens nobody (the prototype's
   _"restored. Nobody is on it until you move someone to it."_).
6. No assignment writer can open an assignment on an archived program (put on, move to, re-add): the
   writer refuses it under a row lock, so archive and a concurrent put-on cannot interleave into "archived
   with someone on it".
7. A month exported before and after an archive is **byte-identical**, with a non-empty `prescribed` cell
   in the fixture (V1-22 spec finding A1: an equality test on `''` passes vacuously, `v1-22…md:273`); a
   past date inside a closed period still renders the archived program's workout on the day page.
8. `db:seed` after an archive of a seeded program leaves it archived and reopens nothing (it runs against
   prod on every push to `main`).
9. With every program archived, the household's "has a live program" predicate is false, so A1's last
   step and the "No program yet" state show D4c's two paths.

## Where this sits in the code today (measured)

- `program_blocks` has **no lifecycle marker** — only `timestamps` (`created_at`, `updated_at`,
  `deleted_at`, `packages/db/src/schema.ts:35-40`) on the block (`schema.ts:785-806`). The slug arbiter
  `uq_program_blocks_household_slug` is partial on `deleted_at IS NULL` only (`schema.ts:800-802`).
- `program_assignments` / `program_assignment_weekdays` **do not exist** (last migration `0018`,
  `packages/db/migrations/0018_ten2d_validate_global_row_has_pattern.sql`). Their shape is the SCHED-1
  plan's chunk 1c (`docs/plans/sched-1-scheduling-model.md:279-379`): `active_from` NOT NULL, `active_to`
  nullable = open, `uq_program_assignments_profile_block_open` = at most one **open** assignment per
  `(profile, block)` (`:331-333`), `active_to >= active_from` CHECK (`:334-337`), overlap otherwise
  **writer-enforced** (`:297-299`).
- The only app reader of `program_blocks` is `programDayRows` (`packages/db/src/queries/program-day.ts:71-85`,
  newest live block holding a prescription for the role); the CSV export's `prescribed` column re-resolves
  through it per stored `day_role` (`apps/web/lib/dal/export.ts:113-135`). Its docblock still says _"An
  explicit active-block marker is the real fix"_ (`program-day.ts:45-46`), which ADR 0007 decision 4
  **withdrew** (`docs/decisions/0007-scheduling-model.md:296-303`). `archived_at` is **not** that marker
  and must never be read there (Decision 4).
- `seedProgram` inserts a block with `onConflictDoNothing` on `(household_id, slug) WHERE deleted_at IS
NULL` and re-resolves it by the same key (`packages/db/src/seed.ts:417-441`), and runs on every merge
  (`seed.ts:295`; `.github/workflows/migrate.yml:12`).
- `scope.householdId` may be unwrapped **only** in `packages/db/src/writers/ownership.ts`
  (`packages/db/src/scope.test.ts:56`), so any "block in this household" predicate lives there, beside
  `inHousehold` / `isLiveProfile` (`ownership.ts:113-125`).
- The shipped `'use server'` modules are pinned to exactly two
  (`apps/web/app/pages-are-gated.test.ts:228`), and the per-route boundary list is `MUTATING_ACTIONS`
  (`apps/web/app/p/[profileId]/mutating-actions.ts:24-32`).
- `ActionState` is `{ ok, error, fieldErrors?, savedId? }` (`apps/web/app/p/[profileId]/action-state.ts:8-17`).

## What this plan depends on that does not exist yet

RETIRE-1 is the eighth PROG-1 step. Its sibling plans are being drafted in parallel and **were not on
disk when this was written** (`docs/plans/` has no `assign-1-*`, `clone-1-*`, `v1-22-a4-*`), so the
interfaces below are **stated, not verified**. Each PR re-checks them against what merged; a mismatch is a
plan revision, not an improvisation.

| From                      | Interface RETIRE-1 depends on                                                                                                                                                                                                                                                                                               | If it lands differently                                                                                      |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **SCHED-1 1c** (D3)       | the two tables above, applied in prod                                                                                                                                                                                                                                                                                       | nothing to compose with — RETIRE-1 cannot start                                                              |
| **ASSIGN-1** (D4b)        | (1) one writer that **closes** an open assignment for an athlete's "today" (criterion 21's `active_to` = the day before, including its same-day rule, whatever that is), and one that **reopens** a closed one; both set `updated_at = sql\`now()\``; (2) one writer that **opens** an assignment (put on, move to, re-add) | if close/reopen are inline in actions rather than writers, PR b extracts them first (a refactor, its own PR) |
| **ASSIGN-1** (D4b)        | the "athlete-local today" resolution criterion 21 defines (_"the athlete's declared day, the one Today renders, never the parent's device clock"_)                                                                                                                                                                          | RETIRE-1 calls it; it never computes "today" itself                                                          |
| **ASSIGN-1 / CLONE-1**    | a household **Programs** page (spec Q5: under Household settings, `:848`) listing live programs with "who's on it" chips and per-card actions; prototype `vPrograms()` (`docs/prototypes/crud-1/index.html:3638-3779`)                                                                                                      | if neither creates it, RETIRE-1 does not either — it is a screen with its own UX panel; PR d waits           |
| **V1-22 ch 4/6** (D1, D2) | one household-scoped program **list** query that every list in criterion 27 reads (the V1-22 editor plan names `packages/db/src/queries/program-blocks.ts`, "List blocks + load one for editing", `docs/plans/v1-22-program-editor.md:193`)                                                                                 | if the lists use separate queries, PR b adds the predicate to each and counts them in the PR body            |
| **D4c** (V1-22 A4)        | a "household has a live program" predicate behind criteria 32–33, and the Daily Five copy via ONB-2's household-creation writer                                                                                                                                                                                             | see the slug collision under Risks — a contract D4c and RETIRE-1 must agree on, whichever lands first        |
| **CRUD-1 U0**             | `components/ui/sheet.tsx` — only through ASSIGN-1's Move sheet; RETIRE-1's own confirm is inline, not a sheet                                                                                                                                                                                                               | —                                                                                                            |
| **AUTH-1 1c**             | the session-scoped `getHouseholdScope()` (`apps/web/lib/dal/household.ts:68`) and `requireSession()` on pages                                                                                                                                                                                                               | see "AUTH-1 1c: what to re-verify"                                                                           |

## Decisions

### 1. The marker: `program_blocks.archived_at timestamptz NULL`

One nullable column on the block. `NULL` = live; a value = archived, and **when**.

- **Why on `program_blocks`.** An assignment points at a block (SCHED-1 1c), the clone grain is a block
  (CLONE-1 row), and the UI's "program" is a block. Nothing below the block (prescriptions, targets) has a
  lifecycle of its own.
- **Why a timestamp, not a boolean.** It is the archive event's identity (Decision 3) and gives the
  Archived list an order and a date, at no extra cost.
- **Why nullable with no default and no backfill.** `ADD COLUMN … timestamptz` with no default is a
  catalog-only change on Postgres 11+ (no rewrite), every existing block is live, so `NULL` is the correct
  value for every existing row. No `NOT VALID` → `VALIDATE` dance applies — there is no constraint.
- **No index.** Every reader already filters by `household_id` through `idx_program_blocks_household`
  (`schema.ts:799`), and a household holds a handful of blocks. A partial index on a column read only
  inside one household's handful of rows is cost with no plan to use it.
- **The slug arbiter is NOT changed.** An archived block keeps its slug in `uq_program_blocks_household_slug`.
  This is deliberate: (a) Restore can then never collide; (b) `seedProgram`'s arbiter keeps matching an
  archived seeded block, so the seed **cannot resurrect** it as a new live copy (`seed.ts:426-441`);
  (c) re-predicating a unique index is an index drop + `CREATE … CONCURRENTLY` in its own file — the most
  expensive migration shape in AGENTS.md, for no gain. The cost is the D4c slug collision under Risks.
- **Consistency with A2.** PROF-1b (A2) owes the athlete archive marker (spec unowned 4, Q8 "one nullable
  column"). This plan recommends A2 use the **same name and type** (`profiles.archived_at timestamptz
NULL`), so a dashboard filters both lifecycles one way (spec → "Later milestones", `:633-634`).
  Whichever lands second matches the first.

**Alternatives rejected:**

| Alternative                                                                                             | Why rejected                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Reuse `deleted_at`**                                                                                  | Forbidden: ADR 0008 → Backlog impact, `RETIRE-1` must NOT _"reuse `deleted_at`"_ (`docs/decisions/0008-deletion.md:158`). A hide is invisible and ends in erasure at `N`; an archived program must stay readable in place (`:77`). It would also free the slug, and the seed would re-insert a live copy on the next merge. |
| **Derive "archived" from "no open assignment"**                                                         | A fresh copy nobody is on yet is live (prototype: _"Nobody is on this program"_ in the live list, `index.html:3684`), and a just-restored program has nobody on it. Lifecycle ≠ occupancy.                                                                                                                                  |
| **`status text` + CHECK (`'live'`/`'archived'`), reference-table-sourced**                              | Two states, one of which is "absent". A NOT NULL status needs a default + backfill shape on a live table for no extra meaning, and loses the "when". If a third state ever arrives, `archived_at` → `status` is an additive expand.                                                                                         |
| **An `archived` boolean**                                                                               | Loses the event identity Decision 3 needs; the Archived list would have no order.                                                                                                                                                                                                                                           |
| **A `program_block_archives` event table** (who archived, when, history of archive/restore)             | YAGNI. No row asks for archive history, and there is no `who` to record before AUTH-1 (ADR 0008 decision 4). Additive later.                                                                                                                                                                                                |
| **The withdrawn "active-block marker"** (ADR 0007 decision 4)                                           | Withdrawn because "which block answers today" is a query over live assignments. `archived_at` answers a **different** question — "is this offered in lists" — and is never read by dueness (Decision 4).                                                                                                                    |
| **Free the slug on archive** (re-predicate the arbiter to `deleted_at IS NULL AND archived_at IS NULL`) | See above: Restore could then collide (a new typed refusal), the seed would resurrect archived seeded programs, and the migration is an index rebuild.                                                                                                                                                                      |

### 2. Archive composes with `active_to` by never coexisting with an open assignment

**The invariant:** _no `program_assignments` row with `active_to IS NULL AND deleted_at IS NULL` points at
a block whose `archived_at IS NOT NULL`._ It is **writer-enforced** (a cross-table rule no CHECK can
state), in exactly two places, both under a lock on the block row:

- **Archive** (`archiveProgram`, new): `SELECT … FOR UPDATE` on the block, then reads its open
  assignments; refuses with `in_use` unless the request names exactly those to take off (below).
- **Open an assignment** (ASSIGN-1's put-on / move-to / re-add writer): PR b adds a `SELECT … FOR SHARE`
  on the target block with `archived_at IS NULL` in the same transaction as the insert, returning a typed
  `archived` refusal. `FOR SHARE` conflicts with `FOR UPDATE`, so the two transactions serialize under
  READ COMMITTED; without the lock both checks pass on their snapshots and the invariant breaks.

**Resolve in place, as the server sees it.** `archiveProgram({ blockPublicId, takeOffProfilePublicIds })`:

- **Nobody on it** and `takeOff = []` → archive.
- **Someone on it** and `takeOff` ≠ exactly the set of athletes with an open assignment on it → `in_use`
  naming who is on it now; nothing written. This is also the stale guard: someone put on in another tab
  since the page loaded makes the sets differ.
- `takeOff` = exactly that set → close each through ASSIGN-1's close writer, then archive, **one
  transaction**, one event.

**How the prototype uses that** (`index.html:4782-4806`, approved in v8): "Archive…" opens an inline
panel naming who is on it, with **Move…** (ASSIGN-1's sheet; its own event and Undo) and **Take off**
beside each name. A Take off that leaves **someone else** still on it is ASSIGN-1's plain take-off (its
own Undo). The Take off that empties the program **archives in the same tap** (_"archived. Nobody was
left on it."_) — RETIRE-1's `archiveProgram` with `takeOff = [that athlete]`, so its Undo restores the
archive **and** that assignment together. After a Move empties it, the panel asks _"Archive {name}?
Nobody is on it."_ → `archiveProgram` with `takeOff = []`.

⚠️ **Spec vs prototype, said rather than resolved silently.** Criterion 26 says Undo restores _"every
assignment it closed"_. Under resolve-in-place the archive event closes **at most one** assignment (the
last take-off); earlier take-offs and moves were their own events, with their own Undo, which the next
action replaced. The prototype implements exactly that (`S.undo = { kind: 'archive', block, reopen: [asg] }`,
`:4802`). This plan follows the approved prototype and reads criterion 26 literally. **For the UX panel:**
(a) is an archive that happens **without a final confirm** on the last Take off right, when the Move path
asks one (`:3755`)? (b) should "Undo" after archive instead put back **everyone who was on it when
Archive… was opened**? The server shape supports (b) unchanged — the client would stage every Take off and
send them in one `takeOff` list — so it is a UX decision, not an engineering one.

**Q3's other answer** ("close all", `index.html:1147`) is the same server call with `takeOff` = everyone.
It is not built in the UI; nothing in the server would need to change if the maintainer reversed Q3.

**Alternatives rejected:** _refuse while anyone is on it, with no in-place resolution_ — the row's other
option, overturned by the UX panel (U25, spec `:1001`); _close silently on archive_ — Q3's overturned
answer, which leaves a kid with an empty Today; _an archive that leaves future-dated or open assignments
running until they end_ — the invariant would then be "archived but still due", which is exactly the
second, drifting answer to "is this active" ADR 0007 decision 4 rejects.

### 3. The archive event's identity is `archived_at`, and Undo is derived from it

Every write in the archive transaction uses Postgres `now()` — transaction start time — so the block's
`archived_at` and the `updated_at` of every assignment the transaction closed are **equal**. The event is
therefore `(block, archived_at)`, and the assignments it closed are exactly:

```
program_assignments WHERE block_id = <block> AND updated_at = <archived_at> AND active_to IS NOT NULL
```

This is the same proposal the spec makes for a hide event (`crud-1-fix-it-yourself.md:511-515`: _"A hide
event's identity is its `deleted_at` value — no new column"_), and it rests on the same premise: the
writers use `sql\`now()\``, never a JS clock or `clock_timestamp()`, the idiom already shipped at
`packages/db/src/writers/strength-session.ts:437`and`writers/bodyweight.ts:86`.

It buys three things with no new column and no client-held list:

- **Replay is identical** (AGENTS.md backend rule 6). A replayed archive finds the block already archived
  and returns `{ archivedAt, closed }` derived the same way — the same response, no second effect.
- **Undo is all-or-nothing and stale-safe.** `restoreProgram({ blockPublicId, undoOf: archivedAt })` locks
  the block; if `archived_at ≠ undoOf` (restored, or re-archived, since) → `staleWrite`. It derives the
  closed set; if any of those athletes is no longer live (A2 archived them, or a later chunk deleted
  them) → `staleWrite`, nothing written. Otherwise it reopens each through ASSIGN-1's reopen writer and
  clears `archived_at` in one transaction. Reopening cannot hit `uq_program_assignments_profile_block_open`,
  because the archived block could take no new assignment meanwhile (Decision 2).
- **No trust in the client.** The token is `(blockPublicId, archivedAt)`; the server re-derives everything
  inside the household scope. A forged token can at most reopen this household's own closed rows on this
  block — which "put on" can already do.

**The limit, stated:** a closed assignment whose `updated_at` moved after the archive is no longer found
by the derivation, so the Undo would reopen fewer rows than it closed. Through the app a closed period is
never edited (ASSIGN-1 changes **open** periods; HIST-1 is read-only), so this needs a correction script
to happen. **ASSIGN-1 must confirm it never updates a closed row** — or this falls back to the alternative
below.

**Alternative (the fallback, not chosen):** the FE-7 token (`crud-1-fix-it-yourself.md:919`) — the Undo
carries `{ archivedAt, reopen: [{ assignmentPublicId, activeTo }] }` and the server compare-and-swaps each
row. Stronger on the limit above; costs a client-held list the server must re-authorize id by id, and a
replay can no longer return the identical response without storing the list. **⚠️ Flagged for the
correctness panel**, as the spec flags the hide-event proposal for B1's.

### 4. Archive filters lists — and only lists

`archived_at` is read in exactly these places, through one predicate:

| Reader                                                                                                      | Reads `archived_at`?     | Why                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The household program list query (Programs page live list; editor list; copy source list; assignment sheet) | **yes** — live only      | criterion 27                                                                                                                                                                            |
| The same query in "archived" mode (the "Archived programs (n)" disclosure)                                  | **yes** — archived only  | the Restore surface                                                                                                                                                                     |
| "Household has a live program" (criteria 32–33)                                                             | **yes**                  | archived ≠ live (criterion 33)                                                                                                                                                          |
| ASSIGN-1's open-assignment writer                                                                           | **yes** (refuse)         | Decision 2                                                                                                                                                                              |
| `programDayRows` (`program-day.ts:52-141`)                                                                  | **no — must not**        | it still feeds the export's legacy `prescribed` path (`export.ts:121`); filtering would change which block the legacy match resolves and rewrite historical bytes                       |
| ASSIGN-READ's dueness read (Today, and any past day on the day nav)                                         | **no — must not**        | an archived program has no open assignment, so it is never due today; for a **past** date inside a closed period the day page must keep rendering it (criterion 27, "render as before") |
| The CSV export, HIST-1's reads, the snapshot writer                                                         | **no — must not**        | history; the export's immobility stays **structural**, as SCHED-1's "export finding" made it (`sched-1-scheduling-model.md:119-143`)                                                    |
| The V1-22 editor's **save** and CLONE-1's **copy** writers                                                  | **no** (UI absence only) | see below                                                                                                                                                                               |

**Why editor saves and copy are not server-refused.** Neither breaks an invariant: once V1-22 chunks 2–3
have shipped (a gate of D5, therefore of D6), history reads snapshots, so editing an archived program
changes no logged day; and copying one yields a **live** program, which is a legitimate "start again
from last season's program" path a later row may want. A stale editor tab saving into an archived program
is therefore harmless, and refusing it would add a guard to two other chunks' writers for no protected
property. **For the panel** — reversible: one predicate in two writers if the panel disagrees.

The predicate, single-sourced in `packages/db/src/writers/ownership.ts` beside its siblings (the file's
own rule: extracted with ≥2 consumers):

```ts
/** `program_blocks.household_id = <scope>` — THIS household's programs. Lives here because only this
 *  module may unwrap the scope (scope.test.ts:56). */
export function blockInHousehold(scope: HouseholdScope) { … }

/** A program offered in LISTS: not hidden, not archived. NEVER use in a dueness, history or export read —
 *  RETIRE-1 Decision 4. */
export function programIsListed() {
  return and(isNull(schema.programBlocks.deletedAt), isNull(schema.programBlocks.archivedAt));
}
```

⚠️ If SCHED-1/ASSIGN-READ already named `blockInProfileHousehold()` (the SCHED-1 panel's C2,
`sched-1-scheduling-model.md:716`) or V1-22 named a block-scope predicate, PR b **reuses** it rather than
adding a sibling. Named `programIsListed`, not `isLiveProgram`, so nobody reaches for it in a dueness read.

### 5. The Daily Five and "no live program"

After ONB-2 every household starts with The Daily Five, so **the only way to reach "no live program" is
to archive every program** (spec unowned 7, `:677-689`). RETIRE-1 makes that reachable; D4c owns what the
parent then sees (criterion 33: "Start from The Daily Five" / "Create a program"). The predicate is
`EXISTS (block in household AND programIsListed())`, single-sourced, used by A1's last step, the "No
program yet" state and the assignment sheet.

**The collision this creates (a cross-plan contract, not RETIRE-1's to build):** the household whose
Daily Five is archived is the **exact** household criterion 33 offers "Start from The Daily Five" to, and
its archived block still holds slug `daily_five` (Decision 1). ONB-2's writer inserting a fresh copy will
either raise `23505` or — with the `onConflictDoNothing` + re-resolve idiom `seedProgram` uses
(`seed.ts:426-441`) — **silently resolve to the archived block and assign the athlete to it**, which
Decision 2's guard then refuses. **Recommendation for D4c:** when the household holds an archived block
with the default's slug, "Start from The Daily Five" **restores** it (`restoreProgram` without `undoOf`)
and puts the athlete on it, in one transaction, and its Undo reverses both (criterion 45's "keep the
program" rule then means: re-archive it). The same check applies to "Create a program" and CLONE-1 when a
typed name slugs to an archived block's slug; the duplicate-name warning that already includes archived
names (IXD-7, spec `:1088`) is where the parent sees it. **The spec's criterion 33 is silent on this.**

## Staging

Four PRs, each one concern. RETIRE-1 owes no PR before its gates; none starts before Beta 1's gate (D3).

| PR    | Branch                             | What                                                                                                           | ~lines (hand-written) | Gate                                                                                                                    |
| ----- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **a** | `db/retire-1a-program-archived-at` | The column, shipped dark: schema, migration, `db:verify` shape proof, inventory row, architecture ERD          | ~90 + generated meta  | D5 (CLONE-1) merged; SCHED-1 1c applied; ADR 0008 signed (it is: `0008:46`)                                             |
| **b** | `feat/retire-1b-archive-writer`    | `archiveProgram` / `restoreProgram` writers, the two predicates, the list filter, the assignment guard, proofs | ~320                  | **a observed applied in prod** (the runbook's catalog query) — the expand-before-reader rule; ASSIGN-1's writers merged |
| **c** | `feat/retire-1c-archive-actions`   | DAL + two Server Actions + boundary tests, still no UI                                                         | ~300                  | b                                                                                                                       |
| **d** | `feat/retire-1d-archive-ui`        | Programs page: Archive…, the resolve panel, Undo line, "Archived programs (n)"; a11y scan; screenshots         | ~290                  | c + the Programs page exists + **UX panel reconciled in this plan** + ASSIGN-1's Move sheet                             |

**Why a is alone.** One migration per PR (AGENTS.md), and the column must be **applied before** any
deployed code reads it: `migrate.yml` and the Vercel deploy both fire on merge, so a PR carrying both the
column and its first reader races its own migration. **Why b and c split.** Together ~620 lines; b is
`packages/db` + `shared` (DB-safety review), c is `apps/web` (the 7-point backend rules). **c+d may merge**
if d measures under ~150 lines — decided at c's review, not under pressure.

## File-by-file changes

Paths for the Programs route and its actions module are **placeholders** (`<programs>`) until ASSIGN-1 /
CLONE-1 fix them; spec Q5 puts the page under Household settings.

### PR a — the column, dark

| Path                                                                 | Change   | What & why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/db/src/schema.ts`                                          | EDIT     | `archivedAt: timestamp('archived_at', { withTimezone: true })` on `programBlocks`, after `notes`. Docblock: archive ≠ hide (ADR 0008 `:71`, `:77`); lists only (Decision 4, with the "never in dueness/history/export" warning); the slug is deliberately kept (Decision 1); the writer-enforced invariant (Decision 2).                                                                                                                                                                                                         |
| `packages/db/migrations/00NN_retire1_program_blocks_archived_at.sql` | NEW      | `drizzle-kit generate`'d, hand-hardened in the 0015 house style: `SET lock_timeout = '5s'; SET statement_timeout = '60s';` then `ALTER TABLE "program_blocks" ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone;`. Header: WHY, the lock (`ACCESS EXCLUSIVE`, catalog-only, no rewrite, no scan), re-run safety, what `db:verify` does not prove. **No production numbers** (forward-only makes them permanent). `NN` is whatever is next at generate time — the SCHED-1 plan's `0017` is already taken by TEN-2c. |
| `packages/db/migrations/meta/_journal.json` + snapshot               | EDIT/NEW | Generated; `generate` must leave a clean tree (the drift guard).                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `packages/db/scripts/verify.ts`                                      | EDIT     | `columnsOf('program_blocks')` asserts `archived_at` is `timestamp with time zone`, **nullable**, no default — so a later "make it NOT NULL DEFAULT now()" slip fails the build.                                                                                                                                                                                                                                                                                                                                                  |
| `docs/architecture.md`                                               | EDIT     | §4 ERD: `program_blocks.archived_at`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `docs/privacy/data-inventory.md`                                     | EDIT     | The `program_blocks` row (`:128`): `archived_at` — when a parent archived it; an archived program is **kept in full** (it is history), is **not** a hide and is **not** purged at `N`, and goes with the household under the deletion runbook (`docs/runbooks.md:981`, `program_blocks` by household). No new personal data.                                                                                                                                                                                                     |
| `docs/changelog/<date>-db-retire-1a-program-archived-at.md`          | NEW      | A `db/` branch must add one (`status:check`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `docs/plan.md`, `docs/roadmap.md`, `docs/status.md`                  | EDIT     | One line each: the RETIRE-1 row links this plan; roadmap moves it to In flight.                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

**Squawk:** an `ADD COLUMN` with no default and no constraint trips none of `.squawk.toml`'s rules as
far as this plan can tell (**unverified until run**: `npx squawk-cli@2.66.0 -c .squawk.toml <file>`, the
CI invocation per the SCHED-1 plan `:388-389`; paste the output in the PR body).

**Deploy hazard to check at a:** adding a column to `schema.ts` changes what a projection-less
`db.select().from(schema.programBlocks)` selects; if such a select exists when a merges and Vercel deploys
before `migrate.yml` applies the column, it fails. Today there is none (the only readers select `{ id }`,
`program-day.ts:72`, `seed.ts:432`); by D6, V1-22's `queries/program-blocks.ts` may have one. **a greps for
it**; if found, it gets an explicit projection in a.

### PR b — the writers, the predicates, the guard

| Path                                                                               | Change | What & why                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/db/src/writers/ownership.ts`                                             | EDIT   | `blockInHousehold(scope)` (or reuse an existing block-scope predicate — Decision 4) and `programIsListed()`.                                                                                                                                                                                                                                                                                                        |
| `packages/db/src/writers/program-archive.ts`                                       | NEW    | `archiveProgram(exec, args)` and `restoreProgram(exec, args)` — each **one transaction**, shapes below.                                                                                                                                                                                                                                                                                                             |
| `packages/db/src/index.ts`                                                         | EDIT   | Export the two writers and the result types.                                                                                                                                                                                                                                                                                                                                                                        |
| ASSIGN-1's open-assignment writer (path per ASSIGN-1)                              | EDIT   | `SELECT … FOR SHARE` on the target block with `blockInHousehold(scope)` and `programIsListed()`; typed `{ ok: false, reason: 'archived' }`. The one write path that could break Decision 2's invariant.                                                                                                                                                                                                             |
| The program list query (V1-22's `queries/program-blocks.ts`, or each list's query) | EDIT   | `programIsListed()` in the default mode; an `archived` mode (`isNotNull(archivedAt)`, `isNull(deletedAt)`, newest `archived_at` first) for the disclosure. The "has a live program" `EXISTS` beside it.                                                                                                                                                                                                             |
| `packages/shared/src/programming.ts`                                               | EDIT   | `programArchiveSchema`, `programRestoreSchema` (below) — the spec's data contract has no archive shape, so this is **additive** to it.                                                                                                                                                                                                                                                                              |
| `packages/db/scripts/verify.ts`                                                    | EDIT   | The proofs under Test plan.                                                                                                                                                                                                                                                                                                                                                                                         |
| `packages/db/scripts/mutations/NN-archive-lists-everything.patch` + `.expect`      | NEW    | Drops `programIsListed()` from the list query → `db:verify` must go red.                                                                                                                                                                                                                                                                                                                                            |
| `packages/db/scripts/mutations/NN-assign-into-archived.patch` + `.expect`          | NEW    | Drops the `archived_at` conjunct from the open-assignment guard → red.                                                                                                                                                                                                                                                                                                                                              |
| `docs/features/write-path.md`                                                      | EDIT   | `guides:check` (owns `packages/db/src/writers/`). Invariant: the archive/open-assignment lock pair; archive event identity = `archived_at`.                                                                                                                                                                                                                                                                         |
| `docs/features/programming.md`                                                     | EDIT   | `guides:check` (owns `packages/shared/src/programming.ts`, `packages/db/src/queries/program-day.ts`). New invariant: **`archived_at` filters lists only** — the Decision 4 table, so a later change to `programDayRows` or the export cannot quietly adopt it. And the `program-day.ts:45-46` "active-block marker" sentence is stale (ADR 0007 d4) — the guide says so; `program-day.ts` itself is **not** edited. |
| `docs/changelog/…`                                                                 | NEW    | Fragment.                                                                                                                                                                                                                                                                                                                                                                                                           |

```ts
// packages/shared/src/programming.ts
export const programArchiveSchema = z.object({
  blockPublicId: uuidSchema,
  // Exactly the athletes the parent is taking off in this same event (resolve in place). Unique; the
  // cap is the household's athlete count in practice — bounded by a named PROGRAM_ARCHIVE_TAKE_OFF_MAX
  // so a crafted body cannot make the writer loop.
  takeOffProfilePublicIds: z.array(uuidSchema).max(PROGRAM_ARCHIVE_TAKE_OFF_MAX).default([])
    .refine(uniq, …),
});
export const programRestoreSchema = z.object({
  blockPublicId: uuidSchema,
  undoOf: z.iso.datetime({ offset: true }).optional(), // the archive event; absent = plain Restore
});
```

```ts
// packages/db/src/writers/program-archive.ts — result shapes (internal ids never leave)
type ArchiveResult =
  | { ok: true; archivedAt: string; closed: Array<{ profilePublicId: string; name: string }> }
  | { ok: false; reason: 'not_found' } // not this household's, hidden, or malformed — ADR 0006 404 semantics
  | { ok: false; reason: 'in_use'; onIt: Array<{ profilePublicId: string; name: string }> };

type RestoreResult =
  | { ok: true; reopened: Array<{ profilePublicId: string; name: string }> }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'stale' }; // undoOf ≠ archived_at, or an athlete in the event is gone
```

`archiveProgram`, in order, in one transaction: lock the block `FOR UPDATE` by
`public_id` + `blockInHousehold(scope)` + `deleted_at IS NULL` (none → `not_found`) → if already archived,
return the derived event (replay) → read open assignments joined to **live, in-scope** profiles → compare
with `takeOff` (≠ → `in_use`) → close each via ASSIGN-1's close writer with that athlete's "today" →
`UPDATE program_blocks SET archived_at = now(), updated_at = now() WHERE id = $ AND archived_at IS NULL`.

`restoreProgram`: lock `FOR UPDATE` → not archived: `undoOf` absent → `ok` with `reopened: []` (replay of
a Restore), present → `stale` → `undoOf` present and ≠ `archived_at` → `stale` → derive the event's closed
rows (Decision 3); any whose profile is not live and in scope → `stale` → reopen each via ASSIGN-1's
reopen writer → `archived_at = NULL, updated_at = now()`.

### PR c — the DAL and the actions

| Path                                                  | Change | What & why                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/web/lib/dal/programs.ts` (or ASSIGN-1's module) | EDIT   | `archiveProgram(input)` / `restoreProgram(input)`: `getHouseholdScope()` (null → `not_found`), uuid guard, `db.transaction`, map the writer result to a DTO. `listArchivedPrograms()` → `Array<{ blockPublicId, name, archivedAt }>`. `server-only`.                                                                                                               |
| `apps/web/app/<programs>/actions.ts`                  | EDIT   | `archiveProgramAction`, `restoreProgramAction`: `Sentry.withServerActionInstrumentation` (the `actions.ts:84` idiom), zod-parse first (bad body → `fieldErrors`, nothing written), call the DAL, map `not_found`/`in_use`/`stale` to the typed envelope, `revalidatePath` the Programs page and every `/p` page (an archive closes assignments Today reads). Thin. |
| `apps/web/app/<programs>/action-state.ts` (sibling)   | EDIT   | `ProgramArchiveState = ActionState & { undoOf?: string }` — the token the Undo line posts back. The `action-state.ts` precedent: a `'use server'` module may export only async functions.                                                                                                                                                                          |
| `apps/web/app/<programs>/mutating-actions.ts`         | EDIT   | Both actions in that route's `MUTATING_ACTIONS` map, so the boundary suites enumerate them (`mutating-actions.ts:4-14`'s rule).                                                                                                                                                                                                                                    |
| `apps/web/lib/constants.ts`                           | EDIT   | `PROGRAM_ARCHIVE_COPY` (in-use, archived, nobody-left, restored, the Undo label) and `PROGRAM_ARCHIVE_TAKE_OFF_MAX` if not in `shared`. `staleWrite` **reused** from `AMEND_ERROR_COPY` (`:540`), not re-typed.                                                                                                                                                    |
| `apps/web/app/<programs>/actions.test.ts`             | EDIT   | The boundary tests (Test plan).                                                                                                                                                                                                                                                                                                                                    |
| `docs/features/write-path.md`                         | EDIT   | Owns `apps/web/lib/dal/`.                                                                                                                                                                                                                                                                                                                                          |

No rate limit: the shipped mutating actions have none (`apps/web/app/p/[profileId]/actions.ts` calls no
`checkRateLimit`; only the gate does, `apps/web/lib/rate-limit.ts:36`). AGENTS.md asks for one on
mutations; that gap is repo-wide and belongs to its own row, not to RETIRE-1. Said so the panel can
disagree.

### PR d — the UI (prototype screen **programs**, `index.html:3638-3779`, approved v8)

| Path                                            | Change | What & why                                                                                                                                                                                                                          |
| ----------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/app/<programs>/page.tsx`              | EDIT   | Fetch `listArchivedPrograms()` beside the live list (one more await in the existing `Promise.all`).                                                                                                                                 |
| `apps/web/app/<programs>/archive-program.tsx`   | NEW    | `'use client'` island per program card: the **Archive…** button; the inline resolve panel (who is on it, **Move…** → ASSIGN-1's sheet, **Take off**); the "Nobody is on it" confirm; `useActionState` on the two actions.           |
| `apps/web/app/<programs>/archived-programs.tsx` | NEW    | RSC `<details>` "Archived programs (n)" with a `<ul>` of name + **Restore** (a `<form>` per row — no client JS needed).                                                                                                             |
| `apps/web/app/<programs>/archive-undo.tsx`      | NEW    | The untimed "{name} archived. Undo" line at the top of the list (the archived card has left it — prototype `:3646`), holding `undoOf` in client state **keyed by block**, gone when the page is left (FE-6's keying, applied here). |
| `apps/web/e2e/a11y.spec.ts`                     | EDIT   | The Programs route with the resolve panel open and the disclosure expanded (spec unowned 8 — each UI chunk adds its states).                                                                                                        |
| `apps/web/e2e/<programs>.spec.ts`               | EDIT   | One flow: archive an empty program → gone from the list → Undo → back.                                                                                                                                                              |
| `docs/features/programming.md`                  | EDIT   | Owns the Programs route files (assumed, per ASSIGN-1).                                                                                                                                                                              |

**Semantics and focus** (the spec's round-1 fixes U5, U23, A11Y-5, PUX-7 already shaped the prototype):

- Every repeated control names its subject: `aria-label="Archive {program}…"`, `"Move {athlete}"`,
  `"Take {athlete} off {program}"`, `"Restore {program}"` (prototype `:3697`, `:3725`, `:3731`, `:3772`).
- **Archive…** → focus moves to the panel (`tabindex="-1"`, the prototype's `#archq-…`); **Cancel** →
  back to **Archive…**; after archive → the **Undo** button; after Undo → the restored card; after Restore
  → the restored card. Never `<body>` (U5).
- The panel is **inline**, not a modal, so one page-level `role="status"` region (mounted before its
  text changes — the `saved-announcer.tsx` idiom) announces outcomes. Move… opens ASSIGN-1's sheet, whose
  own in-sheet status region is ASSIGN-1's (criterion 46); on close, focus returns to the panel.
- **Take off** uses the tinted destructive treatment (`components/ui/button.tsx`; U22), not solid red.
- Copy follows the prototype verbatim: _"{names} is/are still on it. Move them or take them off, then
  archive."_, _"Archive {name}? Nobody is on it."_, _"{name} archived. Nobody was left on it."_,
  _"{name} restored. Nobody is on it until you move someone to it."_ An `in_use` refusal re-renders the
  panel with the server's list and says `staleWrite`.

**360px width math.** Viewport 360 − `px-4` page gutter ×2 (`apps/web/app/p/page.tsx:31`'s `max-w-2xl px-4`
shape) = **328**; − the card's `--card-spacing` 16 ×2 (`components/ui/card.tsx:15`) = **296** (the spec
measured 294 in the prototype, `:787-788`). The panel sits **in** the card with no padding of its own
(no card in a card, CD-7).

| Row                                      | Contents (text-sm 14px, `px-2.5` = 20px padding, `gap-2` = 8px) | Width                                                              |
| ---------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------ |
| resolve row: `[name] [Move…] [Take off]` | Move… ≈ 38 + 20 = 58; Take off ≈ 55 + 20 = 75; two gaps 16      | buttons 149 → **name gets 147px** (≈ "Athlete One" at 16px is ~90) |
| card actions: `[Edit] [Archive…]`        | ≈ 48 + ≈ 78 + 8                                                 | 134 of 296                                                         |
| archived row: `[name] [Restore]`         | Restore ≈ 50 + 20 = 70                                          | name gets ~218                                                     |

Glyph widths are **estimates** (≈7px per character at 14px); the PR measures the real row at 360px in
Playwright and records it. A long name wraps (`min-w-0`, `overflow-wrap:anywhere`, U27); every button is
`min-h-11` by construction (`button.tsx:10-20`) and ≥44px wide at these labels. Screenshots at 390 / 820 /
1280 via the `ui-screenshot` skill: the panel open with two athletes, after the archive (Undo line), the
disclosure open.

## Test plan

**`db:verify` (PGlite, PR a + b).** Every fixture in a rolled-back transaction, the TEN-2a idiom.

- (a) `archived_at` is nullable `timestamptz` with no default.
- `archiveProgram` with nobody on it sets `archived_at`; the list query omits the block; the archived
  mode returns it; "has a live program" is false when every block is archived and true after a Restore.
- **`in_use`:** one open assignment, `takeOff = []` → refused, `archived_at` still NULL, the assignment
  still open. `takeOff` naming a **different** athlete → refused. `takeOff` = exactly the set → the
  assignment's `active_to` is the day before, `archived_at` is set, and **`updated_at` = `archived_at`**
  (the event-identity premise, proved, not asserted).
- **Replay:** a second `archiveProgram` with the same input returns a deep-equal result and writes
  nothing (`updated_at` unmoved).
- **Undo:** `restoreProgram({ undoOf })` reopens exactly the event's rows and clears the marker; with a
  wrong `undoOf` → `stale`, nothing written; with an athlete in the event soft-deleted → `stale`, nothing
  written (all-or-nothing); a plain Restore reopens nobody.
- **The guard:** ASSIGN-1's open writer on an archived block → `archived`, no row. (The race itself is
  not provable on single-connection PGlite — `sched-1…md:532-534` — so the lock is review-enforced and
  named in the writer's docblock; the unit test asserts the `FOR SHARE` is issued.)
- **Cross-household:** archive/restore of another household's block → `not_found`, nothing written —
  the `01-drop-household-conjunct` shape.
- **History does not move:** a fixture month with one entry carrying a non-empty `prescribed_snapshot`
  and one with a **NULL** snapshot (the legacy `(day_role, movement)` path, `export.ts:98-135`) whose
  live match is non-empty; export → archive → export; byte-identical. And ASSIGN-READ's due read for a
  past date inside the closed period still returns the archived block.
- **The seed cannot resurrect:** archive the seeded YDP in the transaction, call `seedProgram` again →
  still archived, one block row for the slug, no open assignment. (⚠️ Verify the harness can call
  `seedProgram` inside the fixture transaction; if not, a dedicated fixture.)
- **`db:mutations`:** the two patches go red.

**Vitest (PR b, c).** Schema tests: non-uuid, duplicate ids, over the cap → rejected. Action tests as
plain async functions with mocked auth and DAL (AGENTS.md → Testing gotchas), through the route's
`MUTATING_ACTIONS`: **unauth → reject**; **wrong household → `not_found` semantics, nothing written**;
**bad body → `fieldErrors`, DAL not called**; **replay → one effect, identical response**; `in_use` and
`stale` map to their copy; `revalidatePath` called for the Programs page and `/p`.

**E2E / a11y (PR d).** `pnpm e2e:local` — the flow spec and the a11y scan of both new states. Real-phone
check: none new — the panel is not a modal; the Move sheet's checks are ASSIGN-1's.

**Local:** `pnpm verify && pnpm guides:check` per PR; a and b also `pnpm db:generate` → clean tree.

## Risks / rollback

| Risk                                                                                                                                        | Mitigation                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Archive and a concurrent put-on interleave** → an archived program with someone on it, invisible in every list, still due on Today        | The `FOR UPDATE` / `FOR SHARE` pair on the block row (Decision 2); a `db:mutations` patch for the guard's conjunct; the race named as review-enforced                 |
| **A later change reads `archived_at` in `programDayRows`, ASSIGN-READ or the export** and rewrites history                                  | Named `programIsListed`, docblocked "never in dueness/history/export"; the programming guide's new invariant; the export byte-identity proof with a NULL-snapshot row |
| **The seed resurrects an archived seeded program** (runs on every merge)                                                                    | The slug stays occupied (Decision 1) — `seedProgram`'s arbiter keeps matching; proved                                                                                 |
| **"Start from The Daily Five" in a household whose Daily Five is archived** collides on the slug, or silently assigns to the archived block | Decision 5's contract for D4c (restore, don't re-insert); the guard refuses the silent path loudly; raised as an open question                                        |
| **Event identity breaks** if a writer uses a JS clock or a closed row's `updated_at` moves                                                  | `updated_at = archived_at` proved in `db:verify`; ASSIGN-1 confirms it never edits a closed period; FE-7 token as the named fallback                                  |
| **Migration deploys after its first reader** (both fire on merge)                                                                           | a ships alone, dark; b merges only after a is **observed** applied; a greps for projection-less `program_blocks` selects                                              |
| **The LLM authors a load**                                                                                                                  | Nothing here writes a prescription or target; archive and restore copy and invent nothing                                                                             |
| **CSV byte-faithfulness**                                                                                                                   | Structural: `export.ts` and `program-day.ts` are not in any RETIRE-1 diff; DoD line "the export files are not in the diff", plus the proof                            |
| **Gate-1 collisions** with ASSIGN-1 / CLONE-1 / D4c on the Programs route, `writers/`, `programming.md` and `write-path.md`                 | Serial by the milestone (step 8 after 7); the milestone's gate run records it                                                                                         |

**Rollback.** a: additive, reversible by omission — fix-forward; no Neon restore branch needed (no
destructive step, no backfill). b/c/d: revert the code. A revert **un-hides, never loses**: old code
ignores `archived_at`, so archived programs reappear in lists with their assignments still closed; a
redeploy hides them again. A wrong archive in prod is fixed in the app (Restore), never by a correction.

## AUTH-1 1c: what to re-verify

RETIRE-1 sits behind Beta 1's gate, so AUTH-1 1c (the one-way door) will have landed; 1a, 1b-bis and
1c-pre have shipped, 1b/1c/1d have not. Before PR c:

1. **`getHouseholdScope()`'s post-1c semantics** — session → membership → household, `limit(2)`, both
   `deleted_at` conjuncts (`docs/plans/auth-1-clerk-google.md:69-80`) — and that a household-level action
   with **no profile in the request** is authorized by the scope alone. The V1-22 editor plan moved its
   route to `/p/[profileId]/program` precisely because pre-Clerk every BOLA guarantee hung off a profile
   (`v1-22-program-editor.md:318`, B2: _"Promote to `/programs` at Clerk"_); a household Programs page is
   only sound after 1c.
2. **The unauth boundary test's shape** — after 1c "unauth" is "no Clerk session", not "no gate cookie";
   copy the shape 1c gives `actions.test.ts`.
3. **The `'use server'` allowlist** (`pages-are-gated.test.ts:228`) — 1c may change how it enumerates.
4. **Who may archive.** ADR 0008 decision 4 revisits authority at AUTH-1; beta-1 → Roles lists "who
   invites, removes, deletes" as owner acts (`docs/milestones/beta-1.md:423`). Archive is reversible and is
   not a delete, so this plan **recommends any member**. The maintainer decides; if owner-only, c adds the
   role check and a wrong-role boundary test.

## Out of scope / deferred

- **Deleting a program.** Archive is not delete (ADR 0008); a program is removed only with its household.
- **Archive history** (who archived, a log of archive/restore), and **who** at all before AUTH-1.
- **An archived program's read-only view** in the editor. HIST-1 opens programs "as snapshotted"; RETIRE-1
  adds no screen to view an archived program beyond its name in the disclosure.
- **Freeing the slug**, renaming on archive, or a "restore as a copy".
- **Server-refusing edits to, or copies of, an archived program** (Decision 4).
- **The Daily Five paths themselves** (D4c), and athlete archive (A2 — which closes an athlete's
  assignments by its own criterion 47).
- **Rate-limiting the actions** (repo-wide gap; above).
- **Q3's "close all" UI.**

## Open questions

1. **(UX panel)** The last Take off archives with no final confirm, while the Move path asks _"Archive
   {name}? Nobody is on it."_ Keep the asymmetry (approved prototype) or confirm both?
2. **(UX panel)** Undo after archive restores the archive **and the one bundled take-off** (criterion 26
   read literally, prototype `:4802`). Should it instead restore **everyone who was on it when Archive… was
   opened**? The server supports both; this decides the client.
3. **(Correctness panel)** Archive event identity by `updated_at = archived_at` (Decision 3) or the FE-7
   pre-image token?
4. **(D4c's plan, jointly)** "Start from The Daily Five" when an archived Daily Five exists: restore it
   (recommended) or insert a second copy under a new slug?
5. **(Maintainer, at AUTH-1)** Any member may archive, or owner only?
6. **(Maintainer)** The spec orders RETIRE-1 after CLONE-1 because CLONE-1 "creates the pile"; RETIRE-1
   has **no file or contract dependency** on CLONE-1 — only on ASSIGN-1's writers and the Programs page.
   Keep the order (gate 1 on the Programs route serializes them anyway), or let RETIRE-1 follow ASSIGN-1?

## Contradictions and drift found while planning

- **Criterion 26 vs the approved prototype:** "every assignment it closed" — under resolve-in-place the
  archive closes at most the last take-off; earlier resolutions are separate events (Decision 2).
- **Criterion 33 is silent on the slug** an archived Daily Five keeps (Decision 5).
- **`program-day.ts:45-46`** still calls an "explicit active-block marker" the real fix, which ADR 0007
  decision 4 withdrew; `archived_at` must not be mistaken for it.
- **The SCHED-1 plan numbers its migration `0017`**, which TEN-2c has since taken
  (`0017_ten2c_drop_global_slug_unique.sql`); every PROG-1 migration numbers at generate time.
- **The milestone links plans that do not exist yet** (`assign-1-assignments.md`,
  `clone-1-save-as-copy.md`, `v1-22-a4-create-program.md`), so the Programs page's owner and path are
  unverified here.
- **ADR 0008's "What this does not settle"** still lists _"Whether archiving closes open assignments"_
  (`0008-deletion.md:166`); Q3 settled it. PR b adds a dated pointer note to the ADR rather than editing
  its decision text.

## Review-response log

_Pending: engineering panel + UX panel (round 1)._
