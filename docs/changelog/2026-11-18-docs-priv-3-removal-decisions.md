- **2026-11-18** — **PRIV-3: removing one program, workout or item first says who it affects and
  offers rename or take-off instead.** The maintainer's decisions of 2026-11-18 are applied to
  `docs/runbooks.md` → "Remove one program, workout or typed item on request".
  - **Q8:** there is no pause, and the restore branch is held 3 days.
  - **Q9:** an adult athlete affected is told first, on their own channel, cannot cancel, and is sent
    their own copy of what is removed before the removal.
  - **Q10:** a typed item that a log names is refused, and the household is told which athletes.
  - **The principle:** one member's request should not change other athletes' data. Step 3 runs the
    stops first and tells the requester nothing until they all read 0. Then it:
    - names every athlete with an assignment to, a log naming, or a target on the target;
    - says their logs keep their frozen names but stop counting toward the program;
    - offers rename or take-off first;
    - removes only on explicit acceptance.

    The ledger entry is deleted whenever nothing is removed.

  - **Q7:** the `OPS-3` drill gates deletions of an outside family's data only; the pause still
    applies. "Delete a household" and "Erase one athlete" say so.
  - **A `40P01`:** a deadlock with an app write is re-run from the top.

  `notice.md` no longer says that nothing below an athlete can be removed. `priv-3-guarded-deletion.md`
  records Q7–Q10 and the principle, verbatim, and `docs/plan.md`'s `PRIV-3` row holds any later in-app
  removal to the principle.
