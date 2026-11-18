- **2026-11-18** — **PRIV-3: a runbook for removing one program, workout or typed item on request**
  (FAM-1 7b's H7, decided (a) by the maintainer, 2026-11-18). `docs/runbooks.md` gains "Remove one
  program, workout or typed item on request". It has the household delete's confirmation, pause and
  restore point. It stops on another household's row, and on a typed item that a log or a live workout
  item still names. It reports what the household is told before anything goes: who is on the program,
  who trained on it (their logs stay), copies in its other programs, and items only it used. The delete
  order is the household delete's, restricted to the one program, workout or item. Also, "Erase one
  athlete" step 4b's "Remove both" now lists the other athletes assigned to the copy's program, and
  deletes their assignment rows before the block. Before this, an athlete assigned to it who had never
  trained on it made the erasure abort `23503` and roll back. Docs only; `PRIV-3` PR 3 scripts and
  proves the per-item order.
