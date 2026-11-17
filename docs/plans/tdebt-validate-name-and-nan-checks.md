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

| File                                                                 | Change                                                                                                                                                                                                                                                                                                                    |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/db/migrations/0031_tdebt_validate_name_and_nan_checks.sql` | `drizzle-kit generate --custom` (no schema change, as `0016` and `0028`), then four `VALIDATE CONSTRAINT`, in `0029`'s order, after `SET lock_timeout = '5s'` and `statement_timeout = '60s'`. The header gives the locks, the merge condition and the recovery.                                                          |
| `packages/db/scripts/verify/schema.ts`                               | (a) asserts each of the four is validated, one assertion per constraint. (c) shows, on a planted violator under a re-added `NOT VALID` CHECK, that its soft delete is refused and that `VALIDATE` refuses it by name.                                                                                                     |
| `packages/db/scripts/mutations/`                                     | `208` deleted (once validated it cannot go red). `216`–`219` each drop one `VALIDATE` and go red on that constraint's own message.                                                                                                                                                                                        |
| `packages/db/src/schema.ts`                                          | Comments only: "0029 NOT VALID, validated by 0031". Also two comment corrections asked for by other lanes (the assignments docblock names `programOrderSchema` as what refuses a repeat; a quantity's docblock says rows are inserted only by `insertEntrySetRows`, alongside their sets, and an amend updates in place). |
| `docs/tech-debt.md`                                                  | Both entries deleted (the file's rule: a paid-off entry is deleted).                                                                                                                                                                                                                                                      |
| `docs/runbooks.md`                                                   | `0031` added to the "a migration failed" list. The `lock_timeout` line no longer hard-codes 5 s.                                                                                                                                                                                                                          |
| `docs/features/programming.md`, `program-contract.md`                | The name CHECK covers every row now.                                                                                                                                                                                                                                                                                      |

## Merge condition

The maintainer re-runs a read-only production read **after `0029` applied**. It must show 0
violators of each CHECK and 4 constraints still awaiting validation. Since `0029`, every insert and
update was already checked, so a read taken after it covers exactly the rows `VALIDATE` scans. The PR
body records the result. The query, one read-only `SELECT`, is the one to run against any database
whose `0031` fails with `23514` (which names the constraint and table, never the row); a non-zero
`*_violators` column says which CHECK, and the same predicate selects the row to repair:

```sql
SELECT
  (SELECT count(*) FROM program_blocks WHERE (char_length(btrim(name)) >= 1 AND char_length(name) <= 60) IS FALSE) AS program_name_violators,
  (SELECT max(char_length(name)) FROM program_blocks) AS longest_program_name,
  (SELECT count(*) FROM program_blocks WHERE char_length(btrim(name)) = 0) AS blank_program_names,
  (SELECT count(*) FROM entries WHERE (value_num IS NULL OR (value_num >= 0 AND value_num <> 'NaN')) IS FALSE) AS entries_value_violators,
  (SELECT count(*) FROM entry_set_quantities WHERE (value_num <> 'NaN') IS FALSE) AS quantity_nan_violators,
  (SELECT count(*) FROM ramp_targets WHERE (target_value <> 'NaN') IS FALSE) AS ramp_target_nan_violators,
  (SELECT count(*) FROM pg_constraint WHERE conname IN ('program_blocks_name_length_check','ramp_targets_target_value_not_nan_check','entries_value_num_check','entry_set_quantities_value_num_not_nan_check') AND NOT convalidated) AS checks_awaiting_validation,
  (SELECT count(*) FROM program_blocks) AS program_blocks_rows,
  (SELECT count(*) FROM entries) AS entries_rows,
  (SELECT count(*) FROM entry_set_quantities) AS quantity_rows,
  (SELECT count(*) FROM ramp_targets) AS ramp_target_rows;
```

Go: every `*_violators` = 0, `checks_awaiting_validation` = 4, `longest_program_name` ≤ 60,
`blank_program_names` = 0.

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

PR-stage lens, DB-safety and correctness (Opus, 2026-11-17, on #535): no P0.

| #   | Sev | Finding                                                                                                                                                                                                                                          | Response                                                                                                                                       |
| --- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 8   | P1  | The quantity docblock's "inserted only when its parent entry was freshly created" is still false: the `kb-swings-2026-09-28` correction inserted a quantity on an existing set, and 11c's planned revive writes a new set under a revived entry. | **Taken.** It now says rows are inserted only by `insertEntrySetRows`, alongside their sets, and names the correction's `crypto.randomUUID()`. |
| 9   | P2  | The `programOrderSchema` wording credits the schema for both lists (only `ProgramOrder` has the refine), and "the schema itself allows two" then reads as contradicting it.                                                                      | **Taken.** `ProgramOrder` is refined; the reader builds `currentPrograms` one per program; "the table itself allows two".                      |
| 10  | P2  | Three header claims are not quite true: "no schema.ts change" (comments change), autovacuum always cancels (not anti-wraparound), and "tiny tables" is a production fact.                                                                        | **Taken**, all three, before the file becomes permanent.                                                                                       |
| 11  | P2  | The PR body says a `23514` names the row (it names the constraint and table), and the violator query lives only in the PR body.                                                                                                                  | **Taken.** Body corrected; the query is above, and the runbook line points here.                                                               |
| 12  | P2  | One lens hardened the plan; the rule asks for three.                                                                                                                                                                                             | **Taken.** This lens, and the fresh second pass below (#14–#18).                                                                               |
| 13  | P2  | `isValidated` matched on `conname` alone, which is unique only per relation.                                                                                                                                                                     | **Taken.** Scoped by `conrelid = table::regclass`.                                                                                             |

Fresh second pass, correctness and tests (Opus, 2026-11-17, on #535 after the merge of main, given the code and not the earlier verdicts): no P0, no P1. It found the SQL, the `db:verify` changes and the mutations correct.

| #   | Sev | Finding                                                                                                                                                     | Response                                                                                                                               |
| --- | --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 14  | P2  | The PR body still said a `23514` names the row.                                                                                                             | **Taken.** The body says it names the constraint and table.                                                                            |
| 15  | P2  | Other body lines were stale after #8–#10 and the merge of main (the docblock wording, autovacuum's caveat, the patch count).                                | **Taken.** Updated, with the count re-run on the merged head.                                                                          |
| 16  | P2  | The header's repair guidance was wrong for a blank name (trimming leaves it blank) and silent on a NaN quantity or ramp target, whose columns are NOT NULL. | **Taken.** All four cases are named.                                                                                                   |
| 17  | P2  | The changelog stated the read's result while the body said it was pending.                                                                                  | **No change needed.** The maintainer's read came back clean (2026-11-17) before this PR was marked ready, so the sentence is now true. |
| 18  | P2  | #12 pointed at a pass not in this file.                                                                                                                     | **Taken.** This table.                                                                                                                 |
