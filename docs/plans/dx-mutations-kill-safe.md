# The db:mutations runner never leaves a patch applied

## Where this sits

- **Developer tooling**, no milestone. Asked for by the FAM-1 board (2026-11-17) after a killed
  `db:mutations` run left a patch in tracked source twice in one day: patch `153` in
  `writers/practice.ts` (a `pnpm verify` that exited 143) and patch `150` swept into a commit.
  [lessons.md](../lessons.md) → "Guards that pass while guarding nothing" records both.
- Roadmap alignment (2026-11-17): checked against the private roadmap; nothing to add here.

## Cause

`packages/db/scripts/mutations.mjs` applied a patch, ran `pnpm db:verify` with `spawnSync`, and
reverted in a `finally`. A signal ends the process before the `finally` runs, and the runner had no
handler. `spawnSync` also blocks the event loop, so a handler could not have run during the gate,
which is where nearly all of a run's time is spent. The gate's process tree (pnpm, tsx, esbuild,
node) also kept running after its parent died.

## What changes

| File                                      | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/db/scripts/mutations.mjs`       | A lock (one run per worktree). A journal, written before each `git apply`, holding each patched file's bytes, its hash and the hash it will have once patched (computed in a scratch directory first). A three-state restore by hash that never overwrites a file edited by someone else. The gate as an async, detached child; SIGINT/SIGTERM/SIGHUP restore first, end the group, and re-raise. Recovery at start and `--recover`. A "still applied" sweep. A byte-hash check of every touched path at exit. |
| `packages/db/scripts/mutations.test.sh`   | New self-test, 32 checks, in `guards:test`: every verdict, each signal, `kill -9` then recovery (three outcomes), a second run refused. No database: a `pnpm` shim on `PATH` stands in for `db:verify` and starts a grandchild, so the group kill is what is tested.                                                                                                                                                                                                                                           |
| `packages/db/scripts/mutations/README.md` | "Stopping a run, and what it leaves behind".                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `docs/lessons.md`                         | The entry gains the cause and the fix, and "never stop a gate by pattern".                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `package.json`, `AGENTS.md`               | `guards:test` runs the new self-test; AGENTS' count of guard self-tests is fifteen.                                                                                                                                                                                                                                                                                                                                                                                                                            |

**Not changed:** which patches run, how a verdict is reached (`.expect`, the first `AssertionError`),
and the success line. One behaviour change: `spawnSync`'s 1 MiB output cap is gone with `spawn`.

## Proof that the test can fail

Run against the runner from `main` (copied beside the test), the self-test fails 17 of its 32
checks, including "SIGTERM mid-gate: the file is byte-identical" (the bug) and "the gate AND its
grandchild are gone". Against this branch: 32 passed.

## Review-response log

Correctness lens (Opus, 2026-11-17, on the design brief, with probes of process groups under pnpm
on macOS): no P0.

| #   | Sev | Finding                                                                                                                                           | Response                                                                                                                                                                                     |
| --- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | P1  | Recovery at start would treat a LIVE run's journal as interrupted, restoring under its gate.                                                      | **Taken.** An exclusive lock; a live pid refuses, only a stale lock allows recovery. Tested.                                                                                                 |
| 2   | P1  | Writing a snapshot back blindly destroys edits made after it (in a long run, or days later at recovery).                                          | **Taken.** Three states by hash: equal to the snapshot → leave; equal to the patched bytes → write back and verify; anything else → touch nothing, fail, keep the journal. Tested both ways. |
| 3   | P1  | "Porcelain status identical" cannot see a patch left in a file that was already modified.                                                         | **Taken.** Every touched path is hashed at the start and compared at the end.                                                                                                                |
| 4   | P1  | The handler could throw on ESRCH before restoring, and could run twice.                                                                           | **Taken.** A latch; a synchronous restore runs first; the group kill is best-effort (TERM, ~2 s, KILL); the process re-raises the signal.                                                    |
| 5   | P1  | An env override for the gate command or patch directory weakens the gate (and `db:mutations` never runs in CI, so a `CI` check protects nothing). | **Taken.** No override exists. The test uses the real layout and a `pnpm` shim on `PATH`, so production's `spawn` runs unchanged.                                                            |
| 6   | P1  | A direct-child gate cannot tell a group kill from a child kill, and the verdicts were untested.                                                   | **Taken.** The shim starts a grandchild, and both pids must be gone. Every verdict, DID-NOT-RUN, SIGHUP and the three recovery outcomes are cases.                                           |
| 7   | P2  | A patch left applied with no journal was reported as "does not apply".                                                                            | **Taken.** A sweep at start names it and stops.                                                                                                                                              |
| 8   | P2  | `--git-dir` is relative in the main checkout; new, deleted or binary files are untested paths.                                                    | **Taken.** `--git-path` from the repository root; a patch that creates, deletes, renames or re-modes a file is refused (none does today). Buffers throughout.                                |

Also taken from the lens: `'error'` rejects as DID-NOT-RUN and aborts the run; wait on `'close'`;
piped stdio; the gate's pgid in the journal, ended at recovery only if it still names a pnpm. Found
outside the diff, fixed in the rewritten header: the old header claimed a staged-changes check that
did not exist, and a "Reverse-check first" comment sat on a forward check.
