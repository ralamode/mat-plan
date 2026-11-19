- **2026-11-19** — **The erasure core's timeouts proof can now fail.** The last migration and the seed
  leave the session's `lock_timeout` and `statement_timeout` at the values `setLocalTimeouts` sets, and the verify database has one session, so
  the proof that it sets them read back values it had not set. It now resets both
  first, checks the values inside and after a rolled-back transaction, and puts the session back. A
  new mutation (335, the function sets nothing) is red on it; the old proof stayed green.
