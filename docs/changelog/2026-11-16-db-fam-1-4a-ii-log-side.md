- **2026-11-16** — **FAM-1 step 4a-ii: a logged row can name its prescription set, and a session its workout**
  ([plan](../plans/fam-1-family-program.md) D3, §3, §5 lane A; ADR 0007 Amendment 2 §6 and Amendment 3).
  Migration `0024` adds `sessions.workout_id` and `workout_name` (the workout's name frozen at log
  time) with one live session per profile, day and workout; `supersets.prescription_group` with one
  live superset per session and group; and `entries.prescription_id` and `prescription_set` with one
  live row per session, prescription and set, so a second device's ✓ or an offline replay cannot
  twin a row, and un-ticking frees its place. `uq_entries_superset_order` now covers only rows with
  no prescription set, so two sets of one superset member, and a purge of their prescription, both
  commit. `db:verify` proves each arbiter, the one-way CHECKs, the purge, and three audits for the
  pointers no constraint holds; mutations 52–54 prove the proofs can fail. The household delete's
  pre-flight gains (f) and (g), with their remedies. Nothing writes the new columns until step 11b.
