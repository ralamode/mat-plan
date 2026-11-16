# A program's name is bounded, and a logged value can no longer be NaN (PR 1 of 2)

Lane A tech-debt, a migration adding four CHECKs `NOT VALID` (enforced on every new or updated row;
the next PR validates existing rows after a second production read):

- `program_blocks_name_length_check`: a program's name is 1 to `PROGRAM_NAME_MAX` (60) characters,
  as a workout's name already is.
- `entry_set_quantities` and `ramp_targets`: NaN refused, beside the existing `>= 0` checks, which
  admit it (`'NaN' >= 0` is true in Postgres).
- `entries_value_num_check`: a logged reading (a weigh-in, a check-in, wake or practice minutes) is
  NULL, or non-negative and not NaN; the column had no range check at all.
- `db:verify` proves each refusal by name and that NOT VALID still refuses updating an existing bad
  row; mutations 208–215.
