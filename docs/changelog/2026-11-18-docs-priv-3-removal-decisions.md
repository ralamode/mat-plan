- **2026-11-18** — **PRIV-3: removing one program, workout or item first says who it affects and
  offers rename or take-off instead.** The maintainer's decisions of 2026-11-18 are applied to
  `docs/runbooks.md` → "Remove one program, workout or typed item on request".
  - **Q8:** there is no pause, and the restore branch is held 3 days.
  - **Q9:** an adult athlete on the program is told first and cannot cancel.
  - **Q10:** a typed item that a log names is refused, and the household is told which athletes.
  - **The principle:** one member's request should not change other athletes' data or hurt later
    reporting. Step 0 now does four things before anything is removed:
    - names every athlete with an assignment to, or a log naming, the target;
    - offers the change that touches nobody's data first (rename, or take everyone off the program);
    - removes only on explicit acceptance;
    - never deletes or orphans a log row: logs keep their frozen names.
  - **Q7:** the `OPS-3` drill gates deletions of an outside family's data only. "Delete a household"
    and "Erase one athlete" now say so.

  `priv-3-guarded-deletion.md` records Q7–Q10 and the principle, verbatim, and `docs/plan.md`'s `PRIV-3`
  row holds any later in-app removal to the principle. Docs only.
