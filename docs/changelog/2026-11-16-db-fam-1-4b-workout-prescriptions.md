# A workout's items can be stored: prescriptions name their workout, with typed targets

FAM-1 step 4b, migration `0025` (expand only; nothing writes it until step 6a's save-workout writer).

- `prescriptions` gains `workout_id` (FK'd with `block_id` as a pair to `workouts`), a `client_id`
  per item, the author's `notes`, `rest_after`, and a superset place (`superset_label`,
  `superset_order`). `day_role` becomes nullable: a row names a day role or a workout, exactly one.
- New table `prescription_quantities`: a template item's typed target (one number or a range) per
  quantity slot, with the same unit guard as `entry_set_quantities`.
- Bounds pinned to the shared constants. `target_reps` and `sets` are bounded on template rows only,
  because production still holds an archived block whose reps run to 32 characters.
- `db:verify` proves every constraint and two new audits; mutations 62–73 prove the proofs can fail.
  The household delete gains step 8a, and the privacy inventory and notice say what is stored.
