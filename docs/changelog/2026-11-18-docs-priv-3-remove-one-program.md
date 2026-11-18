- **2026-11-18** — **PRIV-3: a runbook for removing one program, workout or typed item on request**
  (FAM-1 7b's H7; the maintainer chose (a) on 2026-11-18). `docs/runbooks.md` gains "Remove one
  program, workout or typed item on request".
  - It uses the household delete's confirmation, pause and restore point.
  - It resolves the target inside the requester's household and locks it before the re-check.
  - It stops on any row of another household, the household delete's (a) and (d)–(h) shapes. It also
    stops on a typed item that a log, live or hidden, or a live workout item still names.
  - It tells the household what stays:
    - who is on the program (an adult athlete on it is told on their own channel);
    - who trained on it, whose logs stay with the text frozen onto them;
    - copies of its workouts in its other programs;
    - items only it used.
  - The deletes follow the household delete's order, keeping its fail-closed `AND` scopes.

  Also, "Erase one athlete" step 4b's "Remove both" now skips a copy's program that another athlete is
  on, as it already skipped one someone trained on, and locks the chosen programs first. Before this,
  an athlete assigned to the copy's program who had never trained on it made the erasure abort `23503`
  and roll back. `data-inventory.md` §5 and §8 gain the new path. Docs only; `PRIV-3` scripts and
  proves the per-item order later.
