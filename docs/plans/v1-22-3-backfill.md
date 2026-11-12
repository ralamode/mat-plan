# V1-22 chunk 3 — freeze the history: the `prescribed` backfill

**Branch:** `db/v1-22-3-backfill` · **Chunk:** 3 of 6 ·
**Spec:** [v1-22-authoring-program-editing](../specs/v1-22-authoring-program-editing.md) (`:149`) ·
**Milestone:** [PROG-1](../milestones/prog-1-programs-and-scheduling.md)

> ⚠️ **Read [chunk 2's § Decisions](./v1-22-2-renderer-and-writer.md) first.** D1 reshaped the wire,
> D2 settled what this chunk writes on a miss, and **A6 is why this chunk writes no e2e spec.**

## Goal

**Every strength row that predates chunk 2 gets its `prescribed` value frozen, so chunk 4's first
program edit cannot rewrite a past month's CSV.**

Chunk 2 made the log-time writer freeze `entries.prescribed_snapshot` going forward. Rows logged
before it carry `NULL`, and the export still reconstructs those from **today's** program — safe only
while prescriptions are seed-immutable. Chunk 4 makes them editable. The spec places this **after 2,
before 4**: chunk 4 cannot merge until the correction's `--apply` is recorded in the corrections
**Applied** table with a row count (`spec:149`, `:191`).

**Not a migration — a listed `db:correct` correction** (`spec:294`, A18): the backfill applies the
renderer to live data, and a migration would freeze that implementation in an immutable file forever
under the forward-only rule.

## 🔴 Why it changes no bytes — structurally, not by a test

The backfill calls the **log-time writer's own function**:

```ts
// packages/db/src/writers/prescribed-snapshot.ts:48 — ALREADY the backfill's unit of work
prescribedSnapshotsFor(db, { profilePublicId, scope, dayRole, movementIds }): Promise<Map<number, string>>
```

It already carries rule 1 (`dayRoleSchema.safeParse`, never an `as DayRole` cast), the
`programDayRows` read, `liveMatchesByKey`, and rule 2's `?? ''` for both "not in today's program" and
"ambiguous". Its own docblock states the consequence: _"acceptance 11 is structural here"_.

⚠️ **An earlier draft of this plan called the two functions underneath it** and hand-wrote the layer
between them and the column — which is the writer's body, a **third** composer of this value and a
third site of the `?? ''`. The export's comment calls the writer and the fallback _"the one pair of
functions that must agree about what a day role is"_; that draft made it a trio. Three review lenses
caught it independently.

```mermaid
flowchart TD
  E["an entry logged before chunk 2<br/>prescribed_snapshot = NULL"] --> X{"export today"}
  X --> L["liveMatchesByKey(today's program)"]
  L --> B1["bytes: '4x3 @ 145'"]
  E --> C["chunk 3 calls prescribedSnapshotsFor<br/>→ writes that SAME string"]
  C --> X2{"export tomorrow"}
  X2 --> S["the snapshot, read directly"]
  S --> B2["bytes: '4x3 @ 145' — identical"]
  L -.->|"chunk 4 edits the program"| B3["bytes: '5x3 @ 155' — history rewritten"]
  S -.->|"chunk 4 edits the program"| B2
```

**The identity is not free, though — it rests on three hand-written conjuncts as well as the shared
function**, and those are Decision 3.

## Acceptance

1. `db:correct prescribed-backfill-2026-11-12` lists what it would change and **writes nothing**;
   `--apply` writes inside one transaction and prints the counts.
2. An entry with an asserted day role, a `movement_id`, and `prescribed_snapshot IS NULL` ends
   **non-NULL**: the renderer's string where the day's program names the movement exactly once, `''`
   where it names it twice or not at all (`spec:280` A8; chunk 2 D2).
3. **A row with no asserted day role is left `NULL`** and is not listed — Decision 1 proves it is not
   at risk.
4. **A movement-less entry is never selected**, even in a day-role session, and the run does not
   abort — Decision 3.
5. **A soft-deleted entry IS written** — Decision 2. The export cannot show this by construction, so
   it is asserted directly.
6. A second `--apply` reports **0 rows**; the guard is `prescribed_snapshot IS NULL`.
7. 🔴 **A backfilled row stops consulting the live program**: edit the prescription it matched and the
   stored value does not move. This is the claim the chunk exists for, and it is the one assertion
   that can fail for the right reason.
8. The dry run's output obeys Decision 6; the **Applied** row obeys Decision 7.

Acceptances 2–7 are `db:verify` cases with **literal** expected strings, plus one committed mutation
patch per § Test plan.

## Decisions

### Decision 1 · A row with no asserted day role stays `NULL`, and it is not at risk

```ts
// apps/web/lib/csv/prescribed-snapshot.ts:36-38
if (row.prescribedSnapshot !== null) return row.prescribedSnapshot;
if (row.dayRole === null || row.movementId === null) return ''; // ← never reaches `live`
return live?.get(row.dayRole)?.get(row.movementId) ?? '';
```

A no-day-role row returns `''` **before the live program is consulted**, and `rolesNeedingLiveMatch`
adds no role for it. A program edit cannot move it, so freezing buys nothing — and it would make this
correction write a value the writer deliberately declines to write for the same shape (its rule 1).
`sessions.day_role` is write-once; no writer updates it.

**Consequence:** after this runs, `NULL` means "no asserted day role" and nothing else.
⚠️ **It holds only while the export's role source for NULL rows is `sessions.day_role`.**
`ASSIGN-READ`, which retires `programming.md` invariant 8, must not re-derive roles from a calendar
for NULL-snapshot rows — that would un-freeze exactly this class.

### Decision 2 · 🔴 It writes to soft-deleted rows — the one departure from a correction rule

Corrections rule 5 says `deleted_at IS NULL` everywhere, "so a correction never resurrects a deleted
row". **This one includes soft-deleted entries**, and the rule's own reason is why that is safe:
writing one text column on a row whose `deleted_at` stays set resurrects nothing — the export filters
`isNull(entries.deletedAt)` at all three reads (`queries/export-month.ts:113,156,183`).

The reason to include them is `V1-9b`: **restore is being built.** An entry restored after chunk 4
comes back with `prescribed_snapshot IS NULL` and gets reconstructed from a program that has since
been edited — this chunk's defect, arriving through the one door left open.

**The README amendment** (the form rule 8 established — beside the rule it excuses) states **two
bounds**, so the exception cannot widen by citation:

1. It licenses **one derived column, `deleted_at` untouched, on a row every export query already
   hides** — not a general licence to read or print hidden rows. ADR 0008 Decision 2 gave the first
   _app_ read of `deleted_at IS NOT NULL` the same narrow framing; this is the first _correction_.
2. **Rule 4's `updated_at = now()` on a hidden row is not activity.** `PRIV-3`'s purge window runs
   from `deleted_at` (ADR 0008 Decision 1), so the bump neither extends nor resets it.

⚠️ Rule 8's closing sentence — "that is the only sanctioned exception" — becomes false and is edited
in the same commit, or the README contradicts itself.

### Decision 3 · 🔴 The predicate, written out — because the conjunct it omitted aborts the run

```sql
-- migrations/0013_prescribed_snapshot.sql:48
CHECK ("prescribed_snapshot" IS NULL OR "movement_id" IS NOT NULL)
```

A movement-less entry is a metric or check-in row, and writing `''` to one **violates that CHECK** —
which, under Decision 5's single transaction, rolls back the whole backfill with a `23514`. The class
is reachable: migration `0002` created catalog rows only for `deleted_at IS NULL` legacy strength rows
and backfilled `movement_id` by slug match, so a **soft-deleted** legacy strength entry can carry
`movement_id IS NULL` — and Decision 2 is what brings those into range. The export never meets this
because it `innerJoin`s `movements` (`export-month.ts:96`). Chunk 2's plan told chunk 3 this
explicitly (`:678-680`); the first draft dropped it.

**Per profile:**

```ts
and(
  isLiveProfile(profilePublicId, scope), // ownership.ts — the single-sourced predicate
  isNull(schema.entries.prescribedSnapshot), // corrections rule 2: the value corrected FROM
  isNotNull(schema.entries.movementId), // the CHECK above — not an optimisation
  isNotNull(schema.sessions.dayRole), // Decision 1
);
```

**Three liveness filters, each decided rather than inherited, mirroring the export exactly** — this is
the other half of the byte identity:

| Table      | Filter          | Why                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `entries`  | **none**        | Decision 2.                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `sessions` | **none**        | The export reads `day_role` off a `sessions` row regardless of its `deleted_at` (`export-month.ts:97`, a `leftJoin` with no conjunct). ⚠️ `lib/dal/entries.ts:168` **does** filter it — that is the copy-paste hazard. Filtering here would leave such a row NULL while the export keeps reading it live.                                                                                                                      |
| `profiles` | `isLiveProfile` | The export filters by it (`:112`); a soft-deleted profile makes `programDayRows` return `[]`, which would freeze `''` over a whole history. ⚠️ **Archived is not deleted** (`archived_at` is a column, not a conjunct, and `isLiveProfile` ignores it), so an archived athlete's history **is** backfilled — which is right, because it still exports. Iterating through a `listProfiles`-shaped DTO would silently miss them. |

The key is `entries.movement_id`, never re-resolved by slug or `movement_name`.

### Decision 4 · It iterates live households, and the post-condition is why

`prescribedSnapshotsFor` takes a `HouseholdScope`, and `programDayRows` beneath it builds its own
ownership predicate (`isLiveProfile`, single-sourced since TEN-1 1c). A backfill has no request to
inherit a scope from, and the tempting shortcut is a correction-local query with no household
conjunct. It does not take that shortcut.

**Why all households, and not the seed one every sibling targets:** the chunk-4 gate is a **global
post-condition** — zero rows anywhere with a day role asserted, a `movement_id`, and a NULL snapshot.
Only an all-households run can assert that in-transaction. A seed-targeted form would need a refusal
for out-of-scope rows anyway: the same lines, with a worse story. (The first draft's reasons — "reuse
the query", "keep the conjunct under the mutation gate" — were true but hold for a targeted
correction too; they did not support the decision. Scope lens found that.)

⚠️ **The helper does not exist, and the nearest one is a trap.** `liveHouseholdIds`
(`queries/household-scope.ts:28`) is `LIMIT 2` — an ambiguity probe by its own docblock — and
`db:verify` inserts at least seven households, so a loop over it would silently truncate under the
very gate meant to prove this. So the PR adds **`liveHouseholds(db)`** beside it (no `LIMIT`,
`deleted_at IS NULL`, `{ id, publicId }`), builds each scope with `householdScopeForScript(id)`, and
iterates profiles with `householdProfileRows(db, { scope })` — which returns archived rows too
(`archived_at` is a column there, by design), exactly as Decision 3 requires.

`seed.ts` is the only inserter of `households`, so in production this loop runs **once** by
construction. The dry run prints `household <public_id>: N rows` so the operator sees that rather
than taking it on faith.

### Decision 5 · One transaction, timeouts inside it, and the count already measured

Corrections rule 7 requires every write in one `db.transaction`. ⚠️ **The runner does not provide
it** — `correct.ts` calls `correction.run(db, apply)` and nothing wraps it, so the correction opens
its own, with the registry's own idiom (`registry.ts:426-427`, `:568-569`):

```ts
await db.transaction(async (tx) => {
  await tx.execute(sql`set local lock_timeout = '5s'`);
  await tx.execute(sql`set local statement_timeout = '30s'`);
  // … per row: UPDATE … WHERE id = <id read in this database> AND prescribed_snapshot IS NULL
  //            .returning(); throw when length !== 1
});
```

`createDbPool` sets only `connectionTimeoutMillis`, so without the timeouts a blocked row lock waits
forever. The `.returning()` count is the "authored while this ran" guard: a row that stopped matching
aborts rather than being skipped silently. ⚠️ The per-row `WHERE id =` is an internal id **read
moments earlier in this same database** — rule 3 forbids carrying one _between_ environments, which
this does not do; the correction's _target_ is resolved by `public_id`.

**No race exists to guard against beyond that:** nothing writes `prescribed_snapshot` after insert
(`strength-session.ts` uses `onConflictDoNothing`), and no writer updates `sessions`, so the `IS NULL`
guard cannot lose to a log-time write. A concurrent insert is outside the read set and correctly
untouched.

**Row count: prod held 51 `entries` on 2026-10-06** (`spec:147`, measured at chunk 1). The dry run
re-measures and the Applied row records it. ⚠️ The first draft wrote a ~50k stop-rule and deferred a
`--batch` flag — three orders of magnitude from the measured value, for a problem nobody will have.
Both are deleted.

`updated_at = now()` on every touched row (rule 4). Because `now()` is transaction-start time, every
backfilled row shares **one** timestamp — which is the reversal key in § Risks.

### Decision 6 · 🔴 What the dry run PRINTS, decided here because it is the whole exposure

This was an open question — "a summary, or one line per row?" — and leaving it open was the mistake. A
correction's output is read by an operator and pasted into a PR body on a **public** repo. For a
backfill over a minor's training history, the line shape is the surface, not a formatting preference.

Two precedents pull opposite ways, and the repo has already chosen:

- `nullRoutineToFull` prints `profile <uuid> (<name>)` — an athlete's name (`registry.ts:557-562`);
- the TEN-2c report prints **aggregate counts only**, and its docblock names the first as "the
  precedent **not** to follow", because `movements.name` is the free-text box the notice warns people
  may put a person's name into (`registry.ts:620-625`).

**This correction follows TEN-2c:**

| What                                                                  | Printed                                                                                                                                                                                                                                              |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The summary                                                           | `household <public_id>: N rows`, then three **totals** — matched / ambiguous / unmatched. The only lines that may be pasted anywhere.                                                                                                                |
| A per-row line, for the rows a human can judge (ambiguous, unmatched) | `entry <entries.public_id> · <activity_date> · <day_role> · ambiguous\|unmatched`                                                                                                                                                                    |
| Never                                                                 | `profiles.name`, `movements.name`, `movements.slug`, `entries.movement_name`, or the **rendered string** — which is `SETSxREPS @ load`, and a per-minor prescribed load is the class `OSS-1`'s sweep scrubbed because the numbers were the exposure. |
| If a movement must be identifiable to judge a row                     | `movements.public_id`; the slug **only** when `household_id IS NULL` (reference data), and a household-typed movement as `(household-typed)`.                                                                                                        |

⚠️ **Decision 2 makes this sharper:** the row list includes entries the household hid, so pasting it
would publish _which items a household deleted_. This is the repo's first correction that lists
soft-deleted rows at all.

### Decision 7 · The Applied row carries the date and ONE total

`spec:149` requires a row count. One household total matches the existing rows (`5 KB-swing sets`,
`35 movements rows`) and implies nothing the table does not already. **Not** a per-profile or
per-day-role split: that is per-child training volume, a participation fact about a specific minor —
the class the inventory flags for `archived_at`. The Applied table has no count column today, so the
`What` cell carries the totals and the shared `updated_at` (§ Risks).

## Acceptance 11, and the e2e this chunk does NOT write

`spec:183` assigns acceptance 11 here at **month grain** over a real month. The first draft made it a
new Playwright spec. **That was wrong on four counts, two of them hard:**

1. 🔴 **It would fail an existing gate on day one.** `apps/web/test/prescribed-snapshot-is-contained.test.ts:66-77`
   globs the whole repo — its docblock says it deliberately covers `e2e/` — and asserts no file
   outside `packages/` or `apps/web/lib/` names the column. Step 1's
   `UPDATE … SET prescribed_snapshot = NULL` inside a spec lands in `escaped` and `pnpm test` goes
   red. The guard was built with no allowlist **on purpose**; widening it reverses chunk 2's A7.
2. 🔴 **It reverses chunk 2's A6 without citing it.** A6 cut `prescribed-snapshot.spec.ts` for this
   exact reason: _"The DoD's Speed budget asks whether the behaviour can be proven below the browser;
   it can… The first e2e that **can** fail is chunk 4's edit-then-re-export."_
3. Its first four steps could not fail — the plan said so itself — and its fifth was spec acceptance
   **8**, which the spec assigns to **chunk 4**, performed with SQL instead of the editor it exists to
   test. It would also have passed vacuously on alternate days: only `single-leg_hip_thrusts` renders
   non-empty, it is prescribed on both `strength_a` and `strength_b`, and the day role is
   calendar-indexed.
4. No spec today opens a database connection, so it introduced a new capability to prove a claim the
   lower tiers already cover.

**So acceptance 11 lands in `db:verify`, with literal expected strings**, and the realistic bug
classes are exactly what literals catch: wrong grouping (profile × day role), a wrong guard, the
dropped soft-delete conjunct, truthiness. The derived comparison the first draft feared —
"comparing the correction to the renderer it calls" — is what you get from an _expectation computed
from the subject_, not from a literal.

**Acceptance 7 is the month-grain claim, done in milliseconds**, using the pattern chunk 2 already
established at `verify.ts:4899-4936`: edit the prescription, prove the UPDATE bit, re-read, assert the
stored snapshot has not moved.

⚠️ **What no test here proves, stated plainly:** that the composed export of a real month in
**production** emits the same bytes before and after. That is not provable below the browser and not
worth a browser test either — it is an **operator step**, and § Gates makes it one. The spec's
acceptance 11 row is amended, dated, the way A6 amended chunk 2's.

## Test plan

**`db:verify`, a new "V1-22 chunk 3" section after chunk 2's.** Chunk 2's fixture already has the four
outcomes — open (`''`), fixed-with-override, ambiguous, unmatched (`snapCid(2..5)`) — plus a no-role
session (`snapCid(11)`) that is acceptance 3 for free.

⚠️ **Two traps in that fixture, both load-bearing:**

- `verify.ts:4899-4920` **rewrites `snapMovB`'s target reps** after chunk 2's writer cases, and `:4925`
  proves the live rendering is now `'3xrewritten-after-the-fact @ 65'`. A chunk-3 case placed after it
  and expecting `'3x4, last AMRAP @ 65'` **fails**; one that expects the frozen value proves nothing.
  So the chunk-3 cases NULL the snapshots first and expect the **post-rewrite** live value for that
  row — which is the correct claim: the backfill writes what the program says _now_.
- The fixture lives in household **B** (`B_SCOPE`), which is exactly why Decision 4 iterates.

The cases: NULL `snapCid(2..5)`, run `run(asCorrectionDb, false)` (dry-run lines, nothing written),
`run(…, true)`, read back through the shipped `strengthMonthRows`, then `run(…, true)` again → `[]`.
Plus a soft-deleted row (acceptance 5), a movement-less row in a day-role session (acceptance 4), and
`snapCid(11)` still NULL (acceptance 3). The correction's name is an exported const, as
`NULL_ROUTINE_TO_FULL_NAME` is — not re-typed.

**The mutation patch targets the CORRECTION, not the renderer.** ⚠️ The first draft's patch dropped
`liveMatchesByKey`'s ambiguity rule — which reddens **chunk 2's** assertion at `verify.ts:4862`
("a movement programmed TWICE in one day freezes `''`"), hundreds of lines before any chunk-3 case
runs, since `db:verify` is fail-fast and `mutations.mjs` matches the **first** AssertionError. It
would have been a gate for chunk 2 wearing chunk 3's name. The patch instead drops
`isNull(entries.prescribedSnapshot)` from the correction's guard, so the second run overwrites a
frozen row — the exact defect the chunk prevents — and the `.expect` names the chunk-3 message.

## File-by-file changes

| Path                                                                                      | Change      | What & why                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/db/scripts/corrections/prescribed-backfill.ts`                                  | NEW         | `run(db, apply)`: `liveHouseholds` → scope → `householdProfileRows` → the Decision 3 read → `prescribedSnapshotsFor` → the UPDATE. ~60 lines, because the composer already exists. ⚠️ The README's "Adding one" says to add an entry to `registry.ts` and all five are inline; this one is a module, so that paragraph is amended in the same PR.                                                                                                                                   |
| `packages/db/scripts/corrections/registry.ts`                                             | EDIT        | The entry + the exported name const. Extracts `withCorrectionTimeouts(tx)` — the `set local` pair is at `:426` and `:568` already, so this is the third copy and the second occurrence was the trigger.                                                                                                                                                                                                                                                                             |
| `packages/db/src/queries/household-scope.ts`                                              | EDIT        | `liveHouseholds(db)` beside `liveHouseholdIds`, with its docblock saying why the `LIMIT 2` sibling is not it.                                                                                                                                                                                                                                                                                                                                                                       |
| `packages/db/scripts/corrections/README.md`                                               | EDIT        | Decision 2's two bounds beside rule 5; rule 8's "only sanctioned exception" corrected; the **Applied** row as `pending`; Decision 6's output rule.                                                                                                                                                                                                                                                                                                                                  |
| `packages/db/scripts/verify.ts`                                                           | EDIT        | The chunk-3 section per § Test plan.                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `packages/db/scripts/mutations/NN-backfill-overwrites-frozen.{patch,expect}` + README row | NEW         | Drops the `IS NULL` guard.                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `docs/features/programming.md`                                                            | EDIT        | What `NULL` means after this runs, and the `ASSIGN-READ` caveat (Decision 1).                                                                                                                                                                                                                                                                                                                                                                                                       |
| `docs/features/write-path.md`                                                             | EDIT        | The second writer of `prescribed_snapshot`, one-time, and that it reaches soft-deleted rows.                                                                                                                                                                                                                                                                                                                                                                                        |
| `docs/runbooks.md`                                                                        | EDIT        | § Gates' procedure. ⚠️ **It must WRITE the RESTORE-branch steps** — the existing section is a `_TODO_` stub (`:1064`), and AGENTS.md forbids citing an unwired gate as a safety argument.                                                                                                                                                                                                                                                                                           |
| `docs/specs/v1-22-authoring-program-editing.md`                                           | EDIT        | Chunk 3 done; acceptance 11's row amended and dated — where it is proven, and that the month-grain browser claim is an operator step.                                                                                                                                                                                                                                                                                                                                               |
| `docs/privacy/data-inventory.md`                                                          | **no edit** | Deliberately. §1a already lists the column as written since chunk 2 and export-only; §8 already records the retention property, the `''` rule and a forward note naming this backfill. None of the three triggers fires: no new category stored, no new recipient, and "kept for the entry's lifetime" already covers a hidden row. ⚠️ One line rides with the **follow-up commit that dates the Applied row**: §8's "reversible today, not after the backfill" becomes past tense. |
| `docs/plan.md`, `docs/roadmap.md`, `docs/status.md`, `docs/changelog/…`                   | EDIT        | Chunk 3 done; chunk 4 unblocked **once `--apply` is recorded**, not once this merges.                                                                                                                                                                                                                                                                                                                                                                                               |

**No new e2e spec**, and no new `test()` in an existing one — § Acceptance 11 above.

## Gates, and what to re-verify

- **Chunk 2 is merged** ✅ (#367).
- **Chunk 4 must not merge** until the **Applied** table carries a date and a total for every database
  that matters: **production**, and the **OPS-1 preview project**, which is seed-only and therefore
  records an expected `0` rather than a judgement call later.
- **The operator procedure**, in `docs/runbooks.md`:
  1. cut the Neon RESTORE branch — **steps written in that PR, not pointed at the stub**;
  2. dry run; read the counts (Decision 6 says which lines may leave the console);
  3. 🔴 **export each profile, `--apply`, export again, `cmp` each `strength.csv`.** Any difference is
     a stop and a reversal. This is the month-grain claim, performed where it is true; for one
     household it is one zip per profile each side;
  4. record the date, the total and the shared `updated_at` in the Applied row.
- ⚠️ **Do not merge a `PROGRAM_SEED` data change between the dry run and `--apply`.** `migrate.yml`
  re-runs the seed on merge; `seedProgram` is insert-only, so only a data change can move the program
  under the backfill.
- ⚠️ **Parallel work:** this edits `programming.md` and `write-path.md`, so
  [parallel-work.md](../parallel-work.md) gate 1 fails against any other PROG-1 or write-path lane.
  The order is recorded in [roadmap.md](../roadmap.md)'s In flight.

## Risks / rollback

| Risk                                                                            | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The correction and the export disagree, so the backfill changes bytes.          | Structural: the correction calls the writer's own composer. Verified by the operator's before/after `cmp` on the live export (§ Gates step 3) — not by a test on a seeded fixture, which cannot see production's month.                                                                                                                                                                                                                                                                                             |
| A metric-arm row is selected and the CHECK aborts the whole transaction.        | Decision 3's `movement_id IS NOT NULL`, with a `db:verify` case (acceptance 4).                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| A row is frozen from a program that was already edited.                         | Impossible before chunk 4 — no edit path exists. This is why the spec orders 3 before 4.                                                                                                                                                                                                                                                                                                                                                                                                                            |
| An athlete already `adult` when this runs freezes `''` for their whole history. | Recorded in chunk 2's D2, not acted on here: `kind` is not editable (`PROF-1` a-r), and the fix belongs to whatever makes it editable. This chunk cannot distinguish "no longer programmed" from "never programmed" — both return no rows.                                                                                                                                                                                                                                                                          |
| A partial failure leaves half the rows frozen.                                  | One transaction (rule 7) plus the `IS NULL` guard: a rollback leaves nothing, and a re-run after a committed write is a no-op over what landed.                                                                                                                                                                                                                                                                                                                                                                     |
| **Rollback**                                                                    | ⚠️ **Not "none possible", which the first draft claimed.** `now()` is transaction-start time, so **every backfilled row shares one `updated_at`** — recorded in the Applied row. Reversal is a second listed correction: `SET prescribed_snapshot = NULL, updated_at = now() WHERE updated_at = '<ts>' AND prescribed_snapshot IS NOT NULL`. (Batching would destroy that single key — a real argument for Decision 5's one transaction.) The RESTORE branch is the floor beneath that, with its procedure written. |

## Out of scope / deferred

- **Editable `kind`** and the aged-out-athlete consequence → whatever row makes `kind` editable.
- **`PRIV-3`'s `--household` / `--user` runner flags** → unchanged; this correction takes no operator
  input at all, deliberately.
- **A `--batch` flag** → not deferred, **dropped**. Prod is 51 rows (`spec:147`).

## Open questions

Both closed by the panel.

1. ~~Does `db:correct` run from a Playwright spec?~~ **Moot — there is no spec** (§ Acceptance 11).
2. ~~A summary, or one line per row?~~ **Decision 6.** It framed an exposure question as a
   readability one.

## Roadmap alignment (2026-11-12)

This advances `V1-22` chunk 3 and **unblocks chunk 4** (`spec:149`), and it is what lets
`programming.md` invariant 8's prerequisite — "the export stop depending on today's `kind`" — be met,
a precondition for any future editable `kind`. Decision 1 adds one constraint on `ASSIGN-READ`. It
gates nothing else; nothing further to add from the roadmap.

## Review-response log — five lenses, 2026-11-12 (before any implementation)

Correctness, DB safety, reuse, scope and privacy, each pointed at the plan as first committed
(`a84a57b`). **Nineteen findings, all incorporated; one disagreement between lenses, resolved
against the lens that wanted more.** The convergence is the signal worth recording: **two lenses
independently found the containment-test failure, two the mutation patch that could not go red, two
the missing `movement_id` conjunct, and three the composer level.** None of the four was visible from
the plan's own text — each needed the file opened.

| #   | Lens                        | Finding                                                                                                                                                                                                                                                                                                                       | Response                                                                                                                                                                                                                                                                                                                                                    |
| --- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | reuse, scope, (correctness) | 🔴 **The backfill should call `prescribedSnapshotsFor`, not the two functions under it.** That function already IS the unit of work, with rules 1 and 2 inside it; the plan put the backfill one level too low and would have hand-written the writer's body — a third composer and a third `?? ''` site.                     | **Accepted; it is now the plan's central claim.** The byte identity becomes structural, and the module drops to ~60 lines. Verified at `writers/prescribed-snapshot.ts:48-90`.                                                                                                                                                                              |
| 2   | correctness, scope          | 🔴 **The planned e2e fails `prescribed-snapshot-is-contained.test.ts` on day one** — it globs the whole repo, deliberately covers `e2e/`, and allows the column's name only under `packages/` or `apps/web/lib/`. Verified at `:66-77`.                                                                                       | **Accepted.** Widening the allowlist would reverse chunk 2's A7. Combined with #3 it removed the spec entirely.                                                                                                                                                                                                                                             |
| 3   | scope                       | 🔴 **The e2e reverses chunk 2's A6 without citing it** (`v1-22-2:849-855` cut a spec for exactly this reason), its first four steps could not fail by the plan's own admission, and its fifth is spec acceptance **8**, assigned to chunk 4.                                                                                  | **Accepted — the spec is cut.** Acceptance 11 moves to `db:verify` with **literal** expectations, and acceptance 7 (edit-then-re-read) is the month-grain claim in milliseconds, using chunk 2's own `verify.ts:4899-4936` pattern.                                                                                                                         |
| 4   | correctness                 | **The e2e's step 5 would pass vacuously on alternate days**: only `single-leg_hip_thrusts` renders non-empty, it is prescribed on both `strength_a` and `strength_b`, and the day role is calendar-indexed.                                                                                                                   | **Accepted, and moot** once #3 cut the spec — recorded because it is the trap chunk 4's acceptance 8 inherits. `spec:187` already warns that an equality-only test passes vacuously on 11 of 13.                                                                                                                                                            |
| 5   | correctness                 | 🔴 **Pushback on #3, and it is the one disagreement:** nothing below the browser can see the correction's output against real bytes (`foldStrengthRows` is private, the only `buildExportEntries` test mocks its queries), so cutting the spec drops a claim.                                                                 | **Resolved against it, with the gap named rather than papered over.** The unprovable part is _production's_ composed export — which a seeded Playwright fixture never sees either. So it became an **operator step** (§ Gates 3: export, apply, export, `cmp`). A test that cannot see the thing it claims is the defect [lessons.md](../lessons.md) names. |
| 6   | correctness, db-safety      | 🔴 **`movement_id IS NOT NULL` is missing**, and `0013`'s CHECK makes that a `23514` that rolls back the entire single transaction. The class is reachable through Decision 2, and chunk 2's plan said so at `:678-680`.                                                                                                      | **Accepted.** Decision 3 now writes the whole predicate out, and acceptance 4 is a `db:verify` case.                                                                                                                                                                                                                                                        |
| 7   | correctness, reuse          | 🔴 **The planned mutation patch could not go red on chunk 3.** It dropped `liveMatchesByKey`'s ambiguity rule, which reddens **chunk 2's** assertion at `verify.ts:4862` first — `db:verify` is fail-fast and `mutations.mjs` matches the first AssertionError.                                                               | **Accepted.** The patch now drops the correction's own `IS NULL` guard, so a second run overwrites a frozen row. A gate for chunk 2 wearing chunk 3's name is the same defect as a test that cannot fail.                                                                                                                                                   |
| 8   | reuse                       | **The `db:verify` fixture has a trap**: `:4899-4920` rewrites `snapMovB`'s reps after chunk 2's cases, so a chunk-3 case expecting the original string fails and one expecting the frozen value proves nothing.                                                                                                               | **Accepted and turned into the right assertion** — the chunk-3 case expects the **post-rewrite** live value, which is precisely the claim ("the backfill writes what the program says now"). § Test plan names both traps.                                                                                                                                  |
| 9   | reuse                       | **"Iterates households" needs a helper that does not exist**, and `liveHouseholdIds` is `LIMIT 2` (an ambiguity probe) while `db:verify` inserts ≥7 households — a loop over it would truncate under the gate meant to prove this.                                                                                            | **Accepted:** `liveHouseholds(db)` is added beside it, and profiles come from `householdProfileRows`, which returns archived rows (Decision 3 needs them).                                                                                                                                                                                                  |
| 10  | scope                       | **Decision 4's reasons did not support it** — "reuse the query" and "keep the conjunct under the mutation gate" hold for a seed-targeted correction too; only "removes the assumption" argued for the loop, and that is YAGNI-shaped.                                                                                         | **Accepted, and the real reason substituted:** the chunk-4 gate is a **global post-condition**, and only an all-households run can assert it. The loop still runs once in production, and the dry run prints per-household counts so that is visible rather than assumed.                                                                                   |
| 11  | scope                       | **The ~50k threshold and the deferred `--batch` invent a problem** — `spec:147` measured prod at **51 rows** at chunk 1, three orders of magnitude away, and `correct.ts` prints the count unconditionally.                                                                                                                   | **Accepted.** Both deleted, replaced by the measured number and a pointer to it. The LWW paragraph is cut to a clause.                                                                                                                                                                                                                                      |
| 12  | db-safety                   | 🔴 **"Rollback: none possible" is false, and the RESTORE-branch section it leans on is a `_TODO_` stub** (`runbooks.md:1064`) — AGENTS.md forbids citing an unwired gate as a safety argument.                                                                                                                                | **Accepted, both halves.** The runbook edit must **write** the steps, and the Risks row now carries a targeted reversal: `now()` is transaction-start time, so every backfilled row shares one `updated_at`, recorded in the Applied row and usable as the reversal key.                                                                                    |
| 13  | db-safety                   | **Risk row 1 claimed acceptance 5/11 "runs before `--apply` on a real export"** — nothing in the procedure did that.                                                                                                                                                                                                          | **Accepted** — § Gates step 3 makes it a real step, and the risk row says where the claim is actually discharged.                                                                                                                                                                                                                                           |
| 14  | db-safety, correctness      | **Decision 2 argued `entries.deleted_at` only; two other liveness filters are unstated.** `sessions` is left-joined with no `deleted_at` conjunct (`export-month.ts:97`) — and `lib/dal/entries.ts:168` _does_ filter it, the copy-paste hazard — while profiles are filtered by `isLiveProfile`, and **archived ≠ deleted**. | **Accepted** — Decision 3's table decides all three explicitly, with the hazard named.                                                                                                                                                                                                                                                                      |
| 15  | db-safety, correctness      | **Decision 4 omitted the write shape every precedent uses**: transaction-local `lock_timeout`/`statement_timeout`, and a per-row `.returning()` count that throws. Also: the runner does **not** wrap `run`, which the first draft's wording implied.                                                                         | **Accepted** — Decision 5 carries the idiom and says plainly that the correction opens its own transaction. Also: no race exists to guard beyond that, verified (`onConflictDoNothing`; nothing updates `sessions`).                                                                                                                                        |
| 16  | privacy                     | 🔴 **The dry-run output had no defined shape**, and the two nearest precedents pull opposite ways — `nullRoutineToFull` prints an athlete's **name**; the TEN-2c report prints counts only and names the first as "the precedent **not** to follow".                                                                          | **Accepted as Decision 6**, following TEN-2c. Leaving it an open question framed an exposure question as a readability one, in the one place a correction is entirely output.                                                                                                                                                                               |
| 17  | privacy, db-safety          | **The Applied row** has no count column, and nothing ruled out a per-profile split — which is per-child training volume.                                                                                                                                                                                                      | **Accepted as Decision 7:** the date and **one** total, in the `What` cell, plus the shared `updated_at`.                                                                                                                                                                                                                                                   |
| 18  | privacy, db-safety          | **The README amendment needs bounds**, or the exception widens by citation; and rule 8's "the only sanctioned exception" becomes false.                                                                                                                                                                                       | **Accepted** — two bounds in Decision 2 (one derived column on an already-hidden row; `updated_at` is not activity for `PRIV-3`'s purge), and rule 8's sentence is corrected in the same commit.                                                                                                                                                            |
| 19  | correctness                 | **Decision 1 holds only while the export's role source for NULL rows is `sessions.day_role`** — `ASSIGN-READ` must not re-derive roles from a calendar for them.                                                                                                                                                              | **Accepted** — recorded as a constraint on `ASSIGN-READ` inside Decision 1 and in the roadmap-alignment line.                                                                                                                                                                                                                                               |

**Trimmed on the scope lens's reading, without argument:** acceptance 5 was acceptance 11 restated;
the candidate-homes table rested on a premise #3 refuted; a risk row that said of itself "impossible
before chunk 4" was not a risk; and the sizing sentence named "one athlete", which singles out one of
two known minors for no argumentative gain (privacy).

**Found outside this plan, not charged to it:** `spec:186` still says the month-grain e2e is "the only
test that catches the renderer having been copied rather than hoisted" — true before chunk 2's A1
hoist and the containment test, stale since #367. This PR's spec edit is the right place to fix it.
And `verify.ts:7527` re-types a correction name instead of importing the const; this plan exports
one rather than copying that.
