- **2026-11-19** — **Adding an athlete or a program item no longer waits indefinitely behind a stuck
  request.** Both adds take a per-household lock so that simultaneous adds are counted one at a
  time. Until now a second add would wait on that lock for as long as the first one held it; it now
  gives up after five seconds with an error, the same bound the guarded data corrections already
  use. `db:verify` checks that the bound is set for both, and mutation patches `447` and `448` prove
  each check can fail.
