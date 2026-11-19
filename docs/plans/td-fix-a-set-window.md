# Tech debt — the old fix-a-set path keeps a program row to its writable days

> Debt row: [tech-debt.md](../tech-debt.md) → "The strength fix-a-set path can change a program row
> on any day" (found 2026-11-17, FAM-1 11c's panel). Branch: `fix/td-fix-a-set-window`. No
> `plan.md` row: a tech-debt payoff. Owner moved from lane E to the Tech Debt lane (the board,
> 2026-11-19); lane E reviews the hunk.

_Roadmap alignment (2026-11-19): checked against the private roadmap; nothing to add here. Gates
nothing._

## Goal

`updateStrengthSetById` (`packages/db/src/writers/strength-session.ts:490`) edits the reps and
weight of any live, done, numeric mass set the profile owns, **on any day**. A program row of the
Weight × reps type passes every one of its shape guards, so a crafted `editStrengthSetAction` POST
can change a program row's numbers outside D20's writable window (today and yesterday, D32). The
day page's own Change (`amendRow`, 11c-i) keeps that window; this older path does not.

Reach: within the household and the athlete's own history only (`ownedEntryIds` rides
`isLiveProfile(profilePublicId, scope)`). No screen reaches it for a program row today: the old log
forms that render `EditableSet` are unmounted (tech-debt "The old log forms are unmounted"), so this
is a crafted-request gap, and the fix is the writer's.

## Design (v2, after the correctness lens; board-approved 2026-11-19)

**The old fix-a-set path refuses every program row.** One conjunct in `updateStrengthSetById`'s
UPDATE WHERE: the set's entry is NOT a program row, i.e. `inArray(entry_sets.entry_id, <entries
where NOT programRow()>)`, reusing `programRow()` (`queries/day/program-rows.ts`,
`prescription_set IS NOT NULL`, which a purge leaves set) through drizzle's `not()`. It is not
added to the shared `ownedEntryIds`: the other amend paths are not this question.

- **Why not the window (v1):** on an OPEN day, the window form still lets this path edit what
  `amendRow` refuses: a workout off the week or purged (`not_scheduled`), a hidden workout or block,
  a purged prescription (`program_changed`). It also skips the `entries.updated_at` stamp Change
  writes (`day-writers.md` invariant 23: Change runs the tick's own steps). One writer for a program
  row's numbers, `amendRow`, is the rule that holds.
- **No user-visible change.** No screen offers this path for a program row: `StrengthSection` and
  the old log forms are mounted nowhere, and FAM-1 12f deletes `editStrengthSetAction`. An old
  strength session's set stays editable on any day, archived or not, as V1-9 shipped.
- **The answer stays `null` → `AMEND_ERROR_COPY.notFound('set')`**, the answer every other guard
  gives; a same-household program row and a foreign row both answer `null`, so it is no oracle.
- **No new argument, no timezone, no pre-read.** The writer's signature and its twelve `db:verify`
  call sites are unchanged. The conjunct sits in the UPDATE, so it is atomic with the edit.
- The recorded fix in the debt entry is replaced by this one when the entry is closed (board,
  2026-11-19).

## Proofs

- **`db:verify`, a "TD fix-a-set: a program row is amendRow's" block, the LAST call inside
  `verifyDay`** (`scripts/verify/day.ts`, lane E's file; lane E reviews the hunk). Last, because it
  ticks through lane E's fixture and `logRow`, so a patch that breaks a tick fails on lane E's own
  assertion first. (v1's reason, that `123`/`124` would pre-empt it, held only for the window form.) On
  the day fixture (`programRowFixture`), in `rolledBack`, via `asTx`:
  1. a program row logged today: `updateStrengthSetById` answers `null`, and its reps and weight read
     back unchanged;
  2. the same row after its prescription is purged (`prescription_id` set NULL, as `verify/day.ts`
     7 already does): still `null`, unchanged.
     An old strength-session set still edits: four of the twelve existing fix-a-set cases in `verify.ts`
     (the ones asserting an edit lands, first `:3071`) go red if the conjunct refuses every row.
- **Mutations** (Tech Debt block; `449`+, the next free):
  - `449` drops the conjunct; `db:verify` goes red on `TD fix-a-set: the old path refuses a program
row`;
  - `450` keys "program row" on `prescription_id` instead of `programRow()`; red on `TD fix-a-set: a
program row whose prescription is purged is still refused`.
- **Unit:** none needed. The action and DAL are unchanged.

## Files

`packages/db/src/writers/strength-session.ts` (the conjunct and its comment);
`packages/db/scripts/verify/day.ts` (the block, last in `verifyDay`); two mutation patches with
README rows; `docs/tech-debt.md` (entry closed, recorded fix replaced); the guides `guides:check`
charges: `docs/features/strength-logging.md` (invariant 3: the WHERE now has a server-only guard
`isEditableSet` does not mirror, on purpose) and `docs/features/write-path.md` (it owns
`packages/db/src/writers/`), plus `day-writers.md` for `verify/day.ts`; a changelog fragment.

## Review-response log

Panel: correctness (Fable), db-safety (Fable).

| #   | Lens        | Finding                                                                                               | Response                                                                                     |
| --- | ----------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| C1  | correctness | P1: the proof's location was open; in `verify.ts`'s body it pre-empts patches `123`/`124`             | **accepted**: last call inside `verifyDay`; 123/124 re-checked                               |
| C2  | correctness | P1: the window form leaves a second Change path on open days (off-week, hidden, purged)               | **accepted**: refuse every program row (board-approved); v1 design replaced                  |
| C3  | correctness | P1: the action test could not fail on where `today` comes from                                        | **moot**: v2 takes no `today`                                                                |
| C4  | correctness | P2: `today` must be required; 12 verify call sites + a DAL test                                       | **moot**: no new argument                                                                    |
| C5  | correctness | P2: no mutation reddens "an old set still edits"; build cases by varying `today`                      | **accepted** in v2 form: the 12 existing cases cover it (a refuse-all conjunct reddens them) |
| C6  | correctness | P2: `guides:check` charges write-path and day-writers too                                             | **accepted**: listed in § Files                                                              |
| D1  | db-safety   | P2: "last" gave v1's reason (123/124), false for v2                                                   | **accepted**: the reason is now the tick through lane E's fixture                            |
| D2  | db-safety   | P2: four of the twelve cases assert an edit lands, not twelve                                         | **accepted**: reworded                                                                       |
| D3  | db-safety   | P2: "goes green" contradicts the gate; quote the `.expect` lines                                      | **accepted**                                                                                 |
| D4  | db-safety   | no P0/P1: atomic, no TOCTOU (`prescription_set` written once), lock order unchanged, ownership intact | recorded                                                                                     |
