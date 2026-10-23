# V1-9b — delete a logged entry, restore it, clear a day

> Backlog: [plan.md](../plan.md) row `V1-9b` (`plan.md:115`) · Spec:
> [crud-1-fix-it-yourself.md](../specs/crud-1-fix-it-yourself.md) chunks **B0, B1, B2** · Milestone:
> [CRUD-1](../milestones/crud-1-fix-it-yourself.md) · Branches: `db/v1-9b-0-client-id-arbiters`,
> `feat/v1-9b-1-1-hide-core`, `feat/v1-9b-1-2-entry-actions`, `feat/v1-9b-1-3-hide-ui`,
> `feat/v1-9b-2-clear-day`.
>
> Contract: [ADR 0008](../decisions/0008-deletion.md) (signed 2026-10-18), read in full. Prototype:
> [`docs/prototypes/crud-1/index.html`](../prototypes/crud-1/index.html) v9 (the maintainer approved
> v8, M32; v9 changes only target fields), screens **`day`**, **`day-slot`**, **`day-clear`**. Seams:
> the spec's "Seams the plans settled (2026-10-23)" (`crud-1-fix-it-yourself.md:525-547`) and
> [WP-1](./wp-1-shard-actions.md).

## Goal

A person who mis-logs something can remove it from the day themselves, see that it was removed, put
it back, and clear a whole day behind a typed confirm — without the maintainer running `db:correct`.
It closes the "deleted" half of Beta 1's exit box _"Every logged thing can be corrected or deleted in
the app"_ (`beta-1.md:441`) and turns the published notice's _"per-item deletion is being built"_
(`docs/privacy/notice.md:136-152`) into a description of what was built.

ADR 0008 fixes the meaning: a Delete **hides from the whole household**, is **restorable until it is
purged**, restore is **fallible** with a typed `slot_taken` refusal, clear-a-day restores as **one**
event, the grain is the **entry**, and the freed `client_id` is a migration owed before the first
volume write of `deleted_at`. This plan builds that; it does not reopen it.

**Binding decisions from the maintainer:** logs are shown **in place, in their own section**, with no
"Logged entries" list (criterion 48, M26, disagreement 12). Delete, the in-place Undo and Restore act
on the row where it sits. The Hidden bar lists only what was hidden **before the page loaded** (IXD-2,
criterion 10).

**Restore window: one clock, and it starts with the purge** _(orchestrator decision A, round 1)_. ADR
0008 decision 2 says _"The restore window is the purge window … One number, not two."_ Until PRIV-3's
purge job is **live**, nothing removes a hidden row, so nothing here enforces a window: a hidden item
stays restorable until it is removed, and the bar says **"Restorable until removed"**. The purge PR
brings `N`, the window, and the dated "restorable until {date}" copy **together**. So `N` gates no
V1-9b PR.

## Where the gates stand (measured on this branch, 2026-10-23)

| Gate                                         | State                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **V1-24 1e lands before B1**                 | ✅ **Already met.** 1d is `9336554` (#210, migration `0012_bodyweight_one_per_day.sql`), 1e is `b625a23` (#214), and 3a is `bb56c62` + `cefd500` (#211, #212). All are on `origin/main`. The spec still lists 1d and 1e as future work (Contradiction 1).                                                                                                                                                                 |
| **B0 before any write of `deleted_at`**      | Not started. B0 and AUTH-1 1b are serial by migration **number**: AUTH-1 claims `0019` (`auth-1-clerk-google.md:833`), and the last migration on main is `0018`. B0 is also **serial on `write-path.md`** with AUTH-1 1b and 1c. B0 edits that guide (invariant 6), and so do they. Under parallel-work gate 1, two tracks under one guide collide even when their code files differ (AGENTS.md → Git & branch workflow). |
| **AUTH-1 1c observed live** (a one-way door) | Not shipped. B1-2 waits for it: its actions start from 1c's `sessionUserOrNull()` + `checkMutationLimit` (`auth-1-clerk-google.md:657-663`). B1-1 touches no file in 1c's table (`:1704-1715`), but it does edit `write-path.md`, so it **serializes after 1c** on the guide.                                                                                                                                             |
| **PRIV-3 / `N`**                             | **Gates nothing here** (decision A). PRIV-3 has no plan yet (`plan.md:1735-1770`). This plan sets **three requirements on PRIV-3's purge PR** (see [Requirements this plan places on PRIV-3](#requirements-this-plan-places-on-priv-3)).                                                                                                                                                                                  |
| **V1-24 3b merged**                          | **B1-3 is gated on it** _(decision D)_. 3b removes the Logged-entries list and gives each entry its section. B1-3 then puts Delete on the row in that section. 3b and B1-3 both edit `page.tsx` and `movement-line.tsx`. The milestone gets the edge `E3b → B1-3`.                                                                                                                                                        |
| Prod already holds hidden rows               | Yes. The V1-24 1c correction soft-deleted two weigh-ins (`packages/db/scripts/corrections/registry.ts:214-217`; `docs/runbooks.md:62`). So B0's prod read is **not vacuous**, and "nothing writes `deleted_at`" is true only of shipped **app code**.                                                                                                                                                                     |

## Staging

Five PRs. B0 holds the one migration, in its own PR, and never shares a review with a UI PR.

| PR       | What                                                                                                                                                                                                                                                      | ~lines | Gate                                                                                                                                                                                                |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **B0**   | The prod read (aggregate counts only), then **one migration** making the five `client_id` UNIQUEs non-partial. Schema, `db:verify` proof of criterion 9, mutation 07, the docs whose claims flip, the ERD.                                                | ~190   | The read returns zero duplicates in all five tables, re-run just before merge. Migration number taken at merge (journal `when` must increase). Serial with AUTH-1 1b on `write-path.md`.            |
| **B1-1** | `packages/` only. The shared schemas. The `hideEntries`/`restoreHidden` writer. The check-in/life insert moved into `packages/db/src/writers/` with a typed own-hidden result. The day-scoped hidden read. The `db:verify` proofs.                        | ~390   | B0's migration **observed in prod**: `migrate.yml` is green on B0's merge SHA **and** `pg_indexes.indexdef` for the five indexes in prod has no `WHERE`. Serial after AUTH-1 1c on `write-path.md`. |
| **B1-2** | `apps/web`. `entry-actions.ts` (hide + restore over one private `runHide`), registered in WP-1's matrix. The DAL wrapper (`listDayWithHidden`). The life/check-in mapping and the `LifeButton` key fix. `data-inventory.md` §1/§5.                        | ~350   | B1-1, and AUTH-1 1c observed live.                                                                                                                                                                  |
| **B1-3** | The UI under `app/p/[profileId]/hidden/`. Delete on each row, the shared Undo line, the Hidden bar, the `slot_taken` refusal and "Use {value} instead", "Hidden on other days". **`notice.md`**, inventory §4/§6/§8, the new feature guide, e2e and a11y. | ~400   | B1-2, **V1-24 3b merged**, and the UX panel reconciled on this plan. Merge it right after B1-2 (Risks: crafted POST).                                                                               |
| **B2**   | Clear a day. Typed `delete`, through the same `runHide`, so it is one transaction and one bar event, "Cleared this day · n items".                                                                                                                        | ~230   | B1-3.                                                                                                                                                                                               |

**Why B1 is three PRs.** As one PR it is ~1,100 lines across three packages, the size the V1-24 panel
split into seven (`v1-24-form-is-the-day.md:172`). The split follows the seams the repo already has:
`packages/db` (proved by `db:verify` on PGlite), the write boundary (`entry-actions.test.ts`), and the
screen (Playwright).

## Acceptance

From the backlog row (`plan.md:115`), verbatim: _"Delete a mistaken entry → gone from Today; 'Clear
day' → type 'delete' → the day empties."_

Spec criteria carried. The text is in the spec → Acceptance; each criterion names the PR that carries its test:

- **9.** A replayed `client_id` of a hidden entry never inserts a second live row. **B0** proves it
  through the shipped writers. **B1-1** adds the check-in/life typed result. **B1-2** maps it to a
  refusal, never `ok`.
- **10.** Delete removes the entry for every viewer. An untimed `<label> deleted · Undo` line takes its
  place until the page is left. `Hidden on this day (n)` sits above the sections, survives reload and
  day change, and lists only hides made before this load. Criterion 10 also wants each item to state
  the date it stops being restorable. Under decision A that is **"Restorable until removed"** until the
  purge ships, and the dated copy comes with the purge. **B1-3.**
- **11.** After a hide, focus goes to the row's Undo; after a restore, to the restored row. The live
  region is mounted before its text changes. **B1-3**, using the seams table's shared Undo line.
- **12.** Restore puts the entry back in its original position. A taken slot returns a typed
  `slot_taken` naming the holder, never `23505` and never a silent no-op. One atomic
  "use this one instead" is offered, and "Leave it" is the default. **B1-1** (writer), **B1-2**
  (action), **B1-3** (UI).
- **13.** A folded calisthenics row names its count and hides as one event. A strength session shows
  Delete on exactly one copy. With 3b merged it renders once. **B1-3.**
- **14.** Clear is disabled until the input equals `delete`, ignoring case and surrounding spaces. It
  runs in one transaction and restores as one event. A partial restore says which items could not
  come back and why. **B2.**
- **15.** Hidden entries on other days are signposted, with links. Per decision E this is a one-line
  summary. **B1-3.**
- **16.** A profile whose every entry in a month is hidden can still get its data. **B1-1** (proof),
  **B1-3** (notice). See [Decision 4](#decision-4--the-export-omits-hidden-rows-restore-or-the-full-copy-gets-them-back).

Not carried here:

- **48** is V1-24 3b's. B1-3 consumes it.
- **45** is the Undo for D4c and D5, not this one.

Q7, Q9, Q10 and Q12 are implemented as the spec's Open decisions record them.

## Decisions (with the alternatives rejected)

### Decision 1 — B0 re-predicates all five `client_id` arbiters, keeps their names, and changes no app code

The five indexes are each `WHERE deleted_at IS NULL`:

- `uq_entries_client_id` (`packages/db/src/schema.ts:258-260`)
- `uq_entry_sets_client_id` (`:321-323`)
- `uq_entry_set_quantities_client_id` (`:390-392`)
- `uq_sessions_client_id` (`:665-667`)
- `uq_supersets_client_id` (`:710-712`)

B0 drops the predicate from all five. Why all five when B1 hides only `entries`: sessions and supersets
carry **client-minted** ids, so a correction that hides one arms the same hazard. Leaving two of the
five partial would make the rule "it depends on the table", which is how `data-inventory.md` §5 came
to state the wrong version once already.

**The writers keep `where: isNull(deletedAt)` on their arbiters.** Postgres infers a non-partial
unique index for `ON CONFLICT (client_id) WHERE …` (the `INSERT` reference, `index_predicate`), so the
shipped statements work against **both** index shapes. Dropping the `where:` in the same PR would race
`migrate.yml` against the Vercel deploy (`.github/workflows/migrate.yml:6-7`). Against the old partial
index, a bare `ON CONFLICT (client_id)` fails inference on every insert (`docs/lessons.md:19-22`).
Removing the redundant `where:` is a later cleanup, not owed here.

**Rejected:**

- **Keep the partial indexes and record why.** Criterion 9 fails, because the first hide lets a replay
  insert a second live row (ADR 0008 decision 3.4).
- **An app-level pre-check.** It races, and AGENTS.md forbids it by name.
- **Rewrite a hidden row's `client_id`.** It needs a column the ADR does not authorize.
- **New index names.** `verify.ts:1908`, `bodyweight.ts:214` and `write-path.md:182` name the current
  indexes, and only the predicate changes.

### Decision 2 — a hide event is `(profile, day, deleted_at)`, carried as fixed-format UTC text

The spec's proposal ("The data contract" → rules) is adopted with one correction: the token **never
passes through a JS `Date`**. Postgres stores microseconds and a `Date` holds milliseconds, so a token
mapped through drizzle compares unequal to its own row. The repo has paid for this trap before
(`registry.ts:209-212`).

The read selects
`to_char(deleted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`. That is one fixed format,
independent of the session `DateStyle` and `TimeZone` that `::text` would depend on. The writer
compares `deleted_at = $token::timestamptz`, a bound parameter, never `sql.raw`.

One transaction shares one `now()`, so a folded row, a clear and a swap's hide are each one event.
The writer uses `now()`, never `clock_timestamp()`, and `db:verify` pins it (Test plan, B1-1 case 2).

**Rejected:** an `event_id` column (unauthorized, and nothing needs it before sync, Decision 6), and
rounding to the second (two taps in one second would merge).

**One sentence, decided (UX lens 3, N8):** re-hiding a restored item is a **new** event with a new
token, so once the purge exists its clock restarts. That is correct: the person deleted it again.

### Decision 3 — restore names the items as well as the event

Once an item is live its `deleted_at` is gone, so `{ profilePublicId, day, hiddenAt }` alone cannot
tell the cases apart. B1-1 sends `{ profilePublicId, day, hiddenAt, entryPublicIds, keepInsteadOf? }`,
and `RestoreResult` gains `'changed'`:

| The item when Restore arrives      | Answer                                                    |
| ---------------------------------- | --------------------------------------------------------- |
| hidden under `token`               | restore, or `slot_taken`                                  |
| live                               | `ok`: a replay, with one effect and an identical response |
| hidden under a **different** token | `changed` → `AMEND_ERROR_COPY.staleWrite` (FE-7)          |
| absent or foreign                  | `not_found`                                               |

These are additive amendments to the spec's contract (Contradiction 4).

### Decision 4 — the export omits hidden rows; Restore or the full copy gets them back

ADR 0008 ("One constraint") asks V1-9b to choose between a deleted-tolerant export and
export-before-hide. **Chosen: the latter, with no change to the export queries.**

- The routine export keeps filtering hidden rows at `packages/db/src/queries/export-month.ts:88, :94,
:100, :143, :170`. A deleted set must not keep flowing into the Claude workflow the CSV feeds.
  Byte-faithfulness risk is zero, because no query changes.
- Criterion 16 is met two ways. **Restore** is self-serve and lasts until the item is removed. The
  on-request **full copy** (`notice.md:167-170`) includes hidden rows until the purge removes them.
- B1-1 proves the self-serve path. Hide a month's entries, and `loggedMonths` drops the month. Restore
  the event, and the month rows come back **deep-equal** to the pre-hide capture, since `public_id`,
  `created_at` and every value are preserved (sort keys at `export-month.ts:105-112`).

**Rejected:** a second family of month queries that include hidden rows. That is the opposite of
Delete for the one consumer the export exists for.

### Decision 5 — one hide path for a row, a folded row and a cleared day

`hideEntriesSchema` is `{ profilePublicId, day, entryPublicIds: uuid[] }`. It replaces the contract's
`hideEntrySchema` and `hideGroupSchema`, and `clearDaySchema` extends it with `confirm`. One private
`runHide(formData, schema)` in `entry-actions.ts` is shared by `hideEntriesAction` and
`clearDayAction` _(decision B; arch B1, reuse S1/S6)_. It covers auth, the limiter, parsing, the
profile and the writer. The rules:

- **Ids are de-duplicated** before the count check (correctness 7).
- **Size caps are named separately.** `HIDE_ROW_MAX` caps a row (a folded calisthenics row's bouts).
  `CLEAR_DAY_MAX` caps a clear and is sized from a real day. Both live in `packages/shared/src/hide.ts`.
  The clear constants move to B2 (scope N).
- **All or nothing.** If any id is not an owned entry of that profile on that day, live or already
  hidden, the transaction rolls back with `AMEND_ERROR_COPY.notFound('entry')`. That is one message
  for foreign, stale and wrong-day, as at `actions.ts:525-580`.
- **Already-hidden ids are a replay.**
- **Clear hides the ids the page rendered** (the `n` the dialog states), not a fresh select
  (Contradiction 5).

### Decision 6 — idempotency is state-keyed, like the shipped amends; FE-15 goes to sync

Hide and restore are idempotent through state, as `editBodyweightAction` branch (b) is
(`actions.ts:573-577`). Hiding an already-hidden owned entry is `ok`, and restoring an already-live
item is `ok`. **FE-15**'s client event ids belong to the v1.5 sync PR. An id helps only when an outbox
persists and replays it, and persisting it here would be the `event_id` column ADR 0008 does not
authorize.

### Decision 7 — `hiddenSinceWrite` is cut; today's throw stays for strength and bodyweight

_(Orchestrator accept 2; arch B2, corr 5, scope S3.)_ Round 0 added typed "replay of a hidden create"
branches to the two create writers without the DAL type, action mapping or copy behind them. The
reachable case is the life button (accept 1), and B1-2 fixes it structurally with a fresh key per
mount after a hide, plus a typed result on the check-in/life writer. For the other writers:

- **Bodyweight** remounts its form after a hide, so a fresh id is minted (`bodyweight-form.tsx:34`,
  `bodyweight-section.tsx:62`).
- **Strength** remounts after every save (`key={`${day}:${gen}`}`, `strength-form.tsx:155-173, :273`).

So a strength or bodyweight replay onto a hidden row needs a tab left open across a hide, followed by a
resubmit of the **same** render. It keeps today's behaviour, which is a throw with no second row:
`reselectLiveByClientId` (`strength-session.ts:52`) and branch (c) (`bodyweight.ts:246-249`). The
case is listed in Risks. If it is ever made typed, the bodyweight branch goes **between (b) and (c)**
(correctness 4), so `verify.ts:3592-3606` keeps `dayTaken` precedence.

### Decision 8 — "Use this one instead" is one savepoint, and the holder is touched only after the item is proved hidden

_(Correctness B2.)_ Inside each item's savepoint, in this order:

1. **Lock the item** with `SELECT … FOR UPDATE`, scoped to the owned profile and the day.
2. **If the item is live and the named holder is hidden:** return `ok` (a replay).
3. **If the item is not hidden under the token:** classify it (`changed` or `not_found`) and **never
   touch the holder**.
4. **Otherwise hide the holder.** The `UPDATE` requires the holder to be owned, in the same
   bodyweight slot as the item, and live. Zero rows means `changed`.
5. **Restore the item.**

Any non-`ok` result rolls back to the savepoint, so a half-swap never commits. `db:verify` drives both
bad orders. UX lens 3 #4: the refusal shows both values with their logged and hidden times, and the
button reads **"Use {value} instead"**.

### Decision 9 — ADR 0008 decision 4, revisited at AUTH-1 (recommendation)

After 1c, logging authority means any signed-in member of the household, for every athlete in it.
**Recommendation:** deletion and restore authority stay equal to logging authority, for the ADR's
reason that the irrecoverable `editRoutineAction` is already open to that same principal. A parent
can undo a child's hide from the athlete's page. This is open question 1, so the revisit is a decision
rather than an inheritance.

## Requirements this plan places on PRIV-3

Stated here so the purge PR cannot miss them. ADR 0008 makes PRIV-3 the owner of `N`.

1. **One clock** _(decision A)_. The purge PR introduces `N`, the restore window and the dated copy
   together. The window is **computed once, in SQL**, and shown as the **last full local day** an item
   can be restored. Both the hidden read and `restoreHidden` take that same predicate. The UX
   "deadline" findings move there (UX lens 3 #2/#3, reuse S4).
2. **Orphaned grouping rows** _(decision C, privacy B2)_. When the purge hard-deletes an entry, it
   **also hard-deletes any `sessions` / `supersets` row left with no entries**. Otherwise a session's
   free-text `feel` note ("How did it feel?") outlives everything it described. Until the purge ships,
   B2's dialog, the notice and inventory §8 say plainly that this note stays.
3. **The notice's "until removed" copy** (B1-3) is replaced by the dated copy in the same PR. A
   rollback of either PR writes a new notice state; it does not leave stale copy behind (privacy S5).

## File-by-file changes

### B0 — `db/v1-9b-0-client-id-arbiters`

| Path                                                                                                             | Change | What & why                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/db/src/schema.ts`                                                                                      | EDIT   | Remove `.where(…deleted_at is null)` from the five indexes. Rewrite **every** comment that B0 makes false: `:187`, `:358`, `:638`, `:698-699`. Each says "a hidden row keeps its `client_id`".                                                                                                                                                                                                                    |
| `packages/db/migrations/00NN_v1_9b_client_id_arbiters.sql` + `meta/*`                                            | NEW    | `drizzle-kit generate`, then hand-hardened (shape below). If AUTH-1 1b or another migration takes the number first, **regenerate**; never rename a generated file. Assert the new journal entry's `when` is greater than the previous one. db-safety B1 asks for a guard on `when` being monotonic; that is **filed as its own row**, not built here.                                                             |
| `packages/db/scripts/verify.ts`                                                                                  | EDIT   | New section "V1-9b B0", with the proofs in the Test plan. `upsertReturningId`'s fallback (`:1575-1588`) gains `isNull(table.deletedAt)` and throws on a miss, like `strength-session.ts:39-55`. After B0 the unguarded version can find the hidden row.                                                                                                                                                           |
| `packages/db/scripts/mutations/NN-client-id-partial-again.{patch,expect}` + README row                           | NEW    | The patch re-adds the predicate to `uq_entries_client_id` in **both** `schema.ts` and the new migration, so the mutation does not depend on how `mutations.mjs` sources the DDL (this resolves round 0's hedge). The `.expect` is the **first** failing assertion: the behavioural criterion-9 case is ordered **before** the structural `pg_indexes` check (db-safety 4).                                        |
| `packages/db/src/writers/strength-session.ts`                                                                    | EDIT   | Docblocks only. `:34-36` ("the partial UNIQUE lets a soft-deleted row share the client_id") becomes false. The guard stays as defence. This file is owned by `strength-logging.md`, so that guide is updated too.                                                                                                                                                                                                 |
| `docs/features/write-path.md`                                                                                    | EDIT   | Invariant 6 (`:177-180`): `client_id` is non-partial since B0. The `where:` repeat is kept for **deploy-order safety**: never drop it in the PR that changes an index. A trap entry: replaying a hidden row now conflicts.                                                                                                                                                                                        |
| `docs/features/strength-logging.md`                                                                              | EDIT   | The `strength-session.ts` docblock change.                                                                                                                                                                                                                                                                                                                                                                        |
| `.claude/skills/add-server-action/SKILL.md`, `.claude/skills/db-migration/SKILL.md`                              | EDIT   | `add-server-action:37-39` and `db-migration:19` state that the `client_id` UNIQUE is partial. Both are corrected. The natural-key rule at `db-migration:68-71` still holds.                                                                                                                                                                                                                                       |
| `docs/architecture.md`                                                                                           | EDIT   | `:342` says `client_id` is "UNIQUE partial", which becomes plain UNIQUE (arch S3). The `:85` sequence's `ON CONFLICT(client_id) DO UPDATE (LWW)` is already untrue of today's `DO NOTHING`. B0 marks that line as the v1.5 target rather than silently keeping it.                                                                                                                                                |
| `docs/privacy/data-inventory.md`                                                                                 | EDIT   | §5 (`:251-258`): `client_id` leaves the list of keys a hide frees. **Nine** arbiters stay partial on `deleted_at`, recounted from `schema.ts` in the PR: superset order, weigh-in day, set ordinal, quantity slot, readiness day, ramp week, block slug, prescription slot, target pair.                                                                                                                          |
| `docs/runbooks.md`                                                                                               | EDIT   | **No new permanent entry** (scope N). The migration's refusal message links the existing "A pending migration wedges prod and the seed with it" section (`runbooks.md:116`). The PR body names its consequence: `migrate.yml` runs the seed in the same job, so a refused B0 **freezes every later migration**, AUTH-1 1b's `0019` included, until the pair is corrected and the run re-dispatched (db-safety 6). |
| `docs/changelog/<fragment>.md`, `docs/status.md`, `docs/plan.md` (V1-9b: "no migration" → B0), `docs/roadmap.md` | EDIT   | Status rides with the work.                                                                                                                                                                                                                                                                                                                                                                                       |

**The prod read.** The maintainer runs it against `DATABASE_URL_UNPOOLED` inside `BEGIN READ ONLY`. It
returns **aggregate counts only**, never a `client_id`, `public_id` or name. Run it before the PR and
again immediately before merge, as with 1d (`runbooks.md:56`):

```sql
begin read only;
select t, count(*) filter (where n > 1)                         as dup_client_ids,
          count(*) filter (where n > 1 and live > 0 and hid > 0) as hidden_live_pairs,
          sum(hid)                                               as hidden_rows
from (
  select 'entries' t, client_id, count(*) n,
         count(*) filter (where deleted_at is null) live,
         count(*) filter (where deleted_at is not null) hid
    from entries group by client_id
  union all select 'entry_sets', client_id, count(*), count(*) filter (where deleted_at is null),
         count(*) filter (where deleted_at is not null) from entry_sets group by client_id
  union all select 'entry_set_quantities', client_id, count(*), count(*) filter (where deleted_at is null),
         count(*) filter (where deleted_at is not null) from entry_set_quantities group by client_id
  union all select 'sessions', client_id, count(*), count(*) filter (where deleted_at is null),
         count(*) filter (where deleted_at is not null) from sessions group by client_id
  union all select 'supersets', client_id, count(*), count(*) filter (where deleted_at is null),
         count(*) filter (where deleted_at is not null) from supersets group by client_id
) g group by t order by t;
rollback;
```

**Pass:** `dup_client_ids = 0` in every row. A non-partial index needs hidden/hidden pairs gone too.
`hidden_rows ≥ 2` on `entries` is expected (the 1c rows).

**If a pair exists:** resolve it with a correction that **selects by predicate**, never by committed
ids (privacy S6, and PRIV-3's no-identifier rule).

**Migration shape** (the `0012` precedent):

```sql
SET lock_timeout = '5s';--> statement-breakpoint
SET statement_timeout = '60s';--> statement-breakpoint
-- The writer's own order, taken up front at the level DROP INDEX needs: no mid-file lock upgrade.
LOCK TABLE "sessions", "supersets", "entries", "entry_sets", "entry_set_quantities"
  IN ACCESS EXCLUSIVE MODE;--> statement-breakpoint
DO $$ … count duplicate client_id (any deleted_at) per table; RAISE naming the table and
        docs/runbooks.md → "A pending migration wedges prod" … $$;--> statement-breakpoint
-- <justification: drizzle wraps the file in a transaction, so CONCURRENTLY is impossible>
-- squawk-ignore require-concurrent-index-deletion
DROP INDEX "uq_entries_client_id";--> statement-breakpoint
CREATE UNIQUE INDEX "uq_entries_client_id" ON "entries" USING btree ("client_id");--> statement-breakpoint
… × 5
```

**What the lock costs** (db-safety 7). `ACCESS EXCLUSIVE` blocks **reads as well as writes** on all
five tables, Today's page included, for the duration of the five index builds. At prod's size
(hundreds of rows) that is well under a second. If the lock cannot be taken it waits at most 5 s
(`lock_timeout`) and then fails without changing anything. There are no `IF [NOT] EXISTS` guards, for
0012's reason: such a guard would skip a same-named index that has the wrong predicate.

⚠️ **Unverified:** the Squawk rule name for a non-concurrent `DROP INDEX`. Run `squawk` on the file
first, and put each `-- squawk-ignore` on the line directly above its statement (`docs/lessons.md`).

### B1-1 — `feat/v1-9b-1-1-hide-core` (`packages/` only)

| Path                                                                                           | Change   | What & why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared/src/date.ts` (or the existing shared day module)                              | EDIT/NEW | `isoDaySchema` is **promoted** from `apps/web/lib/date.ts:16`, which then re-exports it (reuse N1). Ids use the existing shared `uuidSchema`.                                                                                                                                                                                                                                                                                                                                                                                                  |
| `packages/shared/src/hide.ts`                                                                  | NEW      | `HIDE_ROW_MAX`, `hideEntriesSchema` (ids de-duplicated by a transform), `restoreHiddenSchema` (`hiddenAt` matches Decision 2's format, never `z.date()`; plus `entryPublicIds` and an optional `keepInsteadOf`), and `RESTORE_REASON` as const plus its zod enum and type. **No `N`** (decision A).                                                                                                                                                                                                                                            |
| `packages/db/src/writers/hide.ts`                                                              | NEW      | `hideEntries(exec, { profilePublicId, scope, day, entryPublicIds })` returns `{ hiddenAt } \| { notFound: true }`. `restoreHidden(exec, { …, hiddenAt, entryPublicIds, keepInsteadOf? })` returns per-item results. Ownership is a subselect on `isLiveProfile` (`ownership.ts:118-124`), never a copy. Per item: a savepoint, with Decision 8's order. A `23505` on `BODYWEIGHT_DAY_UNIQUE_INDEX` rolls back to the savepoint and gives `slot_taken`, with the holder found by the slot helper. Any other `23505` is rethrown, as unexpected. |
| `packages/db/src/writers/bodyweight.ts`                                                        | EDIT     | Extract `bodyweightSlot(profileId, day)`, built from `DEFAULT_BODYWEIGHT_CONTEXT`. It is today's inline predicate at `:231-241`, now used by branch (b) **and** the restore holder lookup (reuse S5). There is no new branch (Decision 7).                                                                                                                                                                                                                                                                                                     |
| `packages/db/src/writers/checkin.ts`                                                           | NEW      | **The check-in/life insert moves here** from `apps/web/lib/dal/entries.ts:384-455` (correctness 6), so `db:verify` runs the real statement. Each item's result is `created`, `replay` (an own live row), `own_hidden` (this profile's hidden row holds the id, so it is **never `ok`**) or `conflict` (another profile's row). `logCheckinEntries` becomes a thin DAL wrapper.                                                                                                                                                                 |
| `packages/db/src/queries/hidden-entries.ts`                                                    | NEW      | **The repo's first read that returns `deleted_at IS NOT NULL`**, and its docblock says so (ADR 0008 decision 2). `hiddenEntriesForDay` and `hiddenDayCounts` (other days with hidden items, newest first) both go through `isLiveProfile`. Neither reads `scope.householdId`, so `scope.test.ts` still pins the module.                                                                                                                                                                                                                        |
| `packages/db/src/index.ts`                                                                     | EDIT     | Exports.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `packages/db/scripts/verify.ts`                                                                | EDIT     | Section "V1-9b B1", with the proofs below.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `packages/db/scripts/mutations/NN-restore-ignores-token.*`, `NN-token-through-date.*` + README | NEW      | Mutation 08 drops the token conjunct. Mutation 09 maps the token through `new Date(…).toISOString()` (db-safety 5).                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `docs/features/delete-and-restore.md`                                                          | NEW      | **A new guide** (arch S6). It **owns** `writers/hide.ts`, `queries/hidden-entries.ts`, `packages/shared/src/hide.ts`, `app/p/[profileId]/entry-actions.ts` (B1-2), and `app/p/[profileId]/hidden/` (B1-3). Invariants: only `hide.ts` writes `deleted_at` (ADR 0008 decision 3.3), the token stays text end to end, and every reader is in the audit table. Its **sequence diagram** of hide → Undo → restore / `slot_taken` is also embedded in `docs/architecture.md` (arch S3).                                                             |
| `docs/features/write-path.md`                                                                  | EDIT     | `writers/checkin.ts` is added to the writers' story, and the guide points at the new one.                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

**The reader audit** (the spec's Risks row) has one `db:verify` case per reader:

| Reader                                                       | Filter today                                                                                    | Case                                                                                                              |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `listEntriesForDay` (`apps/web/lib/dal/entries.ts:120-294`)  | entries `:197`; sets through live entry ids `:203-218`; quantities through live sets `:224-240` | The app DAL cannot run under `db:verify` (`entries.ts:393-394`), so B1-2 adds an emitted-SQL test and B1-3 an e2e |
| `strengthMonthRows` / `bodyweightMonthRows` / `loggedMonths` | `export-month.ts:88, :94, :100, :143, :170`                                                     | Hidden rows are absent; restore brings them back deep-equal (Decision 4)                                          |
| `weeklyAdherence` (`weekly-adherence.ts:63`)                 | entries                                                                                         | A hidden bout leaves the week's sum (**Q7**)                                                                      |
| `ownedEntryIds` (`ownership.ts:135-141`) → both amends       | entries                                                                                         | Amending a hidden entry's set or weigh-in returns `null`, and `deleted_at` is unchanged                           |
| `insertBodyweightEntry` lookups (`bodyweight.ts:224, :239`)  | entries                                                                                         | `dayTaken` is unchanged (`verify.ts:3592-3606`)                                                                   |
| `movement-ownership.ts`                                      | **deliberately none** (`:32-38`)                                                                | Asserted unchanged                                                                                                |

This is the **entry→set live-parent proof** the row owes (`plan.md:115`). Hide an entry whose children
stay `deleted_at IS NULL`, and every reader above returns none of them. `ON DELETE CASCADE` is
hard-delete only, which is the same trap as `verify.ts:2655-2682`, one level up.

### B1-2 — `feat/v1-9b-1-2-entry-actions`

| Path                                                                                                                        | Change | What & why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/app/p/[profileId]/entry-actions.ts`                                                                               | NEW    | `'use server'`, holding `hideEntriesAction` and `restoreHiddenAction` over a **private** `runHide` (decision B). Each action: `Sentry.withServerActionInstrumentation`, then `sessionUserOrNull()`, `checkMutationLimit(user.userId)`, the zod parse, `getProfileByPublicId`, the DAL, and `revalidatePath`. There is **no `resolveDeclaredDay` bound**: a correction must not dead-end on the history days where mistakes are found (the amends' reasoning, `actions.ts:504-509`). Sentry gets no headers, no formData, and no user or household id (AUTH-1 § Design 3). |
| `apps/web/app/p/[profileId]/entry-actions.test.ts`                                                                          | NEW    | Colocated, with the boundary, replay and mapping cases (Test plan).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `apps/web/app/p/[profileId]/mutating-actions.ts` + `ACTION_BINDINGS` / `VALID_BODY` / the pinned module list (WP-1's homes) | EDIT   | `{ refusal: NO_PROFILE_LOG, scope: 'profile' }` for each action. The bindings name `hideEntriesForDay` and `restoreHiddenOnDay` as writers. `VALID_BODY` gets one body per action. The module is added to the pinned list and to the guide's `owns:`. **These are append points that A1 and V1-24 2 also edit, so those PRs serialize** (WP-1, "Traps").                                                                                                                                                                                                                  |
| `apps/web/app/p/[profileId]/action-state.ts`                                                                                | EDIT   | `RestoreActionState = ActionState & { restore?: RestoreResultDTO[] }`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `apps/web/lib/dal/entries.ts`                                                                                               | EDIT   | `hideEntriesForDay` and `restoreHiddenOnDay`. `listDayWithHidden(profilePublicId, day)` returns `{ live, hidden, otherDays }` and folds in the hidden-days read (arch S4). Each hidden item carries **only** `afterEntryId` for placement: the preceding live entry in the `(created_at, id)` order at `:251`, computed in the DAL (decision D). `logCheckinEntries` becomes a wrapper over `writers/checkin.ts`. The now-false comment at `:441` is corrected.                                                                                                           |
| `apps/web/lib/dal/hidden-dto.ts`                                                                                            | NEW    | `HiddenOnDayDTO`: events of `{ hiddenAt, hiddenAtLabel, kind: 'one' \| 'row' \| 'clear', items: { entryPublicId, label, afterEntryId, sectionKey } }`. It has **no `restorableUntil`** (decision A; the field arrives with the purge). Also `RestoreResultDTO`.                                                                                                                                                                                                                                                                                                           |
| `apps/web/lib/entries/entry-label.ts`                                                                                       | EDIT   | `entryLabel` takes a `Pick<EntryDTO, …>`, so a hidden item is labelled by the same function as a live one. A strength label adds `· {n} sets` (UX lens 1 #6).                                                                                                                                                                                                                                                                                                                                                                                                             |
| `apps/web/app/p/[profileId]/actions.ts`                                                                                     | EDIT   | `logLifeActivitiesAction` (`:446-455`) today returns `ok` on any conflict. An `own_hidden` result now returns `{ ok:false, error: HIDE_COPY.loggedThenDeleted }`, never `ok`. `logCheckinsAction` (`:229-234`) gives `own_hidden` the same copy.                                                                                                                                                                                                                                                                                                                          |
| `apps/web/app/p/[profileId]/life-form.tsx`                                                                                  | EDIT   | **Correctness B1 / db-safety B2: the life button's lost write.** Today `LifeButton` is keyed `a.key` (`:91`) and holds `useState(newId)` (`:38`), so the **same** `client_id` survives a hide, and also survives a **day change**, which is a pre-existing bug. After a Delete the button reappears with the dead id, the tap conflicts with the hidden row, and the action reports `ok`. The fix keys it `${day}:${a.key}:${loggedEntryId ?? 'open'}`, with the page passing a key → entry-id map instead of `loggedLifeKeys`.                                           |
| `apps/web/app/p/[profileId]/page.tsx`                                                                                       | EDIT   | Pass the logged-life map; that is the only B1-2 change to the page.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `apps/web/lib/constants.ts`                                                                                                 | EDIT   | `HIDE_COPY` (the strings B1-2 needs).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `docs/features/write-path.md`, `docs/features/delete-and-restore.md`                                                        | EDIT   | The actions; the `client_id` lifetime audit (below).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `docs/privacy/data-inventory.md`                                                                                            | EDIT   | §1 (`:112-113`) and §5 (`:246-248`): the app now writes `deleted_at`, through `entry-actions.ts`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

**Every form's `client_id` lifetime** (accept 1). An id that outlives a hide re-targets a hidden row:

| Form                                               | Id lifetime                                                                                   | After a hide                                                    |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Bodyweight (`bodyweight-form.tsx:34`)              | per mount; keyed `form-${day}` (`bodyweight-section.tsx:62`); unmounted while a receipt shows | ✅ remounts, fresh id                                           |
| Check-ins (`checkin-form.tsx:57-61`)               | rotated after every successful write (`idSeed`)                                               | ✅ the logged field's id was already rotated                    |
| Life (`life-form.tsx:38`, `:91`)                   | per instance, keyed by activity only                                                          | 🔴 reuses the dead id, so it is a lost write. **Fixed in B1-2** |
| Strength (`strength-form.tsx:155-173, :273, :307`) | session id per mount, remounted on `gen` after every save; movement ids `newId()` per card    | ✅                                                              |
| Amends                                             | no `client_id`                                                                                | n/a: they filter `deleted_at IS NULL` and answer `notFound`     |

**Is B1-2 reachable before B1-3?** Scope N asked for this to be probed. Next registers a Server Action
id only for actions that some client module references. With no importer until B1-3, `entry-actions.ts`
may not be reachable by a crafted POST at all. **Unverified.** B1-2 checks the build's
`server-reference-manifest.json` and states the answer in the PR. Either way, B1-2's inventory edit
keeps the docs true.

### B1-3 — `feat/v1-9b-1-3-hide-ui` (after V1-24 3b)

| Path                                                                                                       | Change     | What & why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/app/p/[profileId]/hidden/hidden-visit.tsx`                                                       | NEW        | `'use client'`, keyed `${profileId}\|${day}` (FE-6). **It owns dispatch** (UX lenses 1 and 2, #1). On submit it adds ids to the visit set **optimistically** and marks them pending. On failure it removes them and announces the error. On success it moves focus **in an effect, once the target exists**. One membership rule: a **Delete puts a tomb in place**; a **swap's hidden holder goes to the bar**; a **clear goes to the bar** as one event. It uses the seams table's shared announcer, not a second region (reuse S3). While a restore is pending it suppresses `SavedAnnouncer`'s weigh-in message, so one restore yields one announcement (UX lens 2 #3). |
| `apps/web/app/p/[profileId]/hidden/delete-entry-control.tsx`                                               | NEW        | A `Button variant="ghost" size="sm"` "Delete", with `aria-label` "Delete {label}" or "Delete {label}, {n} sets". While pending: disabled with "Deleting…" (UX lens 1 #8).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `apps/web/app/p/[profileId]/hidden/hidden-slot.tsx`                                                        | NEW        | It renders a hidden item **only if** the item is in the visit set, as the **shared Undo line** (seams table: `components/undo-line.tsx`, owned by PROF-1 PR b). The line reads "{label} deleted · Undo", with `aria-label={HIDE_COPY.restoreLabel(label)}`. Undo is `aria-disabled` until the hide returns (UX lens 2 #5). It renders as `<li>` inside a list and `<div>` otherwise (UX lens 2 #8). **A refusal on an in-place Undo renders in place** (lens 1 #2, lens 2 #2, lens 3 #1): the text is referenced by `aria-describedby`, with "Use {value} instead" and "Leave it", and focus stays on Undo.                                                                 |
| `apps/web/app/p/[profileId]/hidden/hidden-bar.tsx`                                                         | NEW        | `<section aria-labelledby>` + `<h2>` "Hidden on this day (n)". **The count unit is rows as shown**: a folded row of 3 bouts counts 1 (UX lens 1 #4, correctness NIT). With more than one event, the list sits behind a `button aria-expanded aria-controls` (not `<details>`, UX lens 2 #7). Each item shows its label and "Hidden {time}", or "Hidden {date}, {time}" when the hide was on another day (lens 3 N7), then "Restorable until removed", then Restore or "Restore all". The `slot_taken` refusal sits beside its item, with logged and hidden times on both values, "Use {value} instead", and "Leave it" as the default.                                      |
| `apps/web/app/p/[profileId]/hidden/other-days.tsx`                                                         | NEW        | _Decision E._ One line: "Hidden on {k} other days", linking the most recent day. The rest sit behind a disclosure with a fixed `max-h` and scroll, so the header never grows with the history.                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `apps/web/app/p/[profileId]/page.tsx`                                                                      | EDIT       | `listDayWithHidden` goes in the existing `Promise.all` (`:85-89`). `<HiddenVisitProvider key=…>` wraps the day. The bar goes under the header and above the sections; `OtherDays` goes under `DayNav`. Each 3b section gets its hidden items by `sectionKey`.                                                                                                                                                                                                                                                                                                                                                                                                               |
| `apps/web/app/p/[profileId]/bodyweight-amend.tsx` / `bodyweight-section.tsx`                               | EDIT       | Delete renders **in the amend's closed branch only** (`bodyweight-amend.tsx:103-123`), so it is hidden while Change is open (UX lens 1 #5). Change and Delete sit in one `flex gap-2` and wrap together. **On a day with duplicates:** after 1d this happens only on legacy pre-1d days. The receipt lists one line per value, each with its own Delete, which replaces `BODYWEIGHT_COPY.duplicates`' "ask a parent / not removed in the app yet" text. That copy is retired or rewritten (reuse N2; lens 2 #6).                                                                                                                                                            |
| `apps/web/app/p/[profileId]/movement-line.tsx`, `strength-session-receipt.tsx`                             | EDIT       | An optional `control` slot on the name line (`:60-68`): `items-start gap-2`, the label `min-w-0 flex-1 [overflow-wrap:anywhere]`. Delete is passed only where Change is (`editable`). Hidden members render in their placement. The existing receipt ids (`strengthReceiptId`, `BODYWEIGHT_RECEIPT_ID`, `constants.ts:361, :484`) are reused as focus targets; per-entry ids are added only where none exists.                                                                                                                                                                                                                                                              |
| `apps/web/lib/entries/activity-totals.ts`                                                                  | EDIT       | `MetricTotal` gains `entryIds`, so a folded row can hide its bouts (Q9).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `apps/web/lib/constants.ts`                                                                                | EDIT       | `HIDE_COPY` completed. The `slot_taken` text is **composed from `BODYWEIGHT_COPY.onePerDay`**, not re-typed (reuse).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `docs/privacy/notice.md` + `apps/web/lib/privacy/notice-content.ts` (`pnpm --filter web privacy:generate`) | EDIT       | The sentence below. `:149-152` is rewritten for post-1c sign-in ("anyone in your household who is signed in", not "anyone with your access code"). The export lines (`:163-170`) say a hidden item is not in the zip, and that Restore or the full copy gets it back. The **"Last updated"** line is bumped and the notice is re-signed per its own process (privacy S3–S7).                                                                                                                                                                                                                                                                                                |
| `docs/privacy/data-inventory.md`                                                                           | EDIT       | The **header date** is bumped. §4 gets two new rows: a hidden item's label (a hidden weigh-in's **value** included) is readable by anyone who can open the athlete until it is removed; and "Hidden {time}" discloses **when** someone deleted it (privacy N8). §6 (`:292-295`): Restore or the full copy recovers a hidden row. §8 (`:365`): restorable until removed, and purged once PRIV-3 ships, with a new row saying a session's "How did it feel?" note stays after its entries are hidden (decision C).                                                                                                                                                            |
| `docs/runbooks.md`                                                                                         | EDIT       | The full copy (`:806-810`) includes hidden rows until they are purged.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `apps/web/e2e/delete-restore.spec.ts`, `apps/web/e2e/a11y.spec.ts`                                         | NEW / EDIT | Test plan.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `docs/features/delete-and-restore.md`, `docs/features/strength-logging.md`                                 | EDIT       | The islands, the slot, and the single-copy rule.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

**The notice sentence** (`notice.md:136-152` and the `:126` table row). It is written for the
no-purge state:

> **Deleting something in the app hides it.** Delete is on each logged item. The item disappears for
> everyone in your household and shows up under "Hidden on this day", where anyone in your household
> who is signed in can put it back. **For now it stays hidden until you restore it or your household is
> deleted** — the job that removes hidden items for good after a set number of days is being built, and
> this page will give that number when it exists. A session's "How did it feel?" note stays even when
> every item in it is hidden.

The purge PR replaces this with the dated version (requirement 3).

### B2 — `feat/v1-9b-2-clear-day`

| Path                                                             | Change | What & why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared/src/hide.ts`                                    | EDIT   | `CLEAR_DAY_CONFIRM_WORD = 'delete'`, `normalizeClearConfirm`, `CLEAR_DAY_MAX`, and `clearDaySchema = hideEntriesSchema.extend({ confirm: z.string().transform(normalizeClearConfirm).pipe(z.literal(CLEAR_DAY_CONFIRM_WORD)) })`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `apps/web/app/p/[profileId]/entry-actions.ts`                    | EDIT   | `clearDayAction` = `runHide(formData, clearDaySchema)`. There is no new writer, so a clear is one `UPDATE`, one `now()` and one event.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| WP-1 registry / bindings / `VALID_BODY`, `entry-actions.test.ts` | EDIT   | `clearDayAction: { refusal: NO_PROFILE_LOG, scope: 'profile' }`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `apps/web/app/p/[profileId]/hidden/clear-day.tsx`                | NEW    | The trigger is "Clear this day…" (`min-h-11`). The dialog is U0's primitive if merged, otherwise a native `<dialog>` with `showModal()`. It is **top-anchored** so the keyboard never covers the input (UX lens 2 #4). Focus starts on the title; `aria-describedby` points at the consequence. The input has `autocapitalize="off" autocorrect="off" spellcheck={false} enterKeyHint="done"`. The button stays disabled until `normalizeClearConfirm(v) === CLEAR_DAY_CONFIRM_WORD`, with a hint whose text is built **from the constant**. A `role="status"` sits **inside** the dialog (criterion 46). Clear uses a non-destructive variant, or a token fix for its contrast (UX lens 2). **On success** the dialog closes, the bar shows one event "Cleared this day · {n} items", focus moves to its **Restore all**, and the announcement fires **after** close (lens 1 #3, lens 3 #6). |
| `apps/web/lib/constants.ts`                                      | EDIT   | `CLEAR_DAY_COPY`. Its body: "This hides all {n} items logged for {name} on this day, for everyone in your household. You can put them all back from Hidden on this day. Their 'How did it feel?' note stays." `{n}` counts rows as shown.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `apps/web/app/p/[profileId]/hidden/hidden-bar.tsx`               | EDIT   | A partial "Restore all" lists each item that stayed hidden, with its reason.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `docs/features/write-path.md`, `delete-and-restore.md`           | EDIT   | The third action (arch S5).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `apps/web/e2e/*`                                                 | EDIT   | Test plan.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

## 360px width math

The main column is `px-4` (`page.tsx:128`), so 360 − 32 = **328px**. A bordered `px-4` card leaves
**294px** of content (`bodyweight-receipt.tsx:84`; the spec's disagreement 6). A `size="sm"` button is
`px-2.5` with `text-[0.8rem]` (`components/ui/button.tsx:39`), so "Delete" and "Change" are about
**64px** wide, and every button is 44px tall from `min-h-11` (`:20`). **B1-3 measures these on the
real page at 360px** and puts the numbers in the PR.

| Row                                                 | Arithmetic                                                              | Result                                                 |
| --------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------ |
| Bodyweight receipt                                  | "Saved: 1000.5 lb" ≈136 + 8 + Change 64 + 8 + Delete 64 = **280** ≤ 294 | Fits. The action group wraps as one unit.              |
| Strength movement name line                         | 294 − 64 − 8 = **222**                                                  | "Overhead Shoulder Press" (≈190) fits.                 |
| …in a superset (`strength-session-receipt.tsx:127`) | 280 − 72 = **208**; with a status badge, **145**                        | Fits; with a badge the label wraps to two lines.       |
| Undo line                                           | 294 − Undo ≈48 − 8 = **238**                                            | "Overhead Shoulder Press deleted · 3 sets" wraps once. |
| Hidden-bar item                                     | 328 − 22 = 306; − "Restore all" ≈84 − 8 = **214**                       | The detail wraps to two lines.                         |
| Refusal actions                                     | "Use 112.4 lb instead" ≈140 + 8 + "Leave it" ≈70 = **218** ≤ 306        | One line.                                              |
| "Hidden on {k} other days"                          | one link line; the disclosure is `max-h-40` with scrolling              | Fixed height (decision E).                             |

## Test plan

**B0 — `db:verify`:**

1. **Behavioural case, ordered first.** Through the **shipped** writers: soft-delete one movement entry
   by fixture, then replay the graph with the same `client_id`s. Every table still has **one** row per
   id. For strength the replay must **throw**, so it is asserted with
   `assert.rejects(…, /no live row for client_id/)` (db-safety 3). A check-in replay gives
   `created: false`.
2. **Structural case.** `pg_indexes.indexdef` for the five indexes has no `WHERE`.
3. `verify.ts:3592-3606` stays green **unmodified**.
4. Mutation 07 goes red on case 1.

**B1-1 — `db:verify`:**

1. **The reader audit**, one case per row.
2. **Event identity and microseconds** (correctness B3, db-safety 5).
   - Fixture rows get `deleted_at` with **six** fractional digits (`'…12:00:00.123456+00'`). Restore by
     the read's token must succeed.
   - Two separate hide calls with `pg_sleep(0.001)` between them give two tokens. Restoring one leaves
     the other hidden.
   - Three ids hidden inside one transaction with `pg_sleep(0.01)` between statements share **one**
     token. That pins `now()` over `clock_timestamp()`.
   - Mutations 08 and 09 go red.
3. **`slot_taken`** (criterion 12's fixture). Hide weigh-in A, log B, then restore A: the answer is
   `slot_taken` with `heldBy` B. A stays hidden, B is untouched, and no `23505` escapes.
4. **Swap** (Decision 8).
   - Swap A for B: A is live, and B is hidden under a new token.
   - **Bad order 1:** the item is not hidden under the token. The answer is `changed`, and B is still
     live.
   - **Bad order 2:** the named holder is no longer the holder. The answer is `changed`, and nothing
     is committed.
   - Replaying the swap gives `ok` with no change.
5. **Replays.** A hide replay returns the same token and leaves `updated_at` unchanged. A restore
   replay is `ok`. A restore after a re-hide is `changed`.
6. **Check-in/life writer.** A replay of a hidden row's `client_id` gives `own_hidden`, and the row
   stays hidden. A replay of a live row gives `replay`. Another profile's id gives `conflict`.
7. **TEN-1 matrix, both directions.** B's scope cannot hide, restore or read A's rows.
8. **Export** (criterion 16). Capture the month, hide it all, and `loggedMonths` drops the month.
   Restore, and the month is deep-equal to the capture.
9. **Q7.** A hidden bout leaves `weeklyAdherence`, and a restore brings it back.

**B1-2 — Vitest (`entry-actions.test.ts`; `actions.test.ts` for the life and check-in mapping):**

- Through WP-1's matrix: **unauth → reject** and **wrong household → `NO_PROFILE_LOG`**, byte-identical.
  The writers are asserted not called.
- **Bad body → zod-reject:** an empty id list, over `HIDE_ROW_MAX`, a non-UUID, a bad day, and a bad
  `hiddenAt` format.
- **Wrong owner or a stale id** → `notFound`, byte-identical. **A replay** → one effect and an identical
  envelope. `slot_taken` maps to `restore[]` with `heldBy.label`.
- **Life:** an `own_hidden` result returns `{ ok:false, error: HIDE_COPY.loggedThenDeleted }`, never
  `ok`. The same holds for check-ins.
- **`life-form.test.tsx`:** the button remounts, with a new id, when the day changes and when
  `loggedEntryId` changes.
- **`entries.test.ts`:** the emitted SQL of `listDayWithHidden`'s live half is byte-identical to
  `listEntriesForDay`'s.

**B1-3 — Playwright (`pnpm e2e:local`), Vitest, a11y:**

- **Delete a weigh-in.** The Undo line appears in its place, focus is on Undo, there is one
  announcement, and the form returns. Undo puts the receipt back with focus on it, and there is **one**
  announcement (not `SavedAnnouncer`'s too).
- **Reload.** The item has moved into the bar with "Restorable until removed". Go to the previous day
  and come back: it is still in the bar.
- **IXD-2.** A second Delete lands where the finger was. The bounding box of everything **above** the
  tapped row is unchanged.
- **The life lost write** (accept 1). Log Wake, Delete it, tap Wake again. It is listed as logged.
- **`day-slot`, same visit** (lens 3 #1). Delete a weigh-in, log a new one, then press the **in-place**
  Undo. The refusal shows in place and focus stays on Undo. "Leave it" changes nothing. "Use {value}
  instead" swaps, and the newer weigh-in goes to the bar.
- **`day-slot` after a reload:** the same flow from the bar.
- **A folded row:** "Delete Push-Ups, 3 sets" gives one bar item that counts as 1.
- **Criterion 13:** exactly one `Delete {movement}`.
- **Pending state:** while a Delete is in flight the button reads "Deleting…", and Undo is
  `aria-disabled`.
- **Vitest for `hidden-visit`:** optimistic add, rollback on failure, focus only once the target
  exists, and a remount on a new key empties the set.
- **a11y scan at the narrow width** (UX lens 2): the Undo line, the expanded bar, the refusal, and the
  typed-clear dialog.
- **Real phones** (spec → "For the implementation plans"): on VoiceOver and TalkBack, check that the
  hide announcement and the focus move to Undo both survive, and that Undo is reachable by swipe.
  Results go in the PR. Screenshots via `ui-screenshot` at 390/820/1280.

**B2:**

- **zod:** `" Delete "` passes; `"delet"`, `"DELETE!"` and a missing confirm fail.
- **Playwright:** clear a six-row day. The bar shows "Cleared this day · 6 items", focus is on Restore
  all, and the announcement comes after close. Restore all brings back 6. With a re-logged weigh-in,
  restore gives "Restored 5 of 6" plus the refusal.
- **`db:verify`:** every row a clear hides shares one `deleted_at`.

## Risks / rollback

| Risk                                                                                                                                   | Mitigation                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B0 racing the deploy breaks every insert                                                                                               | B0 changes no app code, and the writers keep `where:` (Decision 1).                                                                                                                       |
| B1-1 relies on the new index before prod has it                                                                                        | B1-1's gate checks prod's `pg_indexes`, not only the run's colour (db-safety B1).                                                                                                         |
| **Between B0 and B1-1 a hidden row's replay throws** instead of inserting. That is a 500 for a stale tab, and only on the two 1c rows. | It is the price of criterion 9, and only a replay of the 2026-09-30 submits can hit it. Accepted; named in the PR body (db-safety 3).                                                     |
| A stale strength or bodyweight tab resubmits after a hide, which surfaces as a 500, not a second row                                   | Decision 7: needs the same render resubmitted across a hide. The forms remount after a save or a hide.                                                                                    |
| B0 refuses in prod, and `migrate.yml` freezes every later migration                                                                    | The DO block raises before any DDL. Link the wedge runbook (`runbooks.md:116`). A correction selects by predicate. AUTH-1 1b waits, and the PR says so.                                   |
| The lock blocks Today's reads during B0                                                                                                | Under a second at prod's size; bounded by `lock_timeout` 5 s.                                                                                                                             |
| The token loses microseconds                                                                                                           | Decision 2's fixed text format; B1-1 case 2; mutation 09.                                                                                                                                 |
| **The life button reports `ok` for a lost write**                                                                                      | Fixed in B1-2 (the key and the typed result), and covered by e2e.                                                                                                                         |
| A restored check-in or life entry duplicates one logged since                                                                          | There is no DB key for those, so there is nothing for `slot_taken` to arbitrate. The check-ins CSV is header-only (`data-inventory.md` §6). A natural key for them is V1-24 2's question. |
| A hidden weigh-in's value, and **when** it was deleted, stay visible to the household                                                  | The audience is the same one that saw the live value. The value is needed for "Use {value} instead". Stated in inventory §4.                                                              |
| A child hides a sibling's weigh-in                                                                                                     | ADR 0008 decision 4. The bar on the **athlete's** page is the recovery.                                                                                                                   |
| Hidden rows accumulate with no end until PRIV-3                                                                                        | That is the honest state, and the notice says it (decision A). The purge brings the end.                                                                                                  |
| LWW later                                                                                                                              | ADR 0008 decisions 2 and 3.5; the sync PR reconciles it. Today a hide beats an edit, because the amends filter `deleted_at IS NULL`.                                                      |
| **LLM never authors loads**                                                                                                            | Hide, restore and swap write only `deleted_at` and `updated_at`.                                                                                                                          |
| **CSV byte-faithfulness**                                                                                                              | No export query changes. A hide changes the month's export by design, and a restore brings it back byte-identical.                                                                        |

**Rollback:**

- **B0:** a forward migration restores the partial predicate. It is safe until B1-1; after B1-1, roll B1
  back first.
- **B1-1 and B1-2:** plain reverts. Rows already hidden stay restorable by a correction that
  **selects by predicate**, never by committed ids.
- **B1-3:** the revert **writes a new notice state** ("Delete was withdrawn; items already hidden stay
  hidden until restored on request"). It does not restore stale text (privacy S5).
- **B2:** a plain revert.

## Out-of-scope / deferred

- **The purge job, `N`, the window and the dated copy.** These belong to PRIV-3, under the requirements
  above.
- **Set grain.** `entry_sets.deleted_at` stays unbuilt (ADR 0008).
- **Hiding a session or superset row.** The grain is the entry. The orphaned note is decision C.
- **`day_readiness` in a clear.** It is not an entry, and the dialog counts "items logged".
- **FE-15**, the client event ids, belong to sync (Decision 6).
- **Dropping the redundant `where:` clauses.** A later cleanup.
- **Typed replay-of-hidden for strength and bodyweight.** Cut (Decision 7).
- **A per-day marker on the adherence strip** (Q7's second half). The strip is per metric
  (`weekly-adherence.tsx`) and renders nothing until ramp targets are seeded (`page.tsx:82-84`).
- **A guard that the journal's `when` only increases.** Filed as its own row.
- **The pre-3b order.** Dropped (decision D).

## Open questions (for the maintainer)

1. **ADR 0008 decision 4 at AUTH-1.** The recommendation is that deletion authority equals logging
   authority, so any signed-in household member can hide and restore (Decision 9). Confirm, or name a
   narrower rule before B1-2.
2. **The spec's contract.** The plan amends it in four ways (Decisions 3, 5 and 8, Contradiction 4):
   - `restoreHiddenSchema` gains `entryPublicIds` and an optional `keepInsteadOf`.
   - `RestoreResult` gains `'changed'`.
   - `HiddenOnDayDTO` drops `restorableUntil` until the purge.
   - The two hide schemas merge into one.

   Accept these, or refuse them.

3. **Criterion 14.** The plan hides what the dialog counted. The alternative is a fresh select of
   "every live entry" at confirm time. Which should it be?

## Contradictions with the spec and the rows

1. **The spec treats V1-24 1d and 1e as future work.** It does so in chunk row E, on the critical path,
   and in "Can start before AUTH-1 1c". Both have shipped (`9336554` #210 with `0012`; `b625a23` #214),
   and so has 3a (#211, #212).
2. **"Nothing writes `deleted_at`" holds only for app code.** Prod holds hidden rows from the 1c
   correction (`registry.ts:214-217`).
3. **Criterion 10 asks for "the date it stops being restorable"**, and ADR 0008 says there is one clock.
   No date exists until the purge does (decision A).
4. **The data contract cannot express FE-7 or the swap.** Its `hiddenAt` identity also breaks if the
   token ever becomes a `Date`. Open question 2.
5. **Criterion 14 says "every live entry"**, while IXD-12 says "the count matches what you see". Open
   question 3.
6. **Q7's marker has no day to mark.** The strip is per metric.
7. **`data-inventory.md` §5 lists `client_id` among the keys a hide frees.** B0 makes that false, so B0
   edits it.
8. **The V1-9b row says "no migration" and names `logCheckIns`.** B0 supersedes the first, and the
   function is called `logCheckinEntries`.
9. **`docs/architecture.md:85` draws `ON CONFLICT … DO UPDATE (LWW)`.** The shipped code is `DO NOTHING`,
   and LWW does not exist yet (B0, arch S3).

## Review-response log

Round 1, 2026-10-23. The engineering panel had six lenses and the UX panel had three. The orchestrator
decided **A–E**, recorded in the plan above. Every accepted finding was checked against the cited code
before it was changed here. There are no pushbacks this round: no finding was contradicted by the code.

### Orchestrator decisions

| #   | Decision                                                                                         | Where it landed                                                                                       |
| --- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| A   | One clock: no restore window until the purge is live, and "Restorable until removed" until then. | Goal, gates, Decision 2, requirements 1 and 3, the notice sentence, Contradiction 3. `N` gates no PR. |
| B   | `entry-actions.ts` in WP-1's matrix, with one private `runHide`.                                 | Decision 5, B1-2, B2                                                                                  |
| C   | The purge hard-deletes orphaned sessions and supersets; the note's survival is said until then.  | Requirement 2, B2 copy, notice, inventory §8                                                          |
| D   | B1-3 is gated on 3b; the fallback column is dropped; only `afterEntryId` stays.                  | Gates, staging, B1-2's DTO, Out-of-scope                                                              |
| E   | "Hidden on {k} other days" is one line plus a fixed-height disclosure.                           | `other-days.tsx`, width math                                                                          |

### Engineering — correctness

| #   | Finding                                                                                                                                                   | Verdict  | Resolution                                                                                                                                                            |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | **BLOCKING.** The life button reuses its `client_id` after a hide (and across days), so the tap conflicts with the hidden row and the action reports `ok` | accepted | Verified at `life-form.tsx:38, :91` and `actions.ts:446-455`. B1-2 adds the key fix, a typed `own_hidden` result and e2e; the lifetime audit table covers every form. |
| B2  | **BLOCKING.** The swap could hide the holder before proving the item restorable                                                                           | accepted | Decision 8's order inside a savepoint; both bad orders are in `db:verify`.                                                                                            |
| B3  | **BLOCKING.** The microsecond token is untested                                                                                                           | accepted | Six-digit fixtures, `pg_sleep` between calls, `now()` pinned, mutation 09.                                                                                            |
| 4   | Any bodyweight typed branch must sit between (b) and (c)                                                                                                  | accepted | Noted in Decision 7; the branch itself is cut.                                                                                                                        |
| 5   | `hiddenSinceWrite` had no DAL type, mapping or copy                                                                                                       | accepted | Cut (Decision 7).                                                                                                                                                     |
| 6   | The check-in/life insert is not driven by `db:verify`                                                                                                     | accepted | Moved to `writers/checkin.ts` in B1-1.                                                                                                                                |
| 7   | Duplicate ids could miscount the all-or-nothing check                                                                                                     | accepted | Ids are de-duplicated by the schema transform; the caps are named separately.                                                                                         |
| NIT | The count unit was ambiguous; the token format depended on the session                                                                                    | accepted | Rows as shown; `to_char` UTC.                                                                                                                                         |

### Engineering — scope

| #     | Finding                                                                                     | Verdict  | Resolution                                                                                                                                                                |
| ----- | ------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1    | The restore-window code should not gate on `N`                                              | accepted | Decision A.                                                                                                                                                               |
| S2    | The pre-3b fallback doubles the UI work                                                     | accepted | Decision D.                                                                                                                                                               |
| S3    | `hiddenSinceWrite` is speculative                                                           | accepted | Cut.                                                                                                                                                                      |
| N1–N6 | Clear constants in B1-1; a permanent runbook entry; the 07 hedge; branch ids; the DCE claim | accepted | Constants moved to B2; no new runbook entry (the wedge section is linked instead); 07 patches both files; one branch scheme; DCE is probed in B1-2 and marked unverified. |

### Engineering — architecture

| #   | Finding                                             | Verdict  | Resolution                                                                  |
| --- | --------------------------------------------------- | -------- | --------------------------------------------------------------------------- |
| B1  | Actions belong in WP-1's per-feature module         | accepted | `entry-actions.ts` (decision B).                                            |
| B2  | B0 and B1-1 collide with AUTH-1 on `write-path.md`  | accepted | Stated in the gates and the staging table.                                  |
| S3  | The architecture ERD and sequence diagram go stale  | accepted | B0 fixes `:342` and flags `:85`; B1-1 adds a hide/restore sequence diagram. |
| S4  | Two DAL reads for one page                          | accepted | Folded into `listDayWithHidden`.                                            |
| S5  | B2 must update `write-path.md`                      | accepted | Row added.                                                                  |
| S6  | The feature earns its own guide                     | accepted | `docs/features/delete-and-restore.md`; islands in `hidden/`.                |
| S7  | Placement fields in the DTO were over-built         | accepted | Only `afterEntryId` (and the section key).                                  |
| S8  | The criteria list was mismatched with the milestone | accepted | Criteria 9–13 and 15–16 (the orchestrator fixed the milestone).             |

### Engineering — reuse

| #     | Finding                                                  | Verdict  | Resolution                                                                                         |
| ----- | -------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------- |
| S1/S6 | Hide and clear duplicate a body                          | accepted | `runHide`.                                                                                         |
| S3    | A second announcer                                       | accepted | The seams table's shared Undo line and announcer; `SavedAnnouncer` is suppressed during a restore. |
| S4    | The deadline is computed in several places               | deferred | To the purge PR, once, in SQL (requirement 1).                                                     |
| S5    | The slot predicate is re-typed                           | accepted | `bodyweightSlot()` built from `DEFAULT_BODYWEIGHT_CONTEXT`.                                        |
| N1    | `isoDaySchema` and `uuidSchema`                          | accepted | Promoted; reused.                                                                                  |
| N2    | Copy duplicates `BODYWEIGHT_COPY`; `duplicates` is stale | accepted | Composed from `onePerDay` and the confirm const; `duplicates` retired or rewritten.                |

### Engineering — db-safety

| #   | Finding                                                       | Verdict  | Resolution                                                                            |
| --- | ------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------- |
| B1  | Gate on prod's `pg_indexes`; renumbering hazards              | accepted | B1-1's gate; regenerate on renumber; assert `when`; a guard filed as a row.           |
| B2  | The life lost write (with correctness B1)                     | accepted | As above.                                                                             |
| 3   | The strength proof must use `assert.rejects`; the B0→B1-1 500 | accepted | Test plan; Risks row.                                                                 |
| 4   | 07's `.expect` must match the first failure                   | accepted | The behavioural case is ordered first.                                                |
| 5   | Tokens (with correctness B3)                                  | accepted | As above.                                                                             |
| 6   | Link the wedge runbook; name the freeze                       | accepted | B0's runbook row; Risks.                                                              |
| 7   | The lock cost was understated                                 | accepted | "Blocks reads as well as writes", with its bound.                                     |
| 8   | Docblocks B0 makes false                                      | accepted | `schema.ts:187, :358, :638, :698-699`; `strength-session.ts:34-36`; `entries.ts:441`. |

### Engineering — privacy

| #     | Finding                                                                                                                            | Verdict  | Resolution                                                   |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------ |
| B1    | A window enforced before any purge contradicts the one-clock rule                                                                  | accepted | Decision A.                                                  |
| B2    | A session's "How did it feel?" note outlives its hidden entries                                                                    | accepted | Decision C: a PRIV-3 requirement, plus copy in the meantime. |
| S3–S7 | Export lines; post-1c wording at `:149-152`; rollback leaves a stale notice; re-sign and dates; the correction runbook commits ids | accepted | All in B1-3, Rollback, and B0's read.                        |
| N8    | "Hidden {time}" discloses when someone deleted something                                                                           | accepted | Inventory §4 row.                                            |

### UX — lens 1 (interaction + first run)

| #   | Finding                                               | Verdict  | Resolution                                                            |
| --- | ----------------------------------------------------- | -------- | --------------------------------------------------------------------- |
| 1   | **BLOCKING.** Who owns dispatch, focus and membership | accepted | `HiddenVisitProvider` with an optimistic set and one membership rule. |
| 2   | A refusal on an in-place Undo                         | accepted | Rendered in place.                                                    |
| 3   | Clear's landing                                       | accepted | One bar event; focus on Restore all; announce after close.            |
| 4   | The count unit                                        | accepted | Rows as shown.                                                        |
| 5   | Delete while Change is open; duplicate days           | accepted | Delete only in the closed branch; one line per value.                 |
| 6   | Strength label                                        | accepted | "· {n} sets".                                                         |
| 7   | Other days grow the header                            | accepted | Decision E.                                                           |
| 8   | No pending state                                      | accepted | "Deleting…"; Undo `aria-disabled`.                                    |

### UX — lens 2 (a11y + 360px)

| #   | Finding                                                    | Verdict  | Resolution                               |
| --- | ---------------------------------------------------------- | -------- | ---------------------------------------- |
| 1   | **BLOCKING.** Focus moved before its target exists         | accepted | An effect fires once the target mounts.  |
| 2   | Refusal not described                                      | accepted | `aria-describedby`; focus stays on Undo. |
| 3   | Double announcement on a weigh-in restore                  | accepted | `SavedAnnouncer` suppressed.             |
| 4   | Keyboard covers the dialog input                           | accepted | Top-anchored; `enterKeyHint`.            |
| 5   | Undo active before the hide returns                        | accepted | `aria-disabled` until it returns.        |
| 6   | Duplicates day                                             | accepted | As lens 1 #5.                            |
| 7   | `<details>` for the bar                                    | accepted | `button aria-expanded`.                  |
| 8   | Undo line inside a non-list                                | accepted | `li` or `div` by context.                |
| N   | `restoreLabel`; Clear contrast; a11y scans at narrow width | accepted | All in B1-3 and B2.                      |

### UX — lens 3 (trust + data entry)

| #   | Finding                                    | Verdict  | Resolution                                   |
| --- | ------------------------------------------ | -------- | -------------------------------------------- |
| 1   | Same-visit `slot_taken` is untested        | accepted | e2e from the in-place Undo.                  |
| 2/3 | The deadline's wording and timezone        | deferred | To the purge PR (decision A, requirement 1). |
| 4   | "Keep" is ambiguous; no times shown        | accepted | "Use {value} instead", with both times.      |
| 6   | Clear has no confirmation that it happened | accepted | As lens 1 #3.                                |
| N7  | Hidden time without a date across days     | accepted | "Hidden {date}, {time}".                     |
| N8  | Does re-hiding restart the clock?          | accepted | One sentence in Decision 2.                  |
