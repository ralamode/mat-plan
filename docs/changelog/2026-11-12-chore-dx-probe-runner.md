- **2026-11-12** — **`pnpm probe`: the probe discipline is a command with a self-test, not a
  convention** ([lessons.md](../lessons.md) → "A mutation probe reported GREEN…"). The rule — tell
  red, green and DID-NOT-RUN apart; never aim a `git checkout` at a dirty file — has been written
  down since #367 and was violated **three more times in one session**, each time by an ad-hoc
  `git checkout -- <file>` that reverted work never committed, twice leaving the probes that followed
  to report RED against a tree with nothing left to test. The runner snapshots the whole tree with
  `git stash create` (the stash **stack** untouched — worktrees share it), restores the probed file
  from **that snapshot rather than from `HEAD`**, and verifies the restore byte for byte; it refuses a
  dirty file by default, reports GREEN as a defect, treats a gate that cannot spawn as DID-NOT-RUN,
  and takes `--expect` so "red for the right reason" is checkable. Eleven self-test assertions in
  `guards:test`, and the runner was used on **itself** to prove the one that matters: swap the
  snapshot restore for a `HEAD` restore and the uncommitted-work case goes red. Also names the
  pattern seven of this session's findings shared — a proof whose expectation is derived from the
  thing it proves — with the two shapes it takes and the habit that catches each.
