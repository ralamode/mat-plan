- **2026-11-15** — **FAM-1 step 3: every item has a tracking type, and a session can be a workout**
  ([plan](../plans/fam-1-family-program.md) §2, §3, D1, D6, D25). Migration `0022` adds
  `movements.tracking_type` (one of the seven `TRACKING_TYPES`, default `weight_reps`, CHECK-pinned)
  and types the 35 built-in items once, by slug: bodyweight items log Reps, the hollow-body hold logs
  Time per set, the broad jump logs Distance, and loaded lifts keep Weight × reps. The typing touches
  only global rows still at the default, so it never retypes a household's own item, and a second run
  changes nothing. `sessions_session_type_check` now admits `workout`. In `packages/shared`:
  `SESSION_TYPES` gains `workout` while `DAY_ROLES` spreads the unchanged `LEGACY_SESSION_TYPES`; the
  `workout_item` activity type; the unit `mi` (CSV spelling `mi`, ceiling 100); `(primary, count)` as
  a quantity slot, with a `count` ceiling equal to the rep cap. The old strength form still offers
  mass, length and time only. `findOrCreateTypedMovement` writes a type only when it creates an item,
  and returns an existing one with its own type. `db:verify` runs the migration's typing statement
  from its file against rows at the default; mutation patches 42 and 43 prove those proofs can fail.
  Production behaviour is unchanged until a screen writes a type.
