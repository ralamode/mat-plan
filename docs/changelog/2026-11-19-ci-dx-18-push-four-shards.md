- **2026-11-19** — **A push to `main` runs the mutation proof in 4 shards, not 8** (`DX-18`). Eleven
  queued `main` runs, each starting 8 shards of 7–14 minutes, had every pull request waiting behind
  them. Four shards still run every patch, so each push is still checked in full and a red run still
  sits on the commit that caused it; it just takes fewer, longer jobs. Pull requests already ran 4.
