# Tech debt — the athlete cap holds under concurrent adds

> Debt row: [tech-debt.md](../tech-debt.md) → "The athlete cap is a count-then-insert, so one burst
> walks past it and the limiter cannot bound it" (added 2026-11-09). Branch:
> `fix/td-athlete-cap-lock`. No `plan.md` row: a tech-debt payoff. Folds in lane S's P2 on the same
> function (a crafted replay's case, below).

_Roadmap alignment (2026-11-19): checked against the private roadmap; nothing to add here. Gates
nothing._

## Goal

`createProfile` (`packages/db/src/writers/profile.ts:312`) reads `countProfilesIn` and then
inserts, with no transaction and no lock, so N concurrent adds from one household all read
`count < MAX_HOUSEHOLD_ATHLETES` and all insert. `checkMutationLimit` fails open, so it does not
bound the burst either. The cost is unbounded growth of `profiles`, within the caller's own
household; nothing crosses a household (`countProfilesIn` is scoped; mutation `23`).

## Design (v2, after the panel)

Follow `newItem` (`writers/program/new-item.ts:62-84`, FAM-1 caps #605) **exactly, including its
shape**. No new pattern, no new lock number, and **no `Executor` contract change**: `Executor` already
admits `exec.transaction`, and `newItem` uses it.

- **Shape (correctness P1).** `createProfile(exec, scope, input)` becomes a thin wrapper:
  `exec.transaction(async (tx) => lockedCreate(tx, scope, input))`. `lockedCreate` takes the lock,
  then calls the existing body moved **byte-identical** into a private `addProfile(exec, scope, input)`
  whose parameter is still named `exec`. That keeps mutation patches 22, 24, 28, 30 and 31 applying
  (their context is that body). Any patch that still fails `git apply --check` is regenerated and
  listed in the PR.
- **The lock**, `lockedCreate`'s first statement:
  `pg_advisory_xact_lock(ADVISORY_LOCK.householdAthletes, hashint8(households.id))`, selected through
  `householdRowIs(scope)` (`ownership.ts:295`), so the tenant id is never unwrapped in `profile.ts`.
  No household row (an erasure mid-call) → `{ ok: false, reason: 'refused' }`. That reason is already
  in `CreateProfileResult` and maps to `NO_ATHLETE_ADD`. The replay lookup stays AFTER the lock:
  lock-first is what lets a same-key twin find its twin's row instead of counting it.
- **Isolation (correctness P2):** the transaction runs at the default READ COMMITTED, so each read
  after the lock sees committed rows. A comment forbids an `isolationLevel` option: under REPEATABLE
  READ the snapshot would predate the lock wait and the cap would be bypassed.
- `locks.ts`: `householdAthletes` (`600_002`) is no longer "RESERVED"; its docblock names
  `createProfile`.
- **The case fix, as defence in depth (correctness P2; lane S's P2).** `findNameMatch`'s
  `excludeClientId` (`ownership.ts:503`) compares the stored `uuid` (lower-case) with the caller's id
  as a JS string. Lower-case the caller's id once there, keeping the NULL-safe `!==`. Through
  `createProfile` it is already unreachable: `profileByClientId` compares in SQL against a `uuid`
  column, which ignores case, so an upper-case replay returns at step 1, and the lock now closes the
  twin interleaving the exclusion guarded. It still fixes the helper for any other caller. Patch `29`
  removes that exact line, so it is regenerated.
- **Docblocks made false, rewritten:**
  - `profile.ts:300-310`: "What the duplicate warning does NOT promise". Two different-key, same-name
    adds are now serialized, so the second is warned.
  - `profile.ts:331-340`: the `excludeClientId` race, which the lock closes.
  - `packages/shared/src/profiles.ts:179-186` ("filed in tech-debt … changes the `Executor`
    contract"). This is the one `packages/shared` edit, a comment in a file outside
    `packages/shared/src/program/**` and `vocabulary.ts`, so not a contract file.
  - `docs/features/write-path.md`, where it states the cap.

## Test plan (v2)

`db:verify`, beside the existing PROF-1 a-1w block (`verify.ts:8574`):

1. **The lock**, the #605 proof copied: inside an outer transaction, `createProfile(asTx(tx), …)` (not
   `asPg`: on PGlite's single connection a query on `db` inside a transaction waits forever). Then
   `pg_locks` holds `classid = ADVISORY_LOCK.householdAthletes`, `objid` = the household's `hashint8`
   key.
2. **The household is gone:** `createProfile` under a scope whose household row is missing returns
   `refused` and writes nothing (`program.ts:3259-3266`'s precedent).
3. **The case:** `findNameMatch` with an upper-cased `excludeClientId` excludes the row it names.
4. The existing replay, cap and scope cases stay green.

DAL unit (`apps/web/lib/dal/profiles.test.ts`, db-safety P1):

- both `recording-db` stubs answer `/pg_advisory_xact_lock/` with one row, so the existing count,
  insert and replay cases still reach their queries;
- a new emitted-SQL case: the lock is the first query after `begin`, and binds the household. This is
  the only proof of where the lock sits, which `444` cannot see (db-safety P2).

Mutations from this lane's block:

- `444` drops the lock statement (case 1);
- `445` restores the case-sensitive comparison (case 3);
- `446` drops the `locked.length` check (case 2).
  README rows for all three; the README guard (#642) enforces them. `db:mutations` runs locally (a
  `packages/db` diff), with the heavy-run slot.

## Risks / rollback

- **A slower add.** One extra statement in a transaction; adds are rare.
- **No lock timeout** (db-safety P2): a waiter waits as long as a suspended holder. `newItem` has the
  same exposure, so `SET LOCAL lock_timeout` for both locks goes to the board as one follow-up, rather
  than being added to one of them here.
- **Lock order:** only this function takes `householdAthletes`, and it takes no other advisory lock,
  so it cannot deadlock against `newItem`. A cross-household unique wait holds a different key.
- **PgBouncer:** `.transaction()` pins one connection from BEGIN to COMMIT; transaction-scoped locks
  are safe in transaction mode.
- **Rollback:** revert. No schema, no data.

## Review-response log (adversarial panel)

> Models: correctness, db-safety on `opus`.

| Lens                   | Sev | Critique                                                                                                                          | Response                                                                                                                        |
| ---------------------- | --- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| correctness            | P1  | A lock as the first statement, or a re-indented body, breaks mutation patches 22, 24, 28, 30, 31 (and 29 for the case fix)        | **Accepted.** `newItem`'s shape: wrapper, `lockedCreate`, and the byte-identical body as `addProfile(exec, …)`; 29 regenerated. |
| db-safety              | P1  | The DAL test stubs answer `households` with no rows, so the lock makes `createProfile` return `refused` and existing tests go red | **Accepted.** The stubs answer the lock; a new emitted-SQL case pins the lock first.                                            |
| correctness, db-safety | P2  | The new `refused` branch is untested                                                                                              | **Accepted:** case 2 and `446`.                                                                                                 |
| correctness            | P2  | The case fix is unreachable through `createProfile`; the plan overstated it                                                       | **Accepted:** framed as defence in depth.                                                                                       |
| correctness, db-safety | P2  | Docblocks become false (`profile.ts:300-310`, `:331-340`, `shared/src/profiles.ts:179-186`, the write-path guide)                 | **Accepted:** all rewritten. The "no `packages/shared` file" claim was wrong and is corrected.                                  |
| correctness            | P2  | Pin the isolation level                                                                                                           | **Accepted:** a comment forbids an `isolationLevel` option.                                                                     |
| correctness            | P2  | Run the lock proof with `asTx(tx)`                                                                                                | **Accepted.**                                                                                                                   |
| db-safety              | P2  | Nothing tests where the lock sits                                                                                                 | **Accepted:** the emitted-SQL order case.                                                                                       |
| db-safety              | P2  | No `lock_timeout` on the wait                                                                                                     | **Routed:** `newItem` shares it; one follow-up for both locks.                                                                  |
| correctness, db-safety | —   | Nested transactions, the lock key and collisions, PgBouncer, deadlock, replay-first under the lock: sound                         | Recorded.                                                                                                                       |
