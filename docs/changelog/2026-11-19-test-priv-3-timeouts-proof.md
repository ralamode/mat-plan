- **2026-11-19** — **The erasure core's timeouts proof can now fail.** Every migration leaves the
  session's `lock_timeout` and `statement_timeout` set, and the verify database has one session, so
  the proof that `setLocalTimeouts` sets them read back values it had not set. It now resets both
  first, checks the values inside and after a rolled-back transaction, and puts the session back. A
  new mutation (335, the function sets nothing) is red on it; the old proof stayed green.
