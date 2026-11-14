---
feature: Delete and restore an entry (ADR 0008's soft delete)
owns:
  - packages/db/src/writers/hide.ts
  - packages/db/src/queries/hidden-entries.ts
  - packages/shared/src/hide.ts
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
files — one writer, one tombstone-returning reader, and every other query in the repo obliged to
filter. None of them can be checked by looking at a single file.

## The file map

| File                                                                | What it is                                                                                                                                                                       |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared/src/hide.ts`                                       | The wire contract: `HIDE_ROW_MAX`, `hideEntriesSchema`, `restoreHiddenSchema`, the token's format, and `RESTORE_REASONS`. ⚠️ No `N` and no `expired` — the window is `PRIV-3`'s. |
| `packages/db/src/writers/hide.ts`                                   | **The only module that writes `entries.deleted_at`.** `hideEntries` and `restoreHidden`.                                                                                         |
| `packages/db/src/queries/hidden-entries.ts`                         | **The only read that returns tombstones.** `hiddenEntriesForDay`, `hiddenDayCounts`.                                                                                             |
| `packages/db/src/writers/bodyweight.ts`                             | `bodyweightSlot` — the day-slot predicate, shared with `restoreHidden`'s holder lookup so the two cannot disagree about what "the slot" is.                                      |
| `packages/db/scripts/verify.ts`                                     | § `V1-9b B1-1b`, the proofs, including the reader audit.                                                                                                                         |
| _(B1-2)_ `app/p/[profileId]/entry-actions.ts`, `lib/dal/entries.ts` | The actions and the DAL wrapper. Not yet built.                                                                                                                                  |
| _(B1-3)_ `app/p/[profileId]/hidden/`                                | The screen. Not yet built.                                                                                                                                                       |

## Invariants that live between files

**1 · `hide.ts` is the only writer of `deleted_at` the APP can reach.** That is what makes invariant 3
a finite claim — but the unqualified version ("the only writer") is **false**, and a privacy lens
caught it. There are three:

| Writer                                                | Reachable by                | Production       |
| ----------------------------------------------------- | --------------------------- | ---------------- |
| `writers/hide.ts`                                     | the app, from `B1-2` on     | not yet          |
| `scripts/corrections/registry.ts` (bodyweight de-dup) | an operator, with a dry run | **has been run** |
| `apps/web/scripts/screenshot-ephemeral.ts`            | a developer, throwaway DB   | no               |

🔴 **The consequence `B1-3` has to decide, so it is written down here rather than discovered:**
`hiddenEntriesForDay` does **not** distinguish a row the person hid from a row the _correction_ hid.
Production already holds correction-hidden weigh-ins, so the moment `B1-3` renders the hidden region
they appear as restorable items nobody deleted — and restoring one would answer `slot_taken` against
the keeper the correction left in place. Showing them, hiding them, or labelling them is a product
call, and it is `B1-3`'s.

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

| Reader                                                       | How it filters                                                     | Proof                                                                                   |
| ------------------------------------------------------------ | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `listEntriesForDay` (`lib/dal/entries.ts`)                   | entries; sets through live entry ids; quantities through live sets | B1-2's emitted-SQL test, B1-3's e2e                                                     |
| `strengthMonthRows` / `bodyweightMonthRows` / `loggedMonths` | `queries/export-month.ts`                                          | `verify.ts` § B1-1b, incl. deep-equal restore                                           |
| `weeklyAdherence`                                            | entries                                                            | `verify.ts` § B1-1b                                                                     |
| `ownedEntryIds` → both amends                                | entries                                                            | amending a hidden entry answers `notFound`                                              |
| `insertBodyweightEntry` branch (b)                           | `bodyweightSlot` + `deleted_at IS NULL`                            | `verify.ts` V1-24 1d                                                                    |
| `movement-ownership.ts`                                      | **deliberately none**                                              | asserted unchanged — a tombstone still holds its FK and still blocks a household delete |

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

## Traps

- **"Delete" is a tombstone.** Nothing here removes a row. Code or copy that assumes the row is gone
  is wrong until `PRIV-3` ships the purge.
- **A hidden row HOLDS its `client_id`** (non-partial since B0), so a replay of a hidden write
  conflicts rather than twinning. `writers/checkin.ts` reports that as `own_hidden`; the strength and
  bodyweight paths still throw (Decision 7), and B1-2 maps it.
- **Don't add `includeHidden` to a live reader.** A second consumer of tombstones belongs in
  `queries/hidden-entries.ts`. A flag is how a deleted set reaches the CSV the export exists for.
- **`activity_date` is a plain `DATE`.** `hiddenDayCounts` returns it as text; mapping it through a
  `Date` gives a calendar day a timezone it never had (V1-6c).
- **A session's `feel` note outlives its entries.** Hiding every entry of a session leaves the
  `sessions` row, and its free-text note — a child's own words — with it. The purge must hard-delete
  orphaned grouping rows, recorded as a requirement on `PRIV-3` in the plan. ⚠️ **It is not yet in the
  notice or in the inventory's §8**, and this guide previously said it was; `B1-3`/`B2` own adding it
  (plan requirement 2).
