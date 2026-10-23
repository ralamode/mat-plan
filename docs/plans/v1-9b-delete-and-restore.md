# V1-9b — delete a logged entry, restore it, clear a day

> Backlog: [plan.md](../plan.md) row `V1-9b` (`plan.md:115`) · Spec:
> [crud-1-fix-it-yourself.md](../specs/crud-1-fix-it-yourself.md) chunks **B0, B1, B2** · Milestone:
> [CRUD-1](../milestones/crud-1-fix-it-yourself.md) _(the milestone file is written after the spec's
> sign-off, sequence step 5)_ · Branches: `db/v1-9b-0-client-id-arbiters`,
> `feat/v1-9b-1-hide-restore` (three PRs, suffixed `-1a`/`-1b`/`-1c`), `feat/v1-9b-2-clear-day`.
>
> Contract: [ADR 0008](../decisions/0008-deletion.md) (signed 2026-10-18), read in full. Prototype:
> [`docs/prototypes/crud-1/index.html`](../prototypes/crud-1/index.html) v9 (the maintainer approved
> v8, M32; v9 changes only target fields), screens **`day`**, **`day-slot`**, **`day-clear`**.

## Goal

A person who mis-logs something can remove it from the day themselves, see that it was removed, put
it back for a bounded window, and clear a whole day behind a typed confirm — without the maintainer
running `db:correct`. It closes the "deleted" half of Beta 1's exit box _"Every logged thing can be
corrected or deleted in the app"_ (`beta-1.md:441`) and makes the published notice's _"per-item
deletion is being built"_ (`docs/privacy/notice.md:136-152`) a description of what was built.

ADR 0008 fixes the meaning: a Delete **hides from the whole household**, is **restorable until it is
purged at `N`**, restore is **fallible** with a typed `slot_taken` refusal, clear-a-day restores as
**one** event, the grain is the **entry**, and the freed `client_id` is a migration owed before the
first volume write of `deleted_at`. This plan does not reopen any of that; it builds it.

**Decided by the maintainer and binding here:** logs are shown **in place, in their own section**;
there is no "Logged entries" list (criterion 48, M26, disagreement 12). Delete, the in-place Undo and
Restore act on the row where it sits, and the Hidden bar lists only what was hidden **before the page
loaded** (IXD-2, criterion 10).

## Where the gates stand today (measured on this branch, 2026-10-23)

| Gate (spec chunk table)                          | State                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **V1-24 1e lands before B1**                     | ✅ **Already met.** 1d is `9336554` (#210, migration `0012_bodyweight_one_per_day.sql`), 1e is `b625a23` (#214), 3a is `bb56c62` + `cefd500` (#211, #212), all on `origin/main`. The spec still lists 1d and 1e as future work (see [Contradictions](#contradictions-with-the-spec-and-the-rows)).                                                                            |
| **B0 before any B1 code**                        | Not started. Serial with AUTH-1 1b by migration number: AUTH-1's plan claims `0019` for `household_members` (`docs/plans/auth-1-clerk-google.md:833`); the last migration on main is `0018_ten2d_validate_global_row_has_pattern.sql`. B0 takes the next free number at merge time.                                                                                           |
| **AUTH-1 1c observed live**                      | Not shipped (1a, 1b-bis, 1c-pre have; 1b, 1c, 1d have not). **1c is a one-way door.** B1-2 and B1-3 wait for it; B0 and B1-1 do not (they touch no AUTH-1 file).                                                                                                                                                                                                              |
| **PRIV-3's plan has chosen `N`**                 | 🔴 **Not met, and nothing has started it.** `docs/plans/` has no PRIV-3 plan; the row (`plan.md:1735-1770`) says `N` is "bounded below by the restore window … this row's plan sets **both, together**". Every PR from B1-1 on reads `N` as a constant, so **B1-1 is blocked on that number, not on code**. The spec already calls this the milestone's critical path (PM-9). |
| **V1-24 3b** (removes the "Logged entries" list) | Not shipped; no file-by-file exists yet (the V1-24 plan defers it: `docs/plans/v1-24-form-is-the-day.md:206-208`). Both 3b and B1-3 edit `apps/web/app/p/[profileId]/page.tsx` and `movement-line.tsx`, so they serialize under parallel-work gate 1. **This plan handles both orders** — see [Both orders against V1-24 3b](#both-orders-against-v1-24-3b).                  |
| Prod already holds hidden rows                   | Yes. The V1-24 1c correction soft-deleted two weigh-ins (`packages/db/scripts/corrections/registry.ts:214-217`; `docs/runbooks.md:62`). So B0's prod proof is **not vacuous**, and the claim "nothing writes `deleted_at`" is true of shipped **app code** only.                                                                                                              |

## Staging

Five PRs. One migration (B0), in its own PR, never sharing review with a UI PR.

| PR       | What                                                                                                                                                                                                              | ~lines (hand-written, tests incl.) | Gate                                                                                                                                                                       |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **B0**   | The prod read (aggregate counts, committed in the PR), then **one migration** making the five `client_id` UNIQUEs non-partial; schema, `db:verify` proof of criterion 9, a mutation patch, docs whose claims flip | ~170                               | The read returns zero duplicate `client_id`s (any liveness) in all five tables, re-run immediately before merge; AUTH-1 1b's migration numbered first if it is ready first |
| **B1-1** | `packages/` only: shared schemas + `HIDDEN_RESTORE_DAYS`; the hide/restore writer; the day-scoped hidden read; the replay-of-hidden outcomes in the two create writers; `db:verify` proofs                        | ~390                               | B0's `migrate.yml` run green **on B0's merge SHA** (the `runbooks.md:63` "check both" rule); **`N` chosen**                                                                |
| **B1-2** | `apps/web`: DAL wrappers + DTOs, two Server Actions, `MUTATING_ACTIONS`, boundary tests; `data-inventory.md` §1/§5                                                                                                | ~330                               | B1-1 + **AUTH-1 1c observed live** (the actions start from 1c's `sessionUserOrNull()` + `checkMutationLimit`)                                                              |
| **B1-3** | The UI: Delete on each row, the in-place Undo line, the Hidden bar, the `slot_taken` refusal and "Keep X instead", "Also hidden"; **`notice.md`**; §4/§6/§8 of the inventory; e2e + a11y scan                     | ~400                               | B1-2; UX panel round on this plan; **merge B1-2 and B1-3 within days of each other** (B1-2 is reachable by a crafted POST, see Risks)                                      |
| **B2**   | Clear a day: typed `delete`, one transaction, restores as one event — reusing B1's writer, read and Hidden bar                                                                                                    | ~230                               | B1-3                                                                                                                                                                       |

**Why B1 is three PRs, not one.** Priced as one it is ~1,100 lines across three packages, the size the
V1-24 panel split into seven (`v1-24-form-is-the-day.md:172`). The split follows the seams the repo
already has: `packages/db` (proved by `db:verify` on PGlite, no app), the app's write boundary (proved
by `actions.test.ts`), and the screen (proved by Playwright). B1-1 is also the only part of B1 that
can land **before AUTH-1 1c** — it touches no file in 1c's table (`auth-1-clerk-google.md:1704-1715`).

## Acceptance

From the backlog row (`plan.md:115`), verbatim: _"Delete a mistaken entry → gone from Today; 'Clear
day' → type 'delete' → the day empties."_

Spec criteria this plan carries (text in [the spec](../specs/crud-1-fix-it-yourself.md) → Acceptance;
each line names the PR that carries its test):

- **9** — a replayed `client_id` of a hidden entry never inserts a second live row. **B0** (`db:verify`,
  the inverse of today's partial arbiter), plus **B1-1** for the writers' typed answer.
- **10** — Delete removes the entry for every viewer; an untimed `<name> deleted · Undo` line takes its
  place in the same position until the page is left; `Hidden on this day (n)` sits above the day's
  sections, survives reload and day change, lists only hides made **before this page loaded**, and
  each item states the date it stops being restorable. **B1-3.**
- **11** — focus to that row's in-place Undo after a hide, to the restored row after a restore; the
  live region mounted before its text changes. **B1-3.**
- **12** — restore returns the entry to its original position; a taken slot returns a typed
  `slot_taken` naming the holder, never a `23505` or a silent no-op, with one atomic "keep this one
  instead" and "Leave it" as the default. Fixture: hide a weigh-in, log a new one that day, restore the
  first. **B1-1** (writer), **B1-2** (action), **B1-3** (UI).
- **13** — a folded row (calisthenics bouts) names its count and hides as one event; a strength session
  rendered twice shows Delete on exactly one copy. **B1-3.**
- **14** — Clear stays disabled until the input equals `delete` ignoring case and surrounding spaces;
  one transaction; restores as one event; a partial restore says which entries could not come back
  and why. **B2.**
- **15** — hidden entries on other days are signposted with a link to each day. **B1-3** (scope: see
  Contradiction 3).
- **16** — a profile whose every entry in a month is hidden can still get its data. **B1-1** (proof),
  **B1-3** (notice). The chosen path is below ([Decision 4](#decision-4--the-export-omits-hidden-rows-the-person-gets-them-back-by-restore-or-by-asking)).
- **48** (owned by V1-24 3b) — this plan's controls sit on the row in its section; in the pre-3b order
  they sit where the row renders today.

Not carried: **45** is D4c/D5's Undo (programs); this plan's Undo is criteria 10–12 plus FE-7.

Open decisions this plan implements: **Q7** (a hidden entry does not count toward adherence, and the
day is signposted), **Q9** (a folded row hides all its bouts as one event), **Q10** (the words
"Delete", "Hidden on this day", "restorable until {date}"), **Q12** (typed `delete` for clear-a-day).

Done when, per PR:

- **B0:** `pg_indexes.indexdef` for the five `uq_*_client_id` indexes carries no `WHERE`; `db:verify`
  replays a hidden entry's `client_id` through the shipped writers and finds one row, not two; the
  mutation patch that re-partials `uq_entries_client_id` turns `db:verify` red.
- **B1-1:** every reader of `entries` / `entry_sets` / `entry_set_quantities` has a `db:verify` case
  showing a hidden entry and its children absent; restore round-trips the strength and bodyweight
  month rows **deep-equal** to before the hide; `slot_taken` is a typed value in every path.
- **B1-2:** both actions pass the four mandatory boundary tests through `MUTATING_ACTIONS`.
- **B1-3:** the `day` and `day-slot` prototype screens are reproduced at 390/820/1280 with
  screenshots; `notice.md` no longer says "The app has no Delete button yet".
- **B2:** the `day-clear` screen; one `deleted_at` value across every row the clear hid.

## Decisions this plan makes (with the alternatives rejected)

### Decision 1 — B0 re-predicates all five `client_id` arbiters; it does not "record why not"

The five are `uq_entries_client_id` (`packages/db/src/schema.ts:258-260`), `uq_entry_sets_client_id`
(`:321-323`), `uq_entry_set_quantities_client_id` (`:390-392`), `uq_sessions_client_id`
(`:665-667`) and `uq_supersets_client_id` (`:710-712`), each `WHERE deleted_at IS NULL`. B0 drops the
predicate from all five, keeping their names.

Why all five when B1 hides only `entries`: the hazard is per table and the fix is identical. Sessions
and supersets carry **client-minted** ids from the strength form, so a correction that hides a session
today arms the same inversion; `entry_sets` / `entry_set_quantities` ids are server-minted (`newId()`,
`packages/db/src/writers/strength-session.ts:216`, `:252`) and only matter at sync, but leaving two of
five partial makes the rule "it depends on the table", which is how `data-inventory.md` §5 came to
state the wrong version once already.

**Rejected:**

- **Record why not and keep the partial arbiters.** Then B1's first hide makes a stale tab's replay
  insert a **second live row** under the same `client_id` — criterion 9's failure — and the weigh-in
  form would answer `{ id }` for a row nobody can see. ADR 0008 decision 3.4.
- **An app-level "is this `client_id` hidden?" pre-check.** Races, and AGENTS.md forbids it by name
  ("Idempotency … NOT an app-level check").
- **Rewrite a hidden row's `client_id` on hide** (stash the original elsewhere). Needs a column ADR
  0008 does not authorize, and breaks restore's identity.
- **New index names** (`uq_entries_client_id_all`). The names appear in `verify.ts`
  (`expectRejectedBy('uq_supersets_client_id', …)` at `:1908`), in `bodyweight.ts:214` and in
  `write-path.md:182`; the predicate is the only thing changing, and "client_id is unique" is still
  what the name says.

**The writers keep `where: isNull(deletedAt)` on their arbiters in B0 — deliberately.** Postgres infers
a **non-partial** unique index for `ON CONFLICT (client_id) WHERE deleted_at IS NULL` (an index that
satisfies the predicate "need not actually be partial" — the `INSERT` reference, `index_predicate`),
so the shipped statements work against both index shapes. Dropping the `where:` in the same PR would
deploy app code that **only** infers the new index; Vercel's deploy races `migrate.yml`
(`.github/workflows/migrate.yml:6-7`), and against the old partial index a bare `ON CONFLICT
(client_id)` fails inference on **every insert** — the `docs/lessons.md:19-22` symptom, as a total
outage of logging. The `where:` clauses become redundant-but-harmless; removing them is a later
cleanup, after B0's migration is observed live, and is not owed by this plan.

### Decision 2 — a hide event's identity is `(profile, day, deleted_at)`, carried as **text**

The spec's proposal ("The data contract" → rules) is adopted with one correction it did not foresee:
the `hiddenAt` token **must never pass through a JS `Date`**. Postgres stores microseconds; a `Date`
holds milliseconds, so a token serialised from drizzle's `Date` mapping compares unequal to the row it
came from and every restore would return `not_found`. The repo has paid for this exact trap:
`registry.ts:209-212` (_"a token crossing a DTO, a form field and drizzle's `Date` mapping loses the
microseconds Postgres stores"_). So the read selects `sql<string>\`${entries.deletedAt}::text\``and
the writer compares`${entries.deletedAt} = ${token}::timestamptz`— a bound parameter, not`sql.raw`.

Every row a single transaction hides shares one `now()` (transaction start), so a folded row, a
clear-a-day and a swap are each one event without a new column. The writer **must** use `now()`,
never `clock_timestamp()`; a `db:verify` case pins it (three rows, one transaction, one token).

**Rejected:** an `event_id` column (unauthorized by ADR 0008; nothing needs it before sync — see
Decision 6); grouping by `deleted_at` rounded to the second (two taps in one second merge).

### Decision 3 — restore names the items as well as the event

The spec's `restoreHiddenSchema { profilePublicId, day, hiddenAt }` cannot tell three cases apart that
the UI must render differently, because once an item is live its `deleted_at` is gone:

| Item state when Restore arrives            | Meaning                                                | Answer                                                                    |
| ------------------------------------------ | ------------------------------------------------------ | ------------------------------------------------------------------------- |
| hidden, `deleted_at = token`, within `N`   | the normal case                                        | restore (or `slot_taken`)                                                 |
| live                                       | this restore already ran — a **replay**                | `{ ok: true }` — one effect, identical response                           |
| hidden under a **different** token         | restored and re-hidden elsewhere since the page loaded | `{ ok: false, reason: 'changed' }` → `AMEND_ERROR_COPY.staleWrite` (FE-7) |
| absent, foreign, or hidden longer than `N` | —                                                      | `{ ok: false, reason: 'not_found' }`                                      |

So B1-1 sends `{ profilePublicId, day, hiddenAt, entryPublicIds }`, and `RestoreResult` gains
`'changed'`. Both are **additive** contract amendments, flagged for the spec
([Contradictions](#contradictions-with-the-spec-and-the-rows) 4).

### Decision 4 — the export omits hidden rows; the person gets them back by Restore or by asking

ADR 0008 ("One constraint") makes this V1-9b's choice: a deleted-tolerant export path, or
**export-before-hide**. **Chosen: the latter, with no code change to the export.**

- The routine export keeps filtering hidden rows at its five places
  (`packages/db/src/queries/export-month.ts:88, :94, :100, :143, :170`). A mis-logged set that a person
  deleted must not keep flowing into the Claude workflow the CSV feeds — that would make Delete mean
  nothing for the one consumer the export exists for. It is also **zero-risk to byte-faithfulness**:
  the queries do not change.
- Criterion 16 is met two ways, both stated in `notice.md`: **Restore**, self-serve, on the athlete's
  page, for `N` days (after which the row is purged — the notice's own promise); and the on-request
  **full copy** (`notice.md:167-170`), which includes hidden rows until they are purged.
- B1-1 proves the self-serve path: hide every entry in a month → `loggedMonths` drops that month;
  restore the event → `strengthMonthRows` and `bodyweightMonthRows` return rows **deep-equal** to the
  pre-hide capture. Restore preserves `public_id`, `created_at` and every value, so the order keys
  (`export-month.ts:105-112`) and therefore the CSV bytes are unchanged.

**Rejected:** a deleted-tolerant export variant. The hidden grain here is the entry, not the profile,
so this is not even `isLiveProfile`'s variant — it would be a second family of month queries that
include hidden rows, i.e. the opposite of Delete. A hidden **profile** is A2/A3's problem, not V1-9b's.

### Decision 5 — one hide action for a row and for a folded row

`hideEntrySchema` and `hideGroupSchema` in the contract become **one** `hideEntriesSchema
{ profilePublicId, day, entryPublicIds: uuid[] (1..HIDE_BATCH_MAX) }`. A single row sends one id; a
folded calisthenics row (Q9) sends its bouts; B2's clear sends the day's. One writer, one event per
call, one set of boundary tests. `day` is required even for one id: the writer refuses ids not on that
day, so a crafted request cannot make one "event" span two days, and the Hidden bar's day scope holds.

All-or-nothing: if **any** id is not an owned entry of that profile on that day (live or already
hidden), the transaction rolls back and the answer is `AMEND_ERROR_COPY.notFound('entry')` — one
message for foreign, stale and wrong-day, so a crafted id learns nothing (`actions.ts:525-580`'s
argument). Ids already hidden are a **replay** and count as done.

### Decision 6 — idempotency is state-keyed, the way the shipped amends are; FE-15 goes to sync

AGENTS.md rule 6 asks that a retried mutation have one effect and the same response. Hide and
restore get it from state, exactly as `editBodyweightAction`'s branch (b) does (`actions.ts:573-577`):
a hide of an already-hidden owned entry is `ok`; a restore of an already-live item is `ok`. Neither
inserts, so there is no row for a `client_id` to dedupe.

**FE-15** ("hide and restore carry client-generated ids so they replay safely offline") is
**deferred to the v1.5 sync PR**, with reason: an id only helps if something persists it and replays
it, and there is no outbox yet; persisting it here would be the `event_id` column ADR 0008 does not
authorize. ADR 0008 decision 3.1 ("a hide is an event in the outbox, carrying the row's `client_id` and
the client's timestamp") is the sync PR's to build; B0 is what makes a hidden row's `client_id` still
addressable when it does.

### Decision 7 — `N` lives once, in `packages/shared`, and the restore window is enforced now

`HIDDEN_RESTORE_DAYS` (name final in PRIV-3's plan; this plan uses that name) is an `as const` number in
`packages/shared/src/retention.ts`, imported by the hidden read, the restore writer, the DTO's
`restorableUntil`, and — later — PRIV-3's purge job. If PRIV-3's PR has not created it when B1-1
lands, B1-1 creates it at the value PRIV-3's plan chose, and PRIV-3 imports it.

The **restore window** is enforced by B1-1 regardless of whether the purge job exists: the hidden read
returns only `deleted_at > now() - N days`, and the writer refuses older tokens as `not_found`. So a
`Restore` control can never be shown for a row the purge could delete underneath it — PRIV-3's lower
bound, by construction. Until the purge job ships, a row past `N` is invisible and unrestorable but
**still in the database**, and the notice sentence says exactly that (B1-3).

### Decision 8 — "Keep this one instead" is one transaction that hides a **named** holder

`restoreHiddenSchema` gains an optional `keepInsteadOf: entryPublicId`. The writer, in one transaction:
hides `keepInsteadOf` **only if it is still the live holder of that slot**, then restores the item. If
the holder changed since the refusal was rendered (a third weigh-in arrived), the answer is
`'changed'`, never a hide of something the person did not see. Order inside the transaction is
hide-then-restore, so the non-deferrable unique index never sees two live rows. Replay: target live
and named holder hidden → `ok`.

### Decision 9 — Decision 4 of ADR 0008, revisited at AUTH-1 (recommendation, for the maintainer)

ADR 0008: _"After `AUTH-1` this is revisited, not inherited."_ After 1c, logging authority is "a
session whose user is a member of the household", for every athlete in it (AUTH-1 plan § Design 3);
there are no roles until Beta 1 (`beta-1.md` → Roles). **Recommendation: deletion authority stays
equal to logging authority** — any member may hide and restore any of the household's entries — for
the reason the ADR gave (an irrecoverable `editRoutineAction` overwrite is already open to the same
principal; gating a restorable hide harder is theatre) and because Restore on the **athlete's** page
is what lets a parent undo a child's hide. Recorded as Open question 2 so the revisit is a decision,
not an inheritance.

## Both orders against V1-24 3b

`page.tsx` today renders bodyweight in `BodyweightSection` (`page.tsx:192-197`), strength receipts in
`StrengthSection` (`:202-211`), check-ins and life as **forms only** (`:214-252`), and **every** entry
again in the "Logged entries" list (`:282-348`) — the only place a logged check-in, life activity or
calisthenics bout appears at all. A strength session renders twice; the list copy is read-only when the
strength section is on the page (`editable={!strengthOnPage}`, `:335`).

The control is built so it does not care which order lands:

- **`DeleteEntryControl`** is a client island passed as a **slot** into the row, the idiom
  `BodyweightReceipt` already uses for Change (`control?: ReactNode`, `bodyweight-receipt.tsx:56`, `:82`).
  The row owns its position; the control owns nothing but its button.
- **The surface that owns Change owns Delete** (criterion 13). Single rule, already in the code: the
  list copy of a session is `editable={false}` while the strength section is on the page, so it gets
  no Delete either.
- **Tombs and the Hidden bar are placed by the same row→section mapping** that renders the live row.

| Surface                                   | **3b has merged** (expected order — B1 is behind AUTH-1 1c and PRIV-3's `N`; 3b is behind neither) | **3b has not merged** (fallback, B1-3 does not wait)                        |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Bodyweight                                | Delete beside Change in `BodyweightReceipt`                                                        | same                                                                        |
| Strength movement                         | Delete on the movement's name line in the section's `StrengthSessionReceipt`                       | same; the list copy stays read-only and Delete-less (criterion 13)          |
| Check-in / life entry                     | Delete on its row in its own section (3b's)                                                        | Delete on its row **in the Logged entries list**, the only place it renders |
| Calisthenics (folded)                     | Delete on the folded row in its section, naming the bout count                                     | Delete on the folded row in the list                                        |
| "Also logged" (activity left the routine) | Delete on its row there                                                                            | n/a — the list holds it                                                     |
| Tomb (in-place Undo)                      | in the row's slot in its section                                                                   | in the row's slot wherever it renders                                       |

In the fallback order, **3b's plan inherits one line item**: its row→section move carries
`DeleteEntryControl` and the tomb slot with each row. Nothing in B1-3 is thrown away — the control and
the tomb are row-local by construction. B1-3's PR description states which order it landed in.

## File-by-file changes

### B0 — `db/v1-9b-0-client-id-arbiters`

| Path                                                                                                                          | Change | What & why                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/db/src/schema.ts`                                                                                                   | EDIT   | Remove `.where(sql\`${t.deletedAt} is null\`)`from the five`uq_*_client_id` indexes (`:258-260`, `:321-323`, `:390-392`, `:665-667`, `:710-712`). Rewrite the three docblocks that justify the partial (`:187`, `:345-352`, `:386`) to say: a hidden row **keeps** its `client_id`, so a replay conflicts instead of inserting (ADR 0008 decision 3.4).                                              |
| `packages/db/migrations/00NN_v1_9b_client_id_arbiters.sql`                                                                    | NEW    | `drizzle-kit generate`, then hand-hardened (shape below).                                                                                                                                                                                                                                                                                                                                            |
| `packages/db/migrations/meta/*`                                                                                               | NEW    | Generated snapshot + journal (append-only, CI-guarded).                                                                                                                                                                                                                                                                                                                                              |
| `packages/db/scripts/verify.ts`                                                                                               | EDIT   | New section "V1-9b B0" (proofs below). Fix `upsertReturningId`'s fallback re-select (`:1575-1588`), which has no `deleted_at` guard — after B0 it can only find the hidden row on a hidden-replay, so it adds `isNull(table.deletedAt)` and throws on a miss like the shipped helper (`strength-session.ts:39-55`).                                                                                  |
| `packages/db/scripts/mutations/07-client-id-partial-again.{patch,expect}`                                                     | NEW    | Re-adds `WHERE "entries"."deleted_at" is null` to the new migration's `uq_entries_client_id`. Expect: the criterion-9 assertion reddens. _(Unverified: that `db:mutations` re-runs migrations from the patched SQL file rather than a cached build — check `mutations.mjs` before writing the patch; if it does not, patch `schema.ts` + migration together.)_                                       |
| `packages/db/scripts/mutations/README.md`                                                                                     | EDIT   | Row for patch 07.                                                                                                                                                                                                                                                                                                                                                                                    |
| `docs/features/write-path.md`                                                                                                 | EDIT   | Invariant 6 (`:177-180`): "every `client_id` unique is `WHERE deleted_at IS NULL`" becomes false. New text: non-partial since B0; the shipped arbiters still repeat `WHERE deleted_at IS NULL`, which Postgres still infers and which keeps a deploy racing the migration safe; do **not** drop it from a writer in the same PR as an index change. Trap entry: a hidden row's replay now conflicts. |
| `.claude/skills/add-server-action/SKILL.md`                                                                                   | EDIT   | `:37-39` ("the predicate must be repeated because the unique index is partial") → the reason is now deploy-order safety and the natural-key partials, not the `client_id` one.                                                                                                                                                                                                                       |
| `.claude/skills/db-migration/SKILL.md`                                                                                        | EDIT   | `:19` ("`client_id` … with a **partial** unique index") → non-partial since V1-9b B0; the `:68-71` rule still holds for the 9 natural-key partials.                                                                                                                                                                                                                                                  |
| `docs/privacy/data-inventory.md`                                                                                              | EDIT   | §5 (`:251-258`): "a soft delete frees the natural key — `client_id`, …" — `client_id` leaves that list. Of the fourteen partial arbiters, **nine** remain partial on `deleted_at` (the natural keys: superset order, the weigh-in day, set ordinal, quantity slot, readiness day, ramp week, block slug, prescription slot, target pair); recount from `schema.ts` in the PR and state the number.   |
| `docs/runbooks.md`                                                                                                            | EDIT   | New entry "If B0's migration refuses" (the 0012 precedent): which tables, the aggregate read, how to resolve a pair (a correction that keeps one row), re-run `migrate.yml` by `workflow_dispatch`.                                                                                                                                                                                                  |
| `docs/changelog/<fragment>.md`, `docs/status.md`, `docs/plan.md` (V1-9b row: "no migration" → B0 owns one), `docs/roadmap.md` | EDIT   | Status rides with the work.                                                                                                                                                                                                                                                                                                                                                                          |

**The prod read** (committed in B0's PR body and this plan's log; run by the maintainer against
`DATABASE_URL_UNPOOLED` in a `BEGIN READ ONLY` transaction, **aggregate counts only — never a
`client_id`, `public_id` or name**, the PRIV-3 rule that no identifier is committed):

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

Pass condition: `dup_client_ids = 0` in **every** row — a non-partial unique needs hidden/hidden pairs
gone too, not only hidden/live. `hidden_rows` is expected to be ≥ 2 on `entries` (the 1c losers);
recorded, not a failure. Re-run immediately before merge (1d's precedent, `runbooks.md:56`).

**Migration shape** (the `0012` precedent, `packages/db/migrations/0012_bodyweight_one_per_day.sql`):

```sql
SET lock_timeout = '5s';--> statement-breakpoint
SET statement_timeout = '60s';--> statement-breakpoint
-- One lock order, the writer's own (sessions → supersets → entries → entry_sets → quantities), taken
-- up front at the strongest level DROP INDEX needs, so no lock upgrade can deadlock mid-file.
LOCK TABLE "sessions", "supersets", "entries", "entry_sets", "entry_set_quantities"
  IN ACCESS EXCLUSIVE MODE;--> statement-breakpoint
DO $$ … count duplicate client_id (any deleted_at) per table; RAISE EXCEPTION naming the table and
        docs/runbooks.md → "If B0's migration refuses" if any > 0 … $$;--> statement-breakpoint
-- <justification: drizzle wraps each file in a transaction, so CONCURRENTLY is impossible; tables are
--  hundreds of rows; the lock above bounds the wait>
-- squawk-ignore require-concurrent-index-deletion
DROP INDEX "uq_entries_client_id";--> statement-breakpoint
CREATE UNIQUE INDEX "uq_entries_client_id" ON "entries" USING btree ("client_id");--> statement-breakpoint
… × 5
```

No `IF [NOT] EXISTS`: 0012's reasoning — it would silently skip a same-named index with the wrong
predicate. ⚠️ _Unverified:_ the exact Squawk rule name for a non-concurrent `DROP INDEX`
(`require-concurrent-index-deletion` is the expected one; `.squawk.toml` excludes only
`require-concurrent-index-creation`). Run `squawk` locally on the file before writing the ignores, and
put each `-- squawk-ignore` on the line **directly** above its statement (`docs/lessons.md`: any
comment in between voids it).

### B1-1 — `feat/v1-9b-1a-hide-restore-core` (`packages/` only)

| Path                                                                                 | Change                          | What & why                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------ | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/shared/src/retention.ts`                                                   | NEW (or EDIT if PRIV-3 made it) | `HIDDEN_RESTORE_DAYS` (Decision 7).                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `packages/shared/src/hide.ts`                                                        | NEW                             | `HIDE_BATCH_MAX`; `hideEntriesSchema`; `restoreHiddenSchema` (`hiddenAt`: a string matching Postgres' `timestamptz::text` form, never `z.date()`); `RESTORE_REASON` as const (`slot_taken`, `not_found`, `changed`) + zod enum + type; `CLEAR_DAY_CONFIRM_WORD = 'delete'` and `normalizeClearConfirm(s) = s.trim().toLowerCase()` (B2 consumes both — they live here once so UI and server match by construction).                                    |
| `packages/shared/src/index.ts`                                                       | EDIT                            | Export the above.                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `packages/db/src/writers/hide.ts`                                                    | NEW                             | `hideEntries(exec, { profilePublicId, scope, day, entryPublicIds })` → `{ hiddenAt } \| { notFound: true }`; `restoreHidden(exec, { profilePublicId, scope, day, hiddenAt, entryPublicIds, keepInsteadOf?, windowDays })` → per-item results. Shapes below.                                                                                                                                                                                            |
| `packages/db/src/queries/hidden-entries.ts`                                          | NEW                             | **The repo's first read that returns `deleted_at IS NOT NULL`**, named as such in its docblock (ADR 0008 decision 2): `hiddenEntriesForDay(db, { profilePublicId, scope, day, windowDays })` and `hiddenDaysInWindow(db, { profilePublicId, scope, day, windowDays })` (criterion 15). Both through `isLiveProfile` (`ownership.ts:118-124`); neither reads `scope.householdId` itself (`scope.test.ts` pins the module).                              |
| `packages/db/src/writers/strength-session.ts`                                        | EDIT                            | `writeSessionStrengthEntry` (`:183-205`): on a conflict with **no live row** but an owned **hidden** row under that `client_id`, return `{ hiddenSinceWrite: true }` instead of `reselectLiveByClientId`'s throw (`:52`), and `writeStrengthSession` skips that movement's sets. A replay must not resolve onto the hidden row (ADR 0008 decision 3.2) **and must not un-hide it** (decision 3.3); the session's replay answer is otherwise unchanged. |
| `packages/db/src/writers/bodyweight.ts`                                              | EDIT                            | `insertBodyweightEntry` (`:178-250`): a new branch between (a) and (b): this profile's **hidden** weigh-in holds the `client_id` → `{ hiddenSinceWrite: true }`, not (c)'s throw. Branch (b) keeps precedence when the day is held, so `verify.ts:3592-3606` (`{ dayTaken: true }`) stays green unchanged.                                                                                                                                             |
| `packages/db/src/index.ts`                                                           | EDIT                            | Export the writer and query.                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `packages/db/scripts/verify.ts`                                                      | EDIT                            | Section "V1-9b B1" — the proofs in the Test plan.                                                                                                                                                                                                                                                                                                                                                                                                      |
| `packages/db/scripts/mutations/08-restore-ignores-token.{patch,expect}` + README row | NEW                             | Drops the `deleted_at = token` conjunct from `restoreHidden`. Expect: "restoring one event leaves the other hidden" reddens.                                                                                                                                                                                                                                                                                                                           |
| `docs/features/write-path.md`                                                        | EDIT                            | `owns:` gains `packages/db/src/queries/hidden-entries.ts`; new invariant: **hide/restore never touch any column but `deleted_at` and `updated_at`, and no other writer ever writes `deleted_at`** (ADR 0008 decision 3.3); the token-as-text trap; the reader audit table.                                                                                                                                                                             |
| `docs/features/strength-logging.md`                                                  | EDIT                            | `strength-session.ts` is owned here: the `hiddenSinceWrite` replay branch.                                                                                                                                                                                                                                                                                                                                                                             |

**Writer shapes** (`hide.ts`):

```ts
// Owned-profile subselect: the SAME isLiveProfile predicate, never a re-typed copy.
const ownedProfile = exec.select({ id: profiles.id }).from(profiles)
  .where(isLiveProfile(profilePublicId, scope));

// hideEntries — one UPDATE, one now(), one event.
UPDATE entries SET deleted_at = now(), updated_at = now()
 WHERE public_id = ANY($ids) AND activity_date = $day
   AND profile_id IN (ownedProfile) AND deleted_at IS NULL
 RETURNING public_id, deleted_at::text
// then: owned+on-day rows among $ids (any liveness). If count < $ids.length → rollback, { notFound }.
// The returned token is the new event's; on a full replay (0 updated, all owned and hidden) the token
// of the already-hidden rows is returned (the identical-response rule).

// restoreHidden — per item, each in a SAVEPOINT (drizzle nested tx):
//   [keepInsteadOf] UPDATE entries SET deleted_at = now(), updated_at = now()
//                     WHERE public_id = $holder AND deleted_at IS NULL AND <same slot as the item>
//                   → 0 rows ⇒ { reason: 'changed' }
//   UPDATE entries SET deleted_at = NULL, updated_at = now()
//    WHERE public_id = $id AND profile_id IN (ownedProfile) AND activity_date = $day
//      AND deleted_at = $token::timestamptz
//      AND deleted_at > now() - make_interval(days => $windowDays)
//   23505 on BODYWEIGHT_DAY_UNIQUE_INDEX ⇒ roll back the savepoint, look up the live holder of that
//     (profile, day, coalesce(context,'morning')) slot ⇒ { reason: 'slot_taken', heldBy: { publicId, valueNum, unit } }
//   any OTHER 23505 ⇒ rethrow (unexpected — error.tsx; `uq_entries_superset_order` is unreachable from
//     the app, since no writer adds a member to an existing superset)
//   0 rows ⇒ classify: live ⇒ ok (replay); hidden under another token ⇒ 'changed'; else 'not_found'
```

Why a savepoint-and-catch rather than a `NOT EXISTS` pre-check: the unique index is the only arbiter
that cannot race; a pre-check still needs the catch for the concurrent case, so it would be two
mechanisms for one rule. The constraint name comes from the shared `BODYWEIGHT_DAY_UNIQUE_INDEX`
const the schema already uses (`schema.ts:270`), never a re-typed string.

**The reader audit** (the spec's Risks row: "every `WHERE deleted_at IS NULL` filter has only ever
been tested on PGlite fixtures"). Every reader of the three tables, found by grep on this branch, and
the B1-1 `db:verify` case that pins it:

| Reader                                                                      | Filter today                                                                                           | Case                                                                                                                                  |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `listEntriesForDay` (`apps/web/lib/dal/entries.ts:120-294`)                 | entries `:197`; sets **through live entry ids** `:203-218`; quantities through live set ids `:224-240` | app DAL cannot run under `db:verify` (`entries.ts:393-394`'s note) → B1-2's emitted-SQL test + B1-3's e2e                             |
| `strengthMonthRows` / `bodyweightMonthRows` / `loggedMonths`                | `export-month.ts:88, :94, :100, :143, :170`                                                            | hide → absent; restore → deep-equal (Decision 4)                                                                                      |
| `weeklyAdherence` (`packages/db/src/queries/weekly-adherence.ts:63`)        | entries                                                                                                | a hidden calisthenics bout leaves the week's sum (**Q7**)                                                                             |
| `ownedEntryIds` (`ownership.ts:135-141`) → both amends                      | entries                                                                                                | `updateStrengthSetById` on a hidden entry's set → `null`; `updateBodyweightEntryById` → `null`; `deleted_at` unchanged (decision 3.3) |
| `findAmendableBodyweight` / `amendableBodyweight` (`bodyweight.ts:110-140`) | entries                                                                                                | covered by the amend case                                                                                                             |
| `insertBodyweightEntry` replay + day lookups (`bodyweight.ts:224, :239`)    | entries                                                                                                | the `hiddenSinceWrite` and `dayTaken` cases                                                                                           |
| `movement-ownership.ts`                                                     | **deliberately none** (`:32-38`: a hidden entry still holds its FK)                                    | unchanged; asserted unchanged                                                                                                         |

**The entry→set live-parent proof** the row owes (`plan.md:115`: _"`verify.ts:2655-2682` covers only
set→quantity"_): hide an entry whose sets and quantities stay `deleted_at IS NULL`, then show every
reader above returns none of them. The trap is exactly the GAP-3 one one level up: `ON DELETE CASCADE`
is hard-delete only, so a hidden entry's children are "live" rows a careless join would count.

### B1-2 — `feat/v1-9b-1b-hide-restore-actions`

| Path                                             | Change | What & why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------ | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/lib/dal/entries.ts`                    | EDIT   | `hideEntriesForDay(...)`, `restoreHiddenOnDay(...)` (resolve `getHouseholdScope()`, call the writers, build labels); `listDayWithHidden(profilePublicId, day)` → `{ live: EntryDTO[]; hidden: HiddenOnDayDTO }`, computing each hidden item's **placement** (`afterEntryId`: the live entry preceding it in the `(created_at, id)` order `:251` uses) **inside the DAL**, so no timestamp but the token leaves it. `listEntriesForDay` is unchanged. Fix the now-false comment at `:441`. |
| `apps/web/lib/dal/hidden-dto.ts`                 | NEW    | `HiddenOnDayDTO` (the contract's, plus `afterEntryId`, `section` keys, `sessionId`) and `RestoreResultDTO`; `restorableUntil` computed once here: `localDayIso(tz, hiddenAt + N days)` (`apps/web/lib/date.ts:49`).                                                                                                                                                                                                                                                                       |
| `apps/web/lib/entries/entry-label.ts`            | EDIT   | `entryLabel` takes `Pick<EntryDTO, …>` of the fields it reads, so a hidden item is labelled by the **same** function as a live one (no second label map).                                                                                                                                                                                                                                                                                                                                 |
| `apps/web/app/p/[profileId]/actions.ts`          | EDIT   | `hideEntriesAction`, `restoreHiddenAction` — shape below. (WP-1, [`wp-1-shard-actions.md`](./wp-1-shard-actions.md), keeps one `actions.ts` and makes `MUTATING_ACTIONS` + `ACTION_BINDINGS` + `VALID_BODY` the append points; both actions are `scope: 'profile'` if WP-1 has landed. B1-2, A1 and V1-24 2 serialize on these files.)                                                                                                                                                    |
| `apps/web/app/p/[profileId]/action-state.ts`     | EDIT   | `RestoreActionState = ActionState & { restore?: RestoreResultDTO[] }`.                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `apps/web/app/p/[profileId]/mutating-actions.ts` | EDIT   | Two keys, both `NO_PROFILE_LOG` (`{ refusal: NO_PROFILE_LOG, scope: 'profile' }` after WP-1), plus their `ACTION_BINDINGS` / `VALID_BODY` entries — the unauth / wrong-household suites in `actions.test.ts` (which compares these keys to the exported actions) then cover them with no re-typed list (`:24-32`).                                                                                                                                                                        |
| `apps/web/lib/constants.ts`                      | EDIT   | `HIDE_COPY` (all strings below — one home); `entryRowId(publicId)` for focus targets.                                                                                                                                                                                                                                                                                                                                                                                                     |
| `apps/web/app/p/[profileId]/actions.test.ts`     | EDIT   | Boundary + happy + replay cases (Test plan).                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `apps/web/lib/dal/entries.test.ts`               | EDIT   | Emitted-SQL proof that `listDayWithHidden`'s live half is byte-identical to `listEntriesForDay`'s and its hidden half carries the window conjunct.                                                                                                                                                                                                                                                                                                                                        |
| `docs/features/write-path.md`                    | EDIT   | The two actions; the "first deleted-row read" note.                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `docs/privacy/data-inventory.md`                 | EDIT   | §1 (`:112-113`) and §5 (`:246-248`): `deleted_at` is now **written by the app**, by two actions, and restored by one; "written in exactly one place (a committed data correction)" stops being true.                                                                                                                                                                                                                                                                                      |

**Action shape** (after AUTH-1 1c — `auth-1-clerk-google.md:657-663`):

```ts
export async function hideEntriesAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return await Sentry.withServerActionInstrumentation('hideEntriesAction', async () => {
    const user = await sessionUserOrNull();
    if (!user) return { ok: false, error: NO_PROFILE_LOG };
    const limit = await checkMutationLimit(user.userId);           // 1c's limiter
    if (!limit.ok) return { ok: false, error: <1c's rate-limit copy> };
    const parsed = hideEntriesSchema.safeParse({ profileId, day, entryIds: formData.getAll('entryId') });
    if (!parsed.success) return { ok: false, error: 'Please fix the errors below.', fieldErrors: … };
    const profile = await getProfileByPublicId(parsed.data.profileId);
    if (!profile) return { ok: false, error: NO_PROFILE_LOG };
    const r = await hideEntriesForDay({ profilePublicId: profile.id, day, entryPublicIds });
    revalidatePath(`/p/${profile.id}`);                             // also on notFound: show what's saved
    return 'notFound' in r ? { ok: false, error: AMEND_ERROR_COPY.notFound('entry') } : { ok: true, error: null };
  });
}
```

**No `resolveDeclaredDay` bound.** Hide and restore correct a record; they never create one on a day.
The amends make the same call for the same reason (`actions.ts:504-509`, plan Decision 5): a ±1 bound
would render a dead control on exactly the history days a mistake is found on. Restore's only time
bound is `N`.

**Sentry:** no `headers`, no `formData`, and — from 1c — no user or household id (AUTH-1 plan § Design
3, "no Clerk user id and no household id reaches Sentry at all in Beta 0").

### B1-3 — `feat/v1-9b-1c-hide-restore-ui`

| Path                                                                                                           | Change | What & why                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/web/app/p/[profileId]/page.tsx`                                                                          | EDIT   | Call `listDayWithHidden` in the existing `Promise.all` (`:85-89`) instead of `listEntriesForDay`, plus `hiddenDaysInWindow`. Wrap the day's content in `<HiddenVisitProvider key={`${profile.id}                                                                                                                                                                                                                                                                               | ${day}`}>` (FE-6). Render `<HiddenBar>` under the header, above the sections (criterion 10), and the "Also hidden" line in the header under `DayNav`. Pass each section its live rows **and** its hidden items. |
| `apps/web/app/p/[profileId]/hidden-visit.tsx`                                                                  | NEW    | `'use client'`. The day-scoped island: a `Set<entryPublicId>` of **this visit's** hides, `announce(msg)`, a pending focus target. Owns the **one** `role="status"` region, mounted with the provider, before any text (the `saved-announcer.tsx:1-42` idiom). Remounts on a day change (keyed) and empties on a reload, which is what moves this visit's hides into the bar next load.                                                                                         |
| `apps/web/app/p/[profileId]/delete-entry-control.tsx`                                                          | NEW    | `'use client'`. `<form action={hideEntriesAction}>` with hidden `profileId`, `day`, `entryId`×n; a `Button variant="ghost" size="sm"` "Delete", `aria-label={HIDE_COPY.deleteLabel(label, count)}` ("Delete Push-Ups, 3 sets"). On success: add ids to the visit set, announce, set focus target to the tomb's Undo (criterion 11).                                                                                                                                            |
| `apps/web/app/p/[profileId]/hidden-slot.tsx`                                                                   | NEW    | `'use client'`. Renders a hidden item **only if** its id is in the visit set: the tomb `<li>`, `"{label} deleted"` + Undo (a restore form for that item's event). Otherwise renders `null` — the item is in the bar instead. This is how a tomb sits in the row's exact position without the server knowing which hides are "this visit".                                                                                                                                      |
| `apps/web/app/p/[profileId]/hidden-bar.tsx`                                                                    | NEW    | `'use client'` (it filters by the visit set). `<section aria-labelledby>` + `<h2>` "Hidden on this day (n)"; one event shows its item directly, more than one sits in a `<details>`; each item: label, "Hidden {time} · restorable until {date}", Restore / "Restore all". The `slot_taken` refusal renders **beside the item**, `id`-referenced by the Restore button's `aria-describedby` (U20), with "Keep {value} instead" and "Leave it" (the default — nothing happens). |
| `apps/web/app/p/[profileId]/bodyweight-receipt.tsx` / `bodyweight-section.tsx`                                 | EDIT   | Delete beside Change in the existing `control` slot; Change and Delete grouped in one `flex gap-2` so they wrap **together**. A hidden weigh-in's tomb in the receipt's place.                                                                                                                                                                                                                                                                                                 |
| `apps/web/app/p/[profileId]/movement-line.tsx`                                                                 | EDIT   | An optional `control` slot on the name line (`:60-68`): `flex items-start gap-2`, the label `min-w-0 flex-1 [overflow-wrap:anywhere]`, the control `shrink-0`. Server component stays server; the slot is the island.                                                                                                                                                                                                                                                          |
| `apps/web/app/p/[profileId]/strength-session-receipt.tsx`                                                      | EDIT   | Pass `DeleteEntryControl` into each movement's slot **only when `editable`** (criterion 13); render `HiddenSlot`s for that session's hidden members at their placement.                                                                                                                                                                                                                                                                                                        |
| `apps/web/lib/entries/activity-totals.ts`                                                                      | EDIT   | `MetricTotal` gains `entryIds: string[]` so a folded calisthenics row can hide its bouts (Q9); `values` order unchanged.                                                                                                                                                                                                                                                                                                                                                       |
| Pre-3b only: the Logged-entries `<li>`s (`page.tsx:303-345`)                                                   | EDIT   | Delete on the `{kind:'entry'}` and `{kind:'calisthenics'}` rows; none on the list's session copy while the section owns Change. See [Both orders](#both-orders-against-v1-24-3b).                                                                                                                                                                                                                                                                                              |
| `apps/web/lib/constants.ts`                                                                                    | EDIT   | `HIDE_COPY` completed (strings below).                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `docs/privacy/notice.md` + `apps/web/lib/privacy/notice-content.ts` (via `pnpm --filter web privacy:generate`) | EDIT   | The sentence ADR 0008 owes (below); the drift test (`notice-content.test.ts`) keeps the two in step. A new assertion there pins the notice's day count to `HIDDEN_RESTORE_DAYS` (the one literal on the assertion side).                                                                                                                                                                                                                                                       |
| `docs/privacy/data-inventory.md`                                                                               | EDIT   | §4: a new row — **the Hidden bar shows a hidden item's label, including a hidden weigh-in's value, to anyone who can open the athlete, until `N`**; §6 (`:292-295`): hidden rows are absent from the zip **and recoverable by Restore for `N` days or in the on-request full copy**; §8 (`:365`): "until the whole household is deleted. Nothing purges it" → restorable for `N`, then purged by PRIV-3's job (or, until it ships, invisible and unrestorable but still held). |
| `apps/web/e2e/delete-restore.spec.ts`                                                                          | NEW    | Test plan.                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `apps/web/e2e/a11y.spec.ts`                                                                                    | EDIT   | Add the day with a populated Hidden bar and with a refusal shown (unowned 8).                                                                                                                                                                                                                                                                                                                                                                                                  |
| `docs/features/strength-logging.md`                                                                            | EDIT   | `movement-line.tsx`, `strength-session-receipt.tsx`: the slot, the single-copy rule.                                                                                                                                                                                                                                                                                                                                                                                           |
| `docs/runbooks.md`                                                                                             | EDIT   | The on-request full copy includes hidden rows until purged (`runbooks.md:806-810` names the full copy).                                                                                                                                                                                                                                                                                                                                                                        |

**The notice sentence** (`notice.md:136-152`, rewritten from "is being built" to "was built"; `{N}` is
`HIDDEN_RESTORE_DAYS`):

> **Deleting something in the app hides it, then removes it.** Delete is on each logged item. The item
> disappears for everyone in your household and shows up under "Hidden on this day", where anyone who
> can open that athlete can put it back for **{N} days**. After that it can no longer be restored
> [and is permanently removed from the database — **or, until the clean-up job ships: and it stays in
> the database, out of sight, until the clean-up that removes it is finished**].

The bracketed clause is chosen at B1-3's merge by whether PRIV-3's purge job is live, so the notice is
never ahead of the code. The "How long we keep it" row (`:126`) changes the same way. "**There is
still no way to permanently remove one single item on demand**" (`:154-155`) stays, true.

**Copy** (`HIDE_COPY`, `apps/web/lib/constants.ts` — the prototype's words, Q10):

| Key                      | Text                                                                                   |
| ------------------------ | -------------------------------------------------------------------------------------- |
| `delete`                 | `Delete`                                                                               |
| `deleteLabel`            | `Delete {label}` / `Delete {label}, {n} sets` (folded)                                 |
| `deleted`                | `{label} deleted`                                                                      |
| `undo` / `undoLabel`     | `Undo` / `Undo delete of {label}` (A11Y-5)                                             |
| `hiddenHeading`          | `Hidden on this day ({n})`                                                             |
| `hiddenDetail`           | `Hidden {time} · restorable until {date}`                                              |
| `restore` / `restoreAll` | `Restore` / `Restore all`                                                              |
| `slotTaken`              | `{wanted} can't come back while {held} is logged for this day — one weigh-in per day.` |
| `keepInstead`            | `Keep {wanted} instead`                                                                |
| `leaveIt`                | `Leave it`                                                                             |
| `restoredPartly`         | `Restored {k} of {n}.`                                                                 |
| `alsoHidden`             | `Also hidden, still restorable: `                                                      |
| `announceHidden`         | `{label} deleted. Undo is in its place.`                                               |
| `announceRestored`       | `Restored {label}.` / `Restored {n} entries.`                                          |

### B2 — `feat/v1-9b-2-clear-day`

| Path                                                                                                             | Change | What & why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared/src/hide.ts`                                                                                    | EDIT   | `clearDaySchema = hideEntriesSchema.extend({ confirm: z.string().transform(normalizeClearConfirm).pipe(z.literal(CLEAR_DAY_CONFIRM_WORD)) })` — the contract's rule, built from B1-1's one constant and one normalizer.                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `apps/web/app/p/[profileId]/actions.ts`                                                                          | EDIT   | `clearDayAction` — the same body as `hideEntriesAction` after its own schema. **No new writer:** it calls `hideEntries` with the day's rendered entry ids, so a clear is one `UPDATE`, one `now()`, one event (Decision 2), and restores through the Hidden bar exactly as a single hide does.                                                                                                                                                                                                                                                                                                                                                           |
| `apps/web/app/p/[profileId]/mutating-actions.ts`                                                                 | EDIT   | `clearDayAction: NO_PROFILE_LOG`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `apps/web/app/p/[profileId]/clear-day.tsx`                                                                       | NEW    | `'use client'`. "Clear this day…" (a text button, `min-h-11`, below the sections when the day has live entries), opening a small modal: U0's primitive if merged, else a native `<dialog>` with `showModal()` (focus trap and inert background for free). Focus on the title (U21), `aria-describedby` on the consequence; the input `autocapitalize="off" autocorrect="off" spellcheck={false}`; the button disabled until `normalizeClearConfirm(value) === CLEAR_DAY_CONFIRM_WORD`, with the hint "The button turns on when it matches." Its own `role="status"` **inside** the dialog (criterion 46). Escape and Cancel return focus to the trigger. |
| `apps/web/lib/constants.ts`                                                                                      | EDIT   | `CLEAR_DAY_COPY`: trigger, `Clear {day}?`, `This hides all {n} items logged for {name} on this day, for everyone in your household. You can put them all back from Hidden on this day until {date}.`, `Type delete to confirm`, `Clear day`, `Cancel`.                                                                                                                                                                                                                                                                                                                                                                                                   |
| `apps/web/app/p/[profileId]/hidden-bar.tsx`                                                                      | EDIT   | "Restore all" for a multi-item event; a partial restore lists each item that stayed hidden with its reason (criterion 14), the `slot_taken` one with its swap.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `apps/web/app/p/[profileId]/actions.test.ts`, `apps/web/e2e/delete-restore.spec.ts`, `apps/web/e2e/a11y.spec.ts` | EDIT   | Test plan. The a11y scan opens the dialog.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

**"Every live entry" vs "what was shown"** (criterion 14). The action hides the ids the page
**rendered** (the count `n` the dialog states — IXD-12's "the count matches what you see"), not a
fresh `SELECT` of the day. In the ordinary case these are identical. When another device logged
something between render and confirm, the person confirmed `n` items and `n` are hidden; the new one
stays visible, which is what they saw and agreed to. Flagged as Contradiction 5 because the criterion
says "every live entry".

## 360px width math

The main column is `px-4` (`page.tsx:128`): 360 − 32 = **328px**. A bordered `px-4` card subtracts
32 + 2 = **294px** of content (the spec's measured figure, disagreement 6; `bodyweight-receipt.tsx:84`
says the same). Buttons: `size="sm"` is `px-2.5` + `text-[0.8rem]` (`components/ui/button.tsx:39`), so
"Delete" / "Change" ≈ 6 × ~7px + 20 + 2 ≈ **64px**, and the base `min-h-11` gives the 44px height
(`button.tsx:20`). Width ≥ 44px holds for every label here. These are estimates from the classes;
**B1-3 measures them on the real page in Playwright at 360px and puts the numbers in the PR**, as
disagreement 6 requires.

| Row                             | Arithmetic                                                                                       | Result                                                                                                                             |
| ------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Bodyweight receipt              | "Saved: 1000.5 lb" (16 chars, 16px medium ≈ 136) + 8 + Change 64 + 8 + Delete 64 = **280** ≤ 294 | fits; the action group wraps **as a unit** if a longer locale/value ever exceeds it                                                |
| Strength movement name line     | 294 − Delete 64 − gap 8 = **222** for the label                                                  | "Overhead Shoulder Press" (~190) fits on one line                                                                                  |
| …inside a superset bracket      | `border-l-2 pl-3` (`strength-session-receipt.tsx:127`) → 294 − 14 = 280; − 72 = **208**          | fits; with a status badge (~55 + 8) → **145**: the label wraps to two lines (`min-w-0`, `overflow-wrap:anywhere`), never overflows |
| Tomb `"{label} deleted"` + Undo | 294 − Undo (ghost, `min-w-11`, ~48) − 8 = **238**                                                | "Overhead Shoulder Press deleted" (~31 chars at 14px ≈ 225) fits; longer wraps                                                     |
| Hidden bar item                 | bar = 328 − 2 border − 20 padding = 306; − "Restore all" (~84) − 8 = **214** for label + detail  | detail wraps to two lines (≈280px at 14px); the button stays right                                                                 |
| Refusal swap row                | "Keep 112.4 lb instead" (~150) + 8 + "Leave it" (~70) = **228** ≤ 306                            | fits on one line                                                                                                                   |
| "Also hidden" links             | inline links, each `min-h-11` (U27 / the prototype's `display:inline-flex;min-height:44px`)      | wraps; each link stays a 44px target                                                                                               |

## Test plan

**B0 — `db:verify` (PGlite, local and CI):**

1. For each of the five indexes: `pg_indexes.indexdef` contains no `WHERE` (structural — catches a
   future re-partial).
2. Criterion 9 through the **shipped** writers: log a strength session; soft-delete one movement entry
   by fixture; replay the same graph (`writeStrengthSession`, same `client_id`s) → still **one** row
   per `client_id` in every table. Same for a check-in (`logCheckinEntries`-equivalent statement →
   `created: false`) and a weigh-in on a day nobody holds (in B0 this **throws** — branch (c); B1-1
   turns it into `{ hiddenSinceWrite }` and updates the assertion — the plan says so in both PRs so the
   change of assertion is deliberate, not drift).
3. `verify.ts:3592-3606` (`dayTaken` for a hidden submit's replay on a held day) stays green unmodified.
4. Mutation 07 is red.

Run: `pnpm verify` (includes `db:verify` and `db:mutations`). CI: the `quality` job + forward-only +
Squawk on the new file.

**B1-1 — `db:verify`:**

1. **Live parent:** the reader-audit table, one case per row.
2. **Event identity:** three ids hidden in one call → one token; two separate calls → two tokens;
   restoring one leaves the other hidden; the token is the `::text` form and survives a round trip
   (assert a non-zero microsecond part, then restore by it).
3. **`slot_taken`** (criterion 12's fixture): hide weigh-in A; log B on that day via
   `insertBodyweightEntry`; restore A → `{ reason: 'slot_taken', heldBy: B }`, A still hidden, B
   untouched, **no `23505` escapes**. Swap with `keepInsteadOf: B` → A live, B hidden with a new token.
   Swap replay → `ok`, no change. Swap naming a holder that is no longer the holder → `changed`.
4. **Window:** a row hidden `N + 1` days ago (fixture `deleted_at`) is absent from
   `hiddenEntriesForDay` and restores as `not_found`; one hidden `N − 1` days ago is present.
5. **Replay outcomes:** hide replay → same token, no extra write (`updated_at` unchanged on the
   second call); restore replay → `ok`; restore after re-hide under another token → `changed`.
6. **Replay of a hidden create:** `insertBodyweightEntry` with a hidden row's `client_id` on a free day
   → `{ hiddenSinceWrite: true }` and the row stays hidden (decision 3.3); `writeStrengthSession`
   replay with one hidden movement → the movement stays hidden, the others are untouched.
7. **TEN-1 matrix, both directions:** household B's scope cannot hide, restore or read A's hidden rows
   (writers and both queries return zero / `notFound`).
8. **Export (criterion 16):** capture `strengthMonthRows` + `bodyweightMonthRows` for a month, hide
   every entry in it, assert `loggedMonths` drops the month, restore the event, assert deep-equal to the
   capture.
9. **Q7:** `weeklyAdherence` sum drops by the hidden bout's value and returns after restore.
10. Mutation 08 is red.

**B1-2 — Vitest (`actions.test.ts`, mocked DAL per the repo's pattern):**

- Through `MUTATING_ACTIONS`: **unauth → reject** and **wrong household → `NO_PROFILE_LOG`** for both
  actions, automatically.
- **Bad body → zod-reject**, no DAL call: empty `entryId`s, more than `HIDE_BATCH_MAX`, a non-UUID, a
  malformed day, a `hiddenAt` that is not a timestamp string.
- **Wrong owner / stale id** → `AMEND_ERROR_COPY.notFound('entry')`, byte-identical for foreign and
  stale (the ADR 0006 property).
- **Replay → one effect + identical response** for each action.
- `restore` result mapping: `slot_taken` → `restore: [{ reason, heldBy: { entryPublicId, label } }]`
  with the label from `entryLabel`.
- `entries.test.ts`: the emitted-SQL proof above.

**B1-3 — Playwright (`pnpm e2e:local`), plus Vitest for the islands:**

- Delete a weigh-in → the tomb is where the receipt was, focus is on its Undo, the status region
  announced; the weigh-in form is back. Undo → the receipt returns and has focus.
- Delete, then reload → the tomb is gone and the item is in "Hidden on this day (1)" with "restorable
  until {date}". Navigate to the previous day and back → still in the bar (criterion 10's reload +
  day-change).
- Second Delete on the row **below** a first Delete lands where the finger was: assert the bounding box
  of every element **above** the tapped row is unchanged after the hide (IXD-2, the test the panel's
  finding implies).
- `day-slot`: hide, log a new weight, reload, Restore → the refusal names both values; "Leave it"
  changes nothing; "Keep {value} instead" swaps, and the newer one is now in the bar.
- Folded calisthenics row: Delete says "3 sets", hides all three as one bar item; "Restore all".
- Criterion 13: with the strength section on the page, exactly one `Delete {movement}` button exists.
- `hidden-visit.test.tsx` (Vitest): a hide adds to the set; a remount with a new key empties it; the
  status region exists before the first message (the `saved-announcer.test.tsx` idiom).
- Screenshots via `ui-screenshot` at 390/820/1280: the day with a tomb, with the bar, with a refusal.
- **Real-phone checks** (spec → "For the implementation plans"; a browser cannot answer): on iOS
  VoiceOver and Android TalkBack, that the hide announcement and the focus move to Undo both survive
  when they happen together, and that Undo is reachable by swipe in reading order. Results in the PR.

**B2:** zod: `" Delete "` passes, `"delet"` and `"DELETE!"` fail, missing confirm fails; the button
stays disabled until the match (Vitest on the island); Playwright: clear a six-item day → one bar
event "Restore all" → all six back; with a re-logged weigh-in, "Restored 5 of 6" + the refusal;
`db:verify`: one `deleted_at` across all rows of one clear.

## Risks / rollback

| Risk                                                                                              | Mitigation                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **B0 deploy racing the migrator** breaks every insert                                             | B0 changes **no** app code; the writers' `where:` stays, so they infer either index shape (Decision 1). B1-1 merges only after B0's `migrate.yml` run is green **on B0's merge SHA**.                                                                                                |
| B0's migration finds a duplicate in prod and aborts                                               | The atomic `DO` block raises a named message before any DDL; the app keeps logging (it depends on neither shape). Runbook entry; a correction keeps one row of the pair.                                                                                                             |
| `ACCESS EXCLUSIVE` on five tables blocks logging during the migration                             | Hundreds of rows; `lock_timeout 5s`, `statement_timeout 60s`; migrate on merge, not at practice time (logging happens after 18:30 local, per the household's schedule).                                                                                                              |
| **The token loses microseconds** and every restore is `not_found`                                 | Text end to end (Decision 2); `db:verify` case 2 asserts a non-zero microsecond part round-trips.                                                                                                                                                                                    |
| A reader somewhere counts a hidden entry's live children                                          | The reader audit, one `db:verify` case per reader; the entry→set proof.                                                                                                                                                                                                              |
| Restore resurrects a row the purge is about to delete, or after it                                | The window is enforced in the read **and** the writer (Decision 7); restore window = purge window by one constant.                                                                                                                                                                   |
| **A restored single-per-day check-in or life entry duplicates one logged since** (wake, practice) | There is no DB key for those, so there is nothing for `slot_taken` to arbitrate on, and the restore succeeds. Stated, not fixed: the check-ins CSV is header-only (`data-inventory.md` §6), so no export byte changes; a natural key for them is V1-24 2's question, not this row's. |
| A child hides a sibling's weigh-in                                                                | Accepted by ADR 0008 decision 4; the Hidden bar on the **athlete's** page is the recovery, visible to a parent. The notice says so (`notice.md:149-153`, kept).                                                                                                                      |
| **A hidden weigh-in's value stays visible in the Hidden bar** to anyone who can open the athlete  | The same audience that saw the live value; needed to choose "Keep {value} instead". Stated in the inventory §4 and for the privacy lens, not hidden.                                                                                                                                 |
| B1-2's actions are reachable by a crafted POST before B1-3's notice lands                         | Merge B1-2 and B1-3 back to back; B1-2 already updates the inventory so it is never false. The notice's "no Delete button yet" stays literally true until B1-3.                                                                                                                      |
| LWW later: a hide from another device with a later clock beats a Restore that reported success    | ADR 0008 decision 2/3.5: the sync PR's to reconcile; no LWW exists today (`schema.ts:37` "v1.5"). Today a hide beats an edit unconditionally (the amends filter `deleted_at IS NULL`).                                                                                               |
| **The LLM never authors loads**                                                                   | Untouched: hide/restore/swap move no value and write no column but `deleted_at`/`updated_at`.                                                                                                                                                                                        |
| **CSV byte-faithfulness**                                                                         | No export query changes. A hide changes that month's export **by design** (that is what Delete means; ADR 0008); a restore returns it byte-identical (case 8).                                                                                                                       |

**Rollback.** B0: fix-forward with a migration that restores the partial predicate (same shape,
inverse), safe because no code depends on the non-partial form until B1-1 — after B1-1, a re-partial
re-arms criterion 9's hazard, so roll back B1 first. B1-1/B1-2: plain reverts; rows already hidden stay
hidden and are restorable by a correction (`UPDATE … SET deleted_at = NULL` with a `slot_taken` check,
the runbook's own idiom at `runbooks.md:59-62`). B1-3/B2: plain reverts; the notice reverts with them
(B1-3) so it is never ahead of the code.

## Out-of-scope / deferred

- **The purge job** — PRIV-3. This plan needs only `N`.
- **Set grain** — `entry_sets.deleted_at` exists and stays unbuilt (ADR 0008).
- **Hiding a session or superset row.** Entry grain only; a session whose every movement is hidden
  simply renders nothing (the day read starts from entries). Its `feel` note is not exported
  (`data-inventory.md` §6) and stays until the household is erased — said in the inventory.
- **Clearing `day_readiness`** with a day — a different table and not an entry; "Clear this day"
  hides entries. The dialog's count says "items logged", which readiness is not.
- **FE-15's client event ids** and the outbox — the v1.5 sync PR (Decision 6).
- **Dropping the now-redundant `where:` clauses** from the arbiters — a later cleanup.
- **A per-day marker on the weekly adherence strip** (Q7's second half): the strip is **per metric**,
  not per day (`weekly-adherence.tsx`), and renders nothing until the ramp schedule is seeded
  (`page.tsx:82-84`). The day signal is the "Also hidden" line; a strip marker is the strip's own
  follow-up once it renders.
- **Deleting an athlete** (A3), **archive** (A2), **movements** (exempt by ADR 0008).
- **Removing the Logged-entries list** — V1-24 3b's.

## Open questions

1. **`N`** (PRIV-3). Blocks B1-1. The prototype's 30 days is a labelled placeholder
   (`index.html:1270`).
2. **ADR 0008 decision 4 at AUTH-1** — confirm "deletion authority = logging authority = any household
   member" (Decision 9), or name a narrower rule before B1-2.
3. **Contract amendments** for the spec's owner to accept or refuse: `restoreHiddenSchema` gains
   `entryPublicIds` and optional `keepInsteadOf`; `RestoreResult` gains `'changed'`; `hideEntrySchema` +
   `hideGroupSchema` merge into `hideEntriesSchema` (Decisions 3, 5, 8).
4. **Criterion 15's span** — "the current week" (criterion text) vs "the whole restore window" (the
   approved prototype). This plan builds the prototype's; one word in the criterion should change.
5. **Criterion 14** — hide what was shown (this plan) vs a fresh select of "every live entry".

## Contradictions with the spec and the rows

1. **The spec treats V1-24 1d and 1e as future work** — chunk table row E, the critical path
   (_"Beside it: `V1-24 1d → 1e` (1e before B1)"_) and "Can start before AUTH-1 1c" (_"V1-24 1d (a
   migration…) — serial with B0 and AUTH-1 1b by migration number"_). Both shipped (`9336554` #210 with
   `0012`; `b625a23` #214), as did 3a (#211, #212). Track E's remainder is **2 and 3b**, and the "1e
   before B1" gate is met.
2. **"Nothing in shipped code writes `deleted_at`"** is true of the app; **prod holds hidden rows**
   from the V1-24 1c correction (`registry.ts:214-217`), so B0's read can fail and is worth running.
3. **Criterion 15 says "other days of the current week"** (and IXD-13 fixed it to "the last 7 days");
   the approved prototype covers the **whole restore window** (`index.html:1825`, the `weekHidden` loop
   to `PURGE_DAYS`, `:2501-2512`). Open question 4.
4. **The data contract cannot express FE-7** (`restoreHiddenSchema` has no item ids; `RestoreResult`
   has no "changed"), has **no swap** for criterion 12's "keep this one instead", and its proposed
   `hiddenAt` identity breaks if the token ever becomes a JS `Date`. Open question 3; Decision 2.
5. **Criterion 14's "every live entry"** vs IXD-12's "the count matches what you see". Open question 5.
6. **Q7's marker** asks the strip to "mark the day"; the strip has no days. Out of scope, with reason.
7. **`data-inventory.md` §5** lists `client_id` among the keys a hide frees; B0 makes that false, so B0
   edits it.
8. **The V1-9b row** says "no migration" and "`logCheckIns`"; ADR 0008 and B0 supersede the first, and
   the function is `logCheckinEntries` (the spec's disagreements 2 and 3, confirmed).

## Review-response log (adversarial panel)

_Pending: engineering panel + UX panel (round 1)._
