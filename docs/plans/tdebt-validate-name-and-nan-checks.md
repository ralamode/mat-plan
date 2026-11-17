# Lane A tech-debt, PR 2 of 2: validate the program-name and NaN CHECKs (migration 0031)

## Where this sits

- **Ledger:** [tech-debt.md](../tech-debt.md), two entries this PR pays off and deletes:
  "`program_blocks.name` has no length CHECK" and "A logged quantity's CHECK admits `NaN`" (both
  owned by lane A of FAM-1, by the maintainer's go, 2026-11-16).
- **PR 1 of 2** (#496, migration `0029`, applied 2026-11-17) added the four CHECKs `NOT VALID`. This
  PR validates them. The maintainer chose two PRs for all four, with `entries.value_num` included
  (2026-11-16).
- **Milestone:** none of FAM-1's steps depends on it. It took the first free slot in the migration
  queue after lane S's `0030`.
- Roadmap alignment (2026-11-17): checked against the private roadmap; nothing to add here.

## What changes

| File                                                                 | Change                                                                                                                                                                                                                                                                            |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/db/migrations/0031_tdebt_validate_name_and_nan_checks.sql` | `drizzle-kit generate --custom` (no schema change, as `0016` and `0028`), then four `VALIDATE CONSTRAINT`, in `0029`'s order, after `SET lock_timeout = '5s'` and `statement_timeout = '60s'`. The header gives the locks, the merge condition and the recovery.                  |
| `packages/db/scripts/verify/schema.ts`                               | (a) asserts each of the four is validated, one assertion per constraint. (c) shows, on a planted violator under a re-added `NOT VALID` CHECK, that its soft delete is refused and that `VALIDATE` refuses it by name.                                                             |
| `packages/db/scripts/mutations/`                                     | `208` deleted (once validated it cannot go red). `216`–`219` each drop one `VALIDATE` and go red on that constraint's own message.                                                                                                                                                |
| `packages/db/src/schema.ts`                                          | Comments only: "0029 NOT VALID, validated by 0031". Also two comment corrections asked for by other lanes (the assignments docblock names `programOrderSchema` as what refuses a repeat; a quantity's docblock no longer says its rows are only ever written with a fresh entry). |
| `docs/tech-debt.md`                                                  | Both entries deleted (the file's rule: a paid-off entry is deleted).                                                                                                                                                                                                              |
| `docs/runbooks.md`                                                   | `0031` added to the "a migration failed" list. The `lock_timeout` line no longer hard-codes 5 s.                                                                                                                                                                                  |
| `docs/features/programming.md`, `program-contract.md`                | The name CHECK covers every row now.                                                                                                                                                                                                                                              |

## Merge condition

The maintainer re-runs a read-only production read **after `0029` applied**. It must show 0
violators of each CHECK and 4 constraints still awaiting validation. Since `0029`, every insert and
update was already checked, so a read taken after it covers exactly the rows `VALIDATE` scans. The PR
body records the query and the result.

## Review-response log

DB-safety lens (Opus, 2026-11-17, on the design brief): no P0.

| #   | Sev | Finding                                                                                                                                                       | Response                                                                                                                                                                                                                                 |
| --- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | P1  | (c)'s "re-added definition equals the migrated one" can never pass after `0031`: `pg_get_constraintdef` appends ` NOT VALID` to the re-added constraint only. | **Taken.** Asserts `migratedDef + ' NOT VALID'`.                                                                                                                                                                                         |
| 2   | P2  | A mutation of (c)'s planted row tests the proof's own fixture, not shipped code.                                                                              | **Taken.** No such mutation. (c) is labelled a demonstration of Postgres's behaviour, not a guard on `0031`.                                                                                                                             |
| 3   | P2  | One `deepEqual` for all four lets a patch that drops the wrong `VALIDATE` still match its `.expect`.                                                          | **Taken.** One assertion per constraint, and each of `216`–`219` expects its own constraint's message.                                                                                                                                   |
| 4   | P2  | Dropping the soft-delete demonstration loses the fact that shapes recovery: hiding a violator is refused, so a correction must repair the value.              | **Taken.** (c) keeps the soft delete before the `VALIDATE`. The header and the runbook say the correction repairs the value.                                                                                                             |
| 5   | P2  | `0029`'s reason for 2 s (`ACCESS EXCLUSIVE` queueing reads) does not apply to `VALIDATE`, whose lock blocks no app query.                                     | **Taken.** 5 s, as `0016` and `0018`, with the real reason (autovacuum) in the header.                                                                                                                                                   |
| 6   | P2  | The preview database gets `0031` with no read.                                                                                                                | **Recorded, not run.** The preview database is seed-only and every writer is bounded by zod, so a violator there is unlikely. A failure there wedges only the preview's migrate, and the recovery is the runbook's. The PR body says so. |
| 7   | P2  | A migration PR owes a committed plan.                                                                                                                         | **Taken.** This file.                                                                                                                                                                                                                    |

Q1 (could a row fail `VALIDATE` despite a clean read?): only if the read predates `0029`'s apply. This
PR's read runs after it.
Q2 (locks): `SHARE UPDATE EXCLUSIVE` held to commit; it blocks no app statement, so the order cannot
deadlock with the app. Probed on PGlite.
