# Stopping `pnpm db:mutations` no longer leaves a mutation patch in source

`packages/db/scripts/mutations.mjs` used to leave its current patch applied to tracked source when it
was stopped (Ctrl-C, `SIGTERM`, `kill -9`), and its `db:verify` kept running. Now:

- On Ctrl-C, `SIGTERM` or `SIGHUP` it restores the file from its pre-patch bytes, not from `HEAD`, so
  uncommitted work is kept. It also ends the whole `db:verify` process tree.
- After a `kill -9`, the next run restores from a journal, or `--recover` does only that. It never
  overwrites a file that was edited meanwhile.
- It refuses a second run in the same worktree.

`mutations.test.sh` (32 checks, in `guards:test`) proves each case. Plan:
[dx-mutations-kill-safe](../plans/dx-mutations-kill-safe.md).
