---
feature: Delete and restore an entry (ADR 0008's soft delete)
owns:
  - packages/db/src/writers/hide.ts
  - packages/db/src/queries/hidden-entries.ts
  - packages/db/src/queries/clear-events.ts
  - apps/web/app/p/[profileId]/clear-day-actions.ts
  - apps/web/app/p/[profileId]/clear-day-actions.registry.ts
  - apps/web/app/p/[profileId]/clear-day-actions.test.ts
  - packages/shared/src/clear-day-shapes.ts
  - packages/shared/src/clear-day-shapes.test.ts
  - packages/shared/src/hide.test.ts
  - apps/web/lib/dal/entries-restore-clear.test.ts
  - packages/shared/src/hide.ts
  - apps/web/app/p/[profileId]/clear-day.tsx
  - apps/web/app/p/[profileId]/clear-day-banner.tsx
  - apps/web/app/p/[profileId]/clear-day-outcome.ts
  - apps/web/app/p/[profileId]/clear-day-notice.ts
  - apps/web/app/p/[profileId]/clear-day-notice.test.ts
  - apps/web/app/p/[profileId]/clear-day.test.tsx
  - apps/web/lib/entries/clear-summary.ts
  - apps/web/lib/entries/clear-summary.test.ts
  - apps/web/lib/entries/restore-deadline.ts
  - apps/web/lib/entries/restore-deadline.test.ts
  - apps/web/e2e/clear-day.spec.ts
---

# Delete and restore

What a person calls **Delete**, the database calls `deleted_at`. The row stays: it keeps its values,
its `public_id`, its `created_at` and its `client_id`.

⚠️ **It is restorable indefinitely, because nothing purges a hidden row.** `PRIV-3` owns the purge and
the restore window, and `PRIV-3` **has no plan yet** — so "until it is removed" describes an intention,
not a schedule. [data-inventory.md](../privacy/data-inventory.md) §5 is the one owner of retention and
says the same thing; if these two ever disagree, the inventory is right. [ADR 0008](../decisions/0008-deletion.md) is the contract;
[the plan](../plans/v1-9b-delete-and-restore.md) holds the decisions and their alternatives.

🔴 **Read this before touching anything that reads `entries`.** The invariants here live _between_
files — one writer, one tombstone-returning reader of VALUES (`hidden-entries.ts`), one of a clear's token and count (`clear-events.ts`, B1-2), plus the clear's day-only pre-read, and every other query in the repo obliged to
filter. None of them can be checked by looking at a single file.

## The file map

| File                                                                                                               | What it is                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared/src/hide.ts`                                                                                      | The wire contract: `HIDE_ROW_MAX`, `hideEntriesSchema`, `restoreHiddenSchema`, the token's format (one real instant in its one spelling: why each of the five refused shapes is refused is its docblock), `RESTORE_REASONS`, and `HIDE_REASONS` (B2-0: `'clear_day'`, the one reason). ⚠️ No `N` and no `expired` — the window is `PRIV-3`'s.                                                                                                                                                                     |
| `packages/db/src/writers/hide.ts`                                                                                  | **The only module that HIDES an entry** (sets `entries.deleted_at`). The one other write of the column is FAM-1 11c-ii's revive, module-private in `writers/day/log-row.ts`, which only clears it, through `UNHIDE`. `hideEntries` and `restoreHidden`; since B2-0 `clearDay` and `restoreClear` (both sides of Clear this day, worked out on the server: no id list, no cap) and `UNHIDE`, the one un-hide every writer sets.                                                                                    |
| `packages/db/src/queries/hidden-entries.ts`                                                                        | **The only read that returns a tombstone's VALUES.** `hiddenEntriesForDay`, `hiddenDayCounts`. (`writers/single-value.ts`'s pre-read sees a hidden row too, but returns only its day: below.)                                                                                                                                                                                                                                                                                                                     |
| `packages/db/src/writers/single-value.ts`                                                                          | **The app's first route to `hideEntries`** (V1-24 3b-bw): `clearBodyweight` hides one weigh-in on a blank ✓, and `clearPractice` one practice (3b-life-a), over one core with the metric, its slot and (for practice) its unit pinned. The pre-reads `bodyweightRowForAmend` and `practiceRowForAmend` see a hidden row, but return only its day (reader table, below).                                                                                                                                           |
| `packages/db/src/writers/bodyweight.ts`                                                                            | `bodyweightSlot` — the day-slot predicate, shared with `restoreHidden`'s holder lookup so the two cannot disagree about what "the slot" is.                                                                                                                                                                                                                                                                                                                                                                       |
| `packages/db/scripts/verify.ts`                                                                                    | § `V1-9b B1-1b`, the proofs, including the reader audit. B2-0's are `verify/single-values.ts` § `V1-9b B2-0` (lane S's file); `packages/db/src/writers/no-bare-unhide.test.ts` pins `UNHIDE` as the only un-hide.                                                                                                                                                                                                                                                                                                 |
| `packages/db/src/queries/clear-events.ts`                                                                          | **One predicate for a clear** (B1-2): `ownedOnDay`, `clearEventOn` (owned ∧ day ∧ `'clear_day'`), `hiddenAtText` (moved here from `hide.ts`, which imports it; no longer exported from the package), and `clearEventsForDay`, the banner's read: every clear of a day, newest first, as a token and a count. `clearDay`'s replay and `restoreClear` use the same predicate, so the banner offers exactly what Restore all restores. A leaf: `hide.ts` imports it, so there is no cycle.                           |
| `packages/shared/src/clear-day-shapes.ts`                                                                          | The day-level contract: `restoreClearSchema` (`rowRetickSchema` without the entry), `clearDaySchema` (the athlete, the day and `CLEAR_DAY_CONFIRM_WORD`, bounded by `CLEAR_DAY_CONFIRM_MAX`; a check against a client bug, not a control), `ClearEvent`, `DAY_CLEAR_REFUSALS` (one list for both actions, a subset of `ROW_REFUSALS`) and the results `{ ok: true, restored, keptHidden }` and `{ ok: true, count }`.                                                                                             |
| `app/p/[profileId]/clear-day-actions.ts` (+ `.registry.ts`, `.test.ts`)                                            | `restoreClearAction` (B1-2) and `clearDayAction` (B2-i), called by the screen's two islands below. Their windows (`dayOpenFor`, `clearDayOpenFor`), who may (any member) and the refusals are the module's docblock; the DAL wrappers `dayClearEvents`, `restoreClearedDay` and `clearDayEntries` are in `lib/dal/entries.ts`.                                                                                                                                                                                    |
| `app/p/[profileId]/clear-day.tsx`, `clear-day-banner.tsx`, `clear-day-outcome.ts`, `clear-day-notice.ts` (+ tests) | **The screen (B2-ii).** The foot's "Clear this day…" and its type-to-confirm dialog; the banner above the program line, with Restore all on the newest clear and the outcome line every result lands on; and the channel between them. 🔴 **Both islands stay mounted on every day they can act on**, keyed by athlete and day: a clear empties the day and a restore removes its event, so a conditional mount would unmount the reporter mid-answer. Focus crosses the two through `lib/a11y/focus-handoff.ts`. |
| `lib/entries/clear-summary.ts`, `restore-deadline.ts` (+ tests)                                                    | The dialog's counts, from the page's own `plan` and `entries` (they sum to what `clearDay` locks, by construction), and the deadline in relative words from `WRITABLE_DAY_RADIUS`.                                                                                                                                                                                                                                                                                                                                |

## Invariants that live between files

**1 · `hide.ts` is the only writer of `deleted_at` the APP can reach.** That is what makes invariant 3
a finite claim — but the unqualified version ("the only writer") is **false**, and a privacy lens
caught it. There are three:

| Writer                                                | Reachable by                                                                                                                                                                                                                                                                                        | Production       |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `writers/hide.ts`                                     | the app: a blank ✓ clears a weigh-in from V1-24 3b-bw, and a practice from 3b-life-a (`writers/single-value.ts`); the next caller is B2's Clear this day, and Beta 0 has no per-item Delete. From FAM-1 11b, un-tick and re-tick of a program row (`writers/day/log-row.ts`, its program rows only) | from 3b-bw       |
| `scripts/corrections/registry.ts` (bodyweight de-dup) | an operator, with a dry run                                                                                                                                                                                                                                                                         | **has been run** |
| `apps/web/scripts/screenshot-ephemeral.ts`            | a developer, throwaway DB                                                                                                                                                                                                                                                                           | no               |

🔴 **A consequence, written down here rather than discovered** (it was `B1-3`'s to decide; B1-3 is cut, and B2-0's reason settles it for the banner, invariant 1b):
`hiddenEntriesForDay` does **not** distinguish a row the person hid from a row the _correction_ hid.
Production already holds correction-hidden weigh-ins, so the moment `B1-3` renders the hidden region
they appear as restorable items nobody deleted — and restoring one would answer `slot_taken` against
the keeper the correction left in place. Showing them, hiding them, or labelling them is a product
call; it returns if a per-item hidden region is ever built.

**1b · `hide_reason` says which hides are a Clear this day (V1-9b B2-0), and its lifecycle is
structural.** `'clear_day'` is written by `clearDay` alone: `hideEntries` takes no reason (a private
`hideRows` core does), so a blank clear, an un-tick, a swap's holder and a correction all leave it
NULL. **Every un-hide clears it in the same statement** as `deleted_at`, by setting `UNHIDE`; a CHECK
refuses a live row with a reason (`23514`), and a source test refuses any other un-hide spelling in
`packages/db/src` and `apps/web/lib/dal`. The un-hides are `restoreHidden`, `restoreClear` and, since
FAM-1 11c-ii, the row writer's revive (a ✓ after an un-tick or a Clear this day brings the entry back,
so it leaves the "Day cleared · n hidden" count). A partial Restore all drops the reason of the items it left hidden (their place was
retaken), so the banner does not come back offering a restore that can only refuse. This answers
invariant 1's open consequence for the banner: a correction-hidden row has no reason, so it never
counts as a clear. ⚠️ **`restoreClear` replays as `notFound`**: it finds the clear's rows by state its
own success erases, so B1-2's action answers a retried Restore all `ok` with 0 restored and 0 kept
hidden, "nothing left to restore", never a refusal. **One predicate (`clearEventOn`,
`queries/clear-events.ts`) serves the banner's read, `clearDay`'s replay and `restoreClear`.** A day
can hold two clears (clear, log again, clear again): the read returns both, newest first, and which
the banner offers is B2's UX panel's call. **`clearDay` checks the archived athlete itself, under a
lock** (the archive race, maintainer 2026-11-19): it takes the profile row `FOR SHARE` before any
entry, so a concurrent archive (an UPDATE, which needs a lock `FOR SHARE` blocks) waits for the clear,
and an archive committed first answers `{ closed: true }`, which the action returns as `closed_day`.
The action's own check, before the transaction, stays as the cheap first refusal. The lock queues
the clear with every other profile writer (restore, rename, the routine, Put on / Take off, the
erasure) but not with an entry insert (its FK check takes `KEY SHARE`) or a hide or amend (no profile lock); the order stays cycle-free only while no
writer locks entries and then takes a stronger profile lock, and `db:verify` pins the mode and order. Proof 14 and
mutation 425 prove the check runs in the writer; PGlite has one connection, so the blocking itself is
Postgres's documented row-lock conflict, not a proof here.

**2 · The event token is TEXT, end to end, and never passes through a `Date`.** A hide event is
`(profile, day, deleted_at)`. Postgres stores `timestamptz` to **microseconds**; a JavaScript `Date`
holds **milliseconds**. A token that round-trips through drizzle's date mapping comes back rounded and
no longer matches the row it came from — so the read emits
`to_char(deleted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')` and the writer compares
`deleted_at = $token::timestamptz` as a bound parameter. The repo has paid for this once already
(`registry.ts:209-212`). Mutation **41** is the proof it stays true.

⚠️ **And the proof needs a hand-written `deleted_at`.** `db:verify` runs on PGlite, whose `now()`
resolves to **milliseconds** — so a token taken from the clock loses nothing in a `Date` round-trip
and the mutation cannot redden. The fixture sets `deleted_at` to `'…12:00:00.123456+00'` explicitly.
The first version of that proof did not, and was vacuous.

**3 · Every other reader filters tombstones; this table is the audit.** `ON DELETE CASCADE` is
hard-delete only, so hiding an entry leaves its `entry_sets` and `entry_set_quantities` rows with
`deleted_at IS NULL` — **live children of a dead parent**. A reader that filters only its own table
still returns them, which is why each one reaches ownership through the parent.

| Reader                                                            | How it filters                                                                                                                                                                                    | Proof                                                                                                               |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `listEntriesForDay` (`lib/dal/entries.ts`)                        | entries; sets through live entry ids; quantities through live sets                                                                                                                                | `lib/dal/entries.test.ts`'s emitted-SQL test; `e2e/bodyweight-receipt.spec.ts` (a cleared weigh-in leaves the page) |
| `strengthMonthRows` / `bodyweightMonthRows` / `loggedMonths`      | `queries/export-month.ts`                                                                                                                                                                         | `verify.ts` § B1-1b, incl. deep-equal restore                                                                       |
| `weeklyAdherence`                                                 | entries                                                                                                                                                                                           | `verify.ts` § B1-1b                                                                                                 |
| `ownedEntryIds` → both amends                                     | entries                                                                                                                                                                                           | amending a hidden entry answers `notFound`                                                                          |
| `insertBodyweightEntry` branch (b)                                | `bodyweightSlot` + `deleted_at IS NULL`                                                                                                                                                           | `verify.ts` V1-24 1d                                                                                                |
| `writeCheckinEntries`'s `day_taken` lookup (`writers/checkin.ts`) | `practiceSlot` + `deleted_at IS NULL`: a cleared practice frees its day                                                                                                                           | `verify/single-values.ts` § 3b-0; mutation **85**                                                                   |
| `lastBodyweightBefore` (`queries/last-bodyweight.ts`)             | entries (`deleted_at IS NULL`): a cleared weigh-in is never "Last time"                                                                                                                           | `verify/single-values.ts` § 3b-bw; mutation **61**                                                                  |
| `bodyweightRowForAmend` (`writers/single-value.ts`)               | **deliberately none**: it returns a row's DAY and nothing else, so a replayed clear reaches `clearBodyweight` (which answers it under its own lock) and the write is bounded by the row's own day | `verify/single-values.ts` § 3b-bw                                                                                   |
| `practiceRowForAmend` (`writers/single-value.ts`)                 | **deliberately none**, as `bodyweightRowForAmend`: the DAY only, for the practice amend (V1-24 3b-life-a)                                                                                         | `verify/single-values.ts` § 3b-life-a                                                                               |
| `findAmendablePractice` (`writers/practice.ts`)                   | entries (`deleted_at IS NULL`): a cleared practice is not amendable, so the re-read answers `null`                                                                                                | `verify/single-values.ts` § 3b-life-a                                                                               |
| `movement-ownership.ts`                                           | **deliberately none**                                                                                                                                                                             | asserted unchanged — a tombstone still holds its FK and still blocks a household delete                             |

**4 · A hide is all-or-nothing, and a replay is `ok` — including a MIXED one.** ⚠️ If some named ids
are already hidden and some are live, the call mints a new event for the live ones and returns **that**
token; the older ids keep theirs and answer `changed` on a restore under the new one. A retry of that
same mixed call returns the same (newest) token rather than refusing — which it did not, until a
review lens found it.

If any id is not an owned entry of that
athlete on that day — live _or already hidden_ — the whole call is `notFound`. ⚠️ The count is of ids
**found**, not rows **updated**: the `UPDATE` touches only live rows, so a replay updates zero and is
still `ok`. Reading the update's row count as the answer turns every replay into `notFound`, and it
is the obvious mistake here.

**5 · One transaction, one `now()`, one event.** `clock_timestamp()` would give each statement its
own token and silently split a folded row into N events.

**6 · The swap touches the holder only after the item is proved hidden under the token**, and each
item runs in its own **savepoint**. Decision 8's order exists because the alternative — hide the
holder, then discover the item moved — loses a live weigh-in for nothing. The savepoint is what makes
"never half-commits" true rather than hoped: a refusal leaves by `throw`, because returning it would
commit the holder's hide.

**7 · A restore that lands on a held place answers `slot_taken`, through a list of index names**
(`RESTORE_SLOT_INDEXES` in `hide.ts`, _maintainer, 2026-11-16_). Bodyweight has a holder lookup and the
swap first; **practice (V1-24 3b-0) has neither**: its restore meets `uq_entries_profile_day_practice`
and the catch answers `slot_taken` without `heldBy`, and `keepInsteadOf` never applies to it. That keeps
the list provable on PGlite's one connection (mutation **86**); for bodyweight the catch is reached
only by the two-connection race. **A program row (FAM-1 11b) is the third entry,
`ENTRY_PRESCRIPTION_SET_UNIQUE_INDEX`, and like practice it has no pre-check and no `heldBy`**: a
re-tick onto a set ticked again meanwhile meets the row arbiter inside its savepoint and answers
`slot_taken` (`verify/day.ts` 10, mutation **122**). The match is `isUniqueViolationOn`
(`writers/unique-violation.ts`), the one matcher for a named unique index. Any other `23505` still
propagates. Re-entering a cleared single value makes a new row; reviving the hidden one
is for program rows only _(maintainer, 2026-11-16)_.

## Traps

- **The clear's `count` is the day's newest clear's, not what one tap hid** (B2-i): a tap that finds
  nothing live replays the newest clear, even an older one. No copy says "you hid n"; the banner reads
  `dayClearEvents`.
- **Enter in the confirm field must never clear.** The footer's action is a submit, so the field's
  `onKeyDown` stops Enter and moves focus to Clear day instead; the e2e asserts the dialog is still
  open after it.

- **"Delete" is a tombstone.** Nothing here removes a row. Code or copy that assumes the row is gone
  is wrong until `PRIV-3` ships the purge.
- **A hidden row HOLDS its `client_id`** (non-partial since B0), so a replay of a hidden write
  conflicts rather than twinning. `writers/checkin.ts` reports that as `own_hidden`; the strength and
  bodyweight paths still throw, kept as a throw by Decision 7 (no typed replay-of-hidden).
- **Don't add `includeHidden` to a live reader.** A read of a tombstone's VALUES belongs in
  `queries/hidden-entries.ts`, and a read of a clear's token and count in `queries/clear-events.ts`; a write path that must see a hidden row to answer a replay (the clear's
  pre-read, `writers/single-value.ts`) returns the day and nothing more. A flag on a live reader is how
  a deleted set reaches the CSV the export exists for.
- **`activity_date` is a plain `DATE`.** `hiddenDayCounts` returns it as text; mapping it through a
  `Date` gives a calendar day a timezone it never had (V1-6c).
- **A session's `feel` note outlives its entries.** Hiding every entry of a session leaves the
  `sessions` row, and its free-text note — a child's own words — with it. The purge must hard-delete
  orphaned grouping rows, recorded as a requirement on `PRIV-3` in the plan. The notice's "Clear this
  day" paragraph and the inventory's §8 say so since B2-ii, and the dialog says it when the day has a
  workout.
