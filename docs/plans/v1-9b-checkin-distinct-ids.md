# V1-9b follow-up: a check-in submit refuses a repeated id, and the race retry has a proof for a third phone

**Backlog:** [V1-9b](../plan.md), follow-ups to B1-2 (#547) and the day-taken race retry (#578). Lane S,
mutations 422–424.

_Roadmap alignment (2026-11-19): advances `V1-9b` (follow-ups to B1-2 and #578); gates nothing; B2
still waits on FAM-1's page queue. Checked against the private roadmap; nothing to add here._

## Goal

Three small fixes on the check-in writer's path:

1. **A check-in submit whose items share one `client_id` is refused, and an id is compared in one
   spelling.** Two items under one id insert one row, and both answer `created` (`createdByClientId`
   is keyed by id, `writers/checkin.ts:161`). And because the classifier's maps compare JS strings
   while Postgres compares `uuid`s, an id sent in upper case is written and then misreported: a habit
   goes `null` twice and throws to `error.tsx`, and a practice is answered `day_taken` against the
   row it just wrote. Neither is reachable from the app's own forms (`checkin-form.tsx:58-59` mints
   one lower-case `newId()` per field; the life action sends one item), so both are crafted POSTs.
   The Check-ins form is no longer on the day page (#418) and `logCheckinsAction` goes at FAM-1 12f;
   the writer's precondition outlives it. The maintainer's ruling, via the board: _"Fix it, don't
   log it."_
2. **The race retry gets a proof for a retry that lands on a held day.** Neither proof in
   `verifyDayTakenRace` fails a writer that answers `created` (or `{ id }`) when the retry's insert
   is skipped because a third phone logged in between. Today's retry re-runs the same attempt, so it
   passes trivially; this is a guard against a future change to the retry, not a fix to today's code
   (board, 2026-11-19: keep both halves).
3. **`hiddenAtSchema`'s comment gives the right reason** for refusing hour 24 and second 60.

Split out (board, 2026-11-19): `listEntriesForDay`'s session and superset ownership conjuncts go in
their own PR, whose merge waits on the maintainer's production census.

## Acceptance

- `logCheckinsAction` parses each `client_id` with `lowerCaseUuidSchema`. A submit where two fields
  carry the same id, in any letter case, writes nothing and answers
  `{ ok: false, error: 'Please fix the errors below.', fieldErrors }`, every sharing field marked
  with `CHECKIN_COPY.itemNotSubmitted` (the existing "Could not submit this item. Reload and try
  again.", now named in `apps/web/lib/constants.ts`).
- `writeCheckinEntries` folds each `client_id` to lower case on entry, and throws before any
  statement when the folded ids repeat. Its answers carry the folded id.
- A colocated vitest proves the throw issues no statement. `db:verify` proves an upper-case habit and
  an upper-case practice each answer `created` with one row, and that a practice (and a weigh-in)
  whose retry lands on a day a third phone just took answers `day_taken` (`{ dayTaken: true }`).
  Mutations 422–424 each turn `db:verify` red.
- `hide.ts`'s docblock is the one statement of why the five tokens are refused, worded as
  `program-contract.md` invariant 29; `hide.test.ts` splits its cases into "fails the cast" and "a
  second spelling of an instant".

## File-by-file changes

1. **EDIT `apps/web/lib/constants.ts`**: `CHECKIN_COPY = { itemNotSubmitted: '…' }` beside
   `PRACTICE_COPY`. (`actions.ts` is `'use server'`, so the copy cannot be a local export.)
2. **EDIT `apps/web/app/p/[profileId]/actions.ts`** (`logCheckinsAction`, ~line 211): parse with
   `lowerCaseUuidSchema`; use `CHECKIN_COPY.itemNotSubmitted` at the existing site; if
   `fieldKeyByClientId` already has the id, mark the earlier field and this one and `continue`. The
   existing `fieldErrors` return then refuses before the profile resolve.
3. **EDIT `packages/db/src/writers/checkin.ts`** (`writeCheckinEntries`): first,
   `const values = args.values.map((v) => ({ ...v, clientId: v.clientId.toLowerCase() }))`; then
   `if (new Set(values.map((v) => v.clientId)).size !== values.length) throw new Error('check-in client_ids repeat within one submit')`;
   the rest runs on `values`. Docblock: every caller sends distinct ids; a batch caller (the unwired
   `/api/sync`) collapses identical replays first; the message is for `db:verify` and tests, since
   `quietDbErrors` keeps only the class.
4. **NEW `packages/db/src/writers/checkin.test.ts`**: an executor `Proxy` that throws on any property
   access; `writeCheckinEntries` with two items sharing an id (one upper-cased) rejects with the
   message, and the proxy was never touched.
5. **EDIT `packages/db/scripts/verify/single-values.ts`**:
   - in `verifyPracticeOnePerDay`, beside the existing throw case (~line 671), on a free day: an
     upper-case habit answers `created` and an upper-case practice answers `created`, each one row.
   - hoist the race staging out of `verifyDayTakenRace` into module-scope helpers (`raceFixture(tx)`:
     type ids, `liveOnDay`, the value builders; `stageHide(tx)`: the temp table, function and AFTER
     trigger, returning `holdThenClear`), used by both sections.
   - **NEW `verifyRetryLandsOnTakenDay()`**, its own `rolledBack` section after `verifyDayTakenRace`,
     reusing the `RACE_*` ids. Staging per half: log C and hide it; log A; then arm. A second table
     `race_unhide(public_id)` and a `BEFORE INSERT … FOR EACH STATEMENT` trigger that un-hides the
     named row **only once the hide target is no longer live** (state, not a count, so it cannot
     mis-arm), plus a statement counter. Statement 1 skips on A, AFTER hides A, the reads find
     nothing; statement 2's BEFORE un-hides C, the insert skips on C, the read finds the day taken.
     Assert: the answer is `day_taken` / `{ dayTaken: true }`, the counter is 2 (the retry ran), and
     the day's live row is C. Clear both tables between halves. The interleaving is sequential on one
     connection, as the existing proof's docblock says. (Probed on PGlite: a row un-hidden by a
     BEFORE STATEMENT trigger is seen by that statement's target-less `ON CONFLICT DO NOTHING`.)
6. **NEW mutations** with `.expect` files and README rows:
   `422-practice-retry-says-created` (a retried result that is non-null and not `created` becomes
   `created`, so the reused-`public_id` throw is untouched), `423-weigh-in-retry-says-saved` (the
   retry's `{ dayTaken: true }` becomes `{ id: args.publicId }`), `424-checkin-ids-not-folded` (drop
   the fold).
7. **EDIT `apps/web/app/p/[profileId]/actions.test.ts`**: under the bad-body describe, two fields
   sharing an id, once in the same case and once differing in case: the envelope, both keys marked
   with `CHECKIN_COPY.itemNotSubmitted`, `logCheckinEntries` never called.
8. **EDIT `packages/shared/src/hide.ts`, `hide.test.ts`**: item 3.
9. **Docs:** `write-path.md` (the precondition, beside invariant 6); `delete-and-restore.md` (the
   `hide.ts` row: one spelling per token); `tech-debt.md`'s closed race row gains the new proof and
   422/423; `docs/plan.md`'s V1-9b row links this plan and drops the stale "B1-2 in review";
   changelog fragment `2026-11-19-fix-v1-9b-checkin-distinct-ids.md`.

## Alternatives considered

- **Answer `conflict` for repeated ids instead of throwing.** Rejected: the second item never reached
  the database, so "another row holds the id" would be false, and the action refuses first.
- **Dedupe silently in the action.** Rejected: "log it", not "fix it".
- **Lower-case only in the action and `logPracticeSchema`.** Rejected: the writer is the one place
  every caller passes, so folding there fixes the practice path and any future caller at once.
- **Prove the repeated-id throw in `db:verify` with a row count.** Rejected: the day may already be
  held, so a count cannot fail; a no-touch executor proves "no statement" directly.
- **Cut the third-phone rig** (scope lens). Rejected by the board: a regression guard for the retry.

## Test plan

The vitest and `db:verify` cases above; mutations 422–424 red; one local `db:mutations` run (with the
board's slot) confirms every existing patch still applies over the shifted writer lines.

## Risks / rollback

- Folding changes the answer's `clientId` spelling for an upper-case submit. No app path sends one;
  the check-in action folds first, and the life action reads its answer by position.
- The un-hide trigger raises 23505 if C were un-hidden while A is live; the state gate prevents it,
  and it would fail loudly.
- Rollback: revert. No migration, no data change.

## Out-of-scope

- `listEntriesForDay`'s join conjuncts (its own PR). `logRow`'s sibling race (lane E).
  `dayIsOpen` → `dayOpenFor` (next lane S PR). `take-off.ts`'s sessions join (relayed to lane P).

## Open questions

- None. The split and the rig were ruled by the board (2026-11-19).

## Review-response log (adversarial panel)

### Engineering panel (round 1, 2026-11-19)

> Models: correctness, scope, architecture, reuse, db-safety, security · fable. No UX lens: no screen
> changes, and the one visible string already exists.

| #   | Lens                | Critique (short)                                                         | Verdict      | Resolution                                                     |
| --- | ------------------- | ------------------------------------------------------------------------ | ------------ | -------------------------------------------------------------- |
| R1  | Reuse, Sec, Corr    | Ids differing in case pass both checks; one row written, then a throw    | **accepted** | `lowerCaseUuidSchema` in the action; the writer folds on entry |
| C-o | Corr (outside)      | A single upper-case practice is answered `day_taken` against its own row | **accepted** | The writer fold; `db:verify` case + mutation 424               |
| R2  | Reuse, Arch         | The copy literal would appear four times                                 | **accepted** | `CHECKIN_COPY.itemNotSubmitted`                                |
| R3  | Reuse               | A third copy of the hide rig                                             | **accepted** | Hoisted helpers, `RACE_*` ids reused                           |
| R4  | Reuse, Arch         | `entrySessionIsItsAthletes` site lists go stale                          | **moved**    | To the split-out PR                                            |
| R5  | Reuse               | Three hand-synced copies of the cast reason                              | **accepted** | Docblock is the one statement; test names carry the reason     |
| A1  | Arch, Scope         | Four concerns, wrong bundling reason, over 400 lines                     | **accepted** | Split (board); Goal reworded                                   |
| A2  | Arch, Scope         | Item 1 framed as user-visible; nobody can reach it                       | **accepted** | Goal says crafted POST; the form is off the page               |
| A3  | Arch, Scope         | `guides:check` fails: `delete-and-restore.md` owns `hide.ts`             | **accepted** | Unconditional guide edit                                       |
| A5  | Arch, DB, Sec, Corr | Emitted-SQL test cannot tell ON from WHERE                               | **moved**    | To the split-out PR, as a position assertion                   |
| A7  | Arch, DB            | The precondition binds future batch callers                              | **accepted** | Docblock + `write-path.md` line                                |
| A8  | Arch, Scope         | `plan.md` link, stale row, proof placement                               | **accepted** | Item 9; the case proof moved beside the other throw            |
| S1  | Scope               | Cut the third-phone rig                                                  | **rejected** | Board kept both halves as a regression guard                   |
| S2  | Scope               | Prove the throw in vitest, not `db:verify`                               | **accepted** | `checkin.test.ts` with a no-touch executor                     |
| D1  | DB                  | Production census before the superset conjunct                           | **moved**    | Split-out PR; the census is the maintainer's (board)           |
| D3  | DB                  | "Writes nothing" cannot fail on a row count                              | **accepted** | Vitest no-touch executor (S2)                                  |
| D4  | DB, Corr            | Rig: one table, a counter that mis-arms, staging order                   | **accepted** | Two tables, state-gated un-hide, staging order stated          |
| C2  | Corr                | Unproven on PGlite: BEFORE un-hide seen by the same insert's arbiter     | **accepted** | Probed: `[] []` then `[] [{id:3}]`, as designed                |
| C3  | Corr                | 422 as worded reddens the reused-`public_id` proof first                 | **accepted** | The patch rewrites only a non-null, non-`created` result       |
| C5  | Corr                | Nothing in CI shows the retry ran                                        | **accepted** | The statement counter is asserted to be 2                      |
| N   | several             | Line cites, Open questions section, log message, patch offsets           | **accepted** | Fixed; one full `db:mutations` run confirms every patch        |
