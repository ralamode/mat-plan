- **2026-10-03** — **V1-24 PR 1e: a weigh-in's conflict is decided by the day, not the device**
  ([plan](../plans/v1-24-form-is-the-day.md)). The bodyweight create moved to
  `insertBodyweightEntry` in `packages/db` and uses target-less `ON CONFLICT DO NOTHING`, so every unique
  index on `entries` is an arbiter: a replay of the same submit answers its own entry, another device's
  weigh-in on a taken day answers the typed "already logged" envelope (never a silent success), and a
  no-op that is neither throws. It cannot fail index inference, and a concurrent re-POST waits instead of
  raising `23505`, so 1d's interim catch is gone. The replay lookup is now scoped to the profile, so a
  crafted `client_id` can no longer return another profile's entry. Proven in `db:verify` through the
  app's own statement. Merges only after 1d's migrate run is green; the `context` stamp and CHECK move to
  V1-32.
  Review round: the replay lookup is also pinned to weigh-ins (a reused check-in `client_id` is never
  answered with that row), with three more `db:verify` proofs, and a two-connection probe on real
  Postgres confirmed the concurrent cases (blocked, then `dayTaken` / the replay's id / insert after a
  rollback; never a `23505`).
