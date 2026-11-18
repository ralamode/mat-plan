- **2026-11-17** — **A heavy run's slot stays held until everything it started has exited** (`DX-18`,
  the three gaps #576 left open, fixed at the maintainer's direction):
  - `e2e:local` and `screenshot:ephemeral` re-run themselves under the slot wrapper, which records
    the run's whole process group. Killing the runner with `kill -9` no longer frees the slot while
    Playwright, `next start` or Postgres keep running; the wrapper waits for the group to empty.
  - Ctrl-Z is held, with a note, while a wrapper has the slot. Before, it stopped the wrapper while
    the run underneath went on.
  - A steal guard left by a crashed run is broken atomically: it is moved aside, then checked, and a
    guard someone retook in between is put back.

  `heavy-slot.test.sh` gains cases for each. No roadmap item moved.
