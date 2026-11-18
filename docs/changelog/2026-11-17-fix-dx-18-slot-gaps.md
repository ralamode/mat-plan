- **2026-11-17** — **A heavy run's slot stays held until everything it started has exited** (`DX-18`,
  the three gaps #576 left open, fixed at the maintainer's direction):
  - `e2e:local` and `screenshot:ephemeral` re-run themselves under the slot wrapper, which records
    the run's process group. Killing the runner with `kill -9` no longer frees the slot while
    Playwright or Postgres keep running in that group; the wrapper waits for the group to empty, says
    which group, and a Ctrl-C then ends it. A busy run names a leftover group and the command that
    ends it. A child started `detached` (screenshot's `next start`) is outside the group.
  - A closed terminal (SIGHUP) reaches the run as SIGTERM, and `e2e:local` tears down on it, so
    Postgres no longer survives it.
  - Ctrl-Z no longer stops the wrapper while it has the slot, so the slot is released on time. The
    shell may still report the job suspended, because pnpm and tsx do stop: `fg` it.
  - A steal guard left by a crashed run is broken atomically: it is moved aside, then checked, and a
    guard someone retook in between is put back.

  `heavy-slot.test.sh` gains cases for each. No roadmap item moved.
