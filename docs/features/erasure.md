---
feature: Erasure (the household graph)
owns:
  - packages/db/src/erasure/
  - packages/db/scripts/verify/erasure.ts
---

# Erasure: the household graph

**Read this before adding a table, a foreign key, or a delete that removes a household's rows.**
The plan is [priv-3-guarded-deletion.md](../plans/priv-3-guarded-deletion.md) (`PRIV-3`); the
procedure people run today is [runbooks.md](../runbooks.md) → "Delete a household and everyone in
it" and "Erase one athlete".

## What this is

One committed list of the tables that hold a household's data, in the order a delete must walk them,
each with the predicate that selects one household's rows. Both erasures, and `OPS-3`'s restore,
read it. **PR 1 shipped the list and its proofs; PR 2a the delete core at household grain**
(`eraseHousehold`), with its pre-flights and proofs. 🚧 Nothing calls the core yet: `CAT-3` R0's
one-shot entry, `erase-household` (PR 2b) and the athlete grain (PR 3) are planned. The flow is [architecture.md](../architecture.md) → "The
erasure graph".

## The map

| File                                    | What it holds                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/db/src/erasure/graph.ts`      | `HOUSEHOLD_GRAPH` (21 tables, child before parent, `householdRows(scope)`; `CAT-3` A1 added `movement_equipment` and `movement_muscles`, scoped through `movementsOf`), `ATHLETE_GRAPH` (step 5's per-profile list), `REFERENCE_TABLES`, `NON_ABORTING_EDGES`, `isAthleteGrain`, `graphTableName`. Not in the barrel.                                                                                                                                                   |
| `packages/db/src/erasure/erase.ts`      | The core, `eraseHousehold(exec, scope: OwnerScope, { apply })`: dry run (counts, pre-flights, memberships, no lock) or one transaction (timeouts, restore point, locks, pre-flights, counts, `DELETE … RETURNING` checked against each count, the global movements unchanged). `PARENT_TABLES` (derived from drizzle's FK config), `LOCK_ORDER`, and the three typed errors. Not in the barrel.                                                                         |
| `packages/db/src/erasure/preflight.ts`  | Pre-flights (a)–(h): one join per shape, read as an unscoped census (re-exported by `verify/schema.ts` under the old names), as `householdPreflights(exec, scope)`, and, for (a), (b), (c), (h), by step 5's interim athlete views in `verify/schema.ts`. (d) is `queries/movement-ownership.ts`'s `movementRefsIntoHousehold`, from the census's own join.                                                                                                             |
| `packages/db/scripts/verify/erasure.ts` | P1, P2, P7 and P8 (below), run by `verify.ts` after the lanes' modules and before `CAT-3`'s `verifyCatalogTables`, whose rolled-back rows they never see. P7's fixture plants a row in each join table on B's movement. Mutations `260`–`270` prove each can fail. Since PR 2a also the lock pins, P3 (erase H, K unchanged, a caller's throw rolls it back), P4 (each pre-flight refuses naming itself) and P5 (a hidden household, committed); mutations `279`–`286`. |
| `packages/db/src/writers/ownership.ts`  | The leaves the predicates are built from, including `householdRowIs` and `householdMemberInHousehold`. Owned by [write-path.md](./write-path.md): it is the one module allowed to unwrap a scope.                                                                                                                                                                                                                                                                       |

## Invariants that live between the files

1. **The order follows the catalog, not the prose.** P2 requires every foreign key into a graph table
   to come from a graph table at a lower index. A new table, or a new FK, goes into the graph in the
   same PR, or `db:verify` goes red (P1 for the table, P2 for the edge).
2. **A foreign key that does not abort is named.** A `CASCADE` or `SET NULL` key into the graph
   must be in `NON_ABORTING_EDGES` with its guard: `cascade`, or the runbook pre-flight letter that
   refuses the cross-household row first. P2 compares the list with `pg_constraint`.
3. **The two-reference rows use `AND`.** `prescription_targets` and `program_assignments` are a
   household's only when the athlete **and** the program are. A straddling row is matched by
   neither household, so its parent's delete aborts `23503`: fail closed. P7 plants both straddles.
   ⚠️ `OR` deletes another family's row instead.
4. **Never a `deleted_at` conjunct.** A hidden row is still erased. P7 plants a hidden row in every
   graph table that has a `deleted_at` column and requires B's predicate to match it; P8 plants a
   hidden athlete with a hidden row and requires the household form to select it. ⚠️ P8's "same
   rows" holds only on data with no straddling row: a per-profile scope takes an athlete's target or
   assignment on another household's program, and the `AND` leaves it. "Erase one athlete"'s
   pre-flight 2 refuses that row before any delete.
5. **Athlete grain is derived, never stored.** `isAthleteGrain` is membership in `ATHLETE_GRAPH`,
   and P2 requires the graph's athlete-grain tables to be that list in graph order. P8 requires the
   two forms to select the same **rows** for household B. Step 5's proof (`verify/schema.ts`) holds
   the same list against every table reachable from `profiles`, and the runbook's step-4 table and
   count block against it.
6. **A predicate is built from a leaf, never from `scope.householdId`.** The leaves live in
   `ownership.ts`; `src/scope.test.ts` fails the build on any other module unwrapping a scope.

7. **The lock order starts with the program writers' order.** `LOCK_ORDER` (`erase.ts`, whose
   docblock has the reasoning): `program_blocks`, `profiles`, the household row, the two again, then
   the other parents parent-first, all `FOR UPDATE`, each table in id order. It cannot deadlock with
   the program writers; it **can** with a log write (the row writer takes the session before the
   profile), and Postgres then aborts one side: if that is the erasure, re-run from the dry run.
   Pinned from the source (mutations `285`, `286`, `331`), since PGlite cannot show a wait.
8. **Locks before the pre-flights, inside the transaction.** At READ COMMITTED a straddling row
   committed after the check would otherwise be deleted, nulled or aborted on. (e), (f) and (g)
   guard `SET NULL` keys: they are the only thing between H's erasure and H's typed text left on
   another family's row, so each has its own mutation.
9. **The core never commits a caller's transaction.** It works inside `exec.transaction(…)`: given a
   transaction, that is a savepoint, so a caller (R0) can compare the returned `total` and throw to
   roll everything back. P3 proves it. Its `SET LOCAL` timeouts (`setLocalTimeouts`,
   `writers/executor.ts`) last until the caller's transaction ends.

## Traps

- `movementIsAvailableTo` and `templateBlockIn` / `liveTemplateBlockIn` look like the right leaves
  and are not: the first adds `household_id IS NULL` (the global catalog, which must survive), the
  others miss legacy and hidden blocks.
- drizzle's `and()` does not parenthesize its operands, so a two-part predicate carries its own
  parentheses; P7's `both()` wraps each side for the same reason.
- **A database error from inside the core is a `DrizzleQueryError` whose message holds the household's
  id** (drizzle puts the bound parameters in it). Every caller catches it, redacts
  (`scripts/corrections/redact.ts`) and prints only `cause.code` and `cause.constraint`; only the
  core's own typed errors are safe to print as they are.
- The report's `members` are Clerk user ids: personal identifiers. A caller prints them only under a
  privileged heading (PR 2b) or not at all (R0 prints counts). `liveElsewhere` is the resolver's own
  rule (`isLiveMembership`: member row and household live), read as of the transaction; 2b re-reads
  it immediately before any Clerk deletion.
- Runbook pre-flight (i) (an entry in another profile's session, any household) is not in the core:
  it is not about one household, and the day resolver already refuses it on read.
- `OPS-3` restores in reverse graph order into a database that already holds `REFERENCE_TABLES` and
  every global movement the household references, **with those movements' equipment and muscle
  rows** (`CAT-3` A1): no household's `householdRows` match them, so an extract never carries them.
- A library movement's join rows are matched by no household (`CAT-3` A1's S2 proof in
  `verify/catalog.ts`, mutations `318` and `319`). P7 cannot see that case: none of its fixture rows is
  on a global movement.
