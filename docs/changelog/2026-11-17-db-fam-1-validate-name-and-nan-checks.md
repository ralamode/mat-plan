# A program's name is bounded and a logged value refuses NaN on every row, old ones included (PR 2 of 2)

Lane A tech-debt, migration `0031`: validates the four CHECKs `0029` added `NOT VALID`
(`program_blocks_name_length_check`, the `entry_set_quantities` and `ramp_targets` NaN checks, and
`entries_value_num_check`), after a read-only production read found no existing row violating any of
them. Plan: [tdebt-validate-name-and-nan-checks](../plans/tdebt-validate-name-and-nan-checks.md).

- `db:verify` asserts each is validated, and shows that `VALIDATE` refuses a violator by name.
  Mutations `216`–`219`; `208` deleted.
- Both [tech-debt](../tech-debt.md) entries are paid off and deleted.
- The runbook's "a migration failed" list covers `0031`.
