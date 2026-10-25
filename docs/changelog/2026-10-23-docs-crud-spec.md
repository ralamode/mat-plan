- **2026-10-23** — **CRUD-1 is specced, prototyped and planned, and it split into two milestones.**
  [The spec](../specs/crud-1-fix-it-yourself.md) holds 51 acceptance criteria. Eight rounds of maintainer
  review against a 360px prototype ([docs/prototypes/crud-1/](../prototypes/crud-1/index.html), v8
  approved) split it into [CRUD-1 — fix it yourself](../milestones/crud-1-fix-it-yourself.md) (athletes,
  delete and restore, the movement picker, rename) and
  [PROG-1 — programs and scheduling](../milestones/prog-1-programs-and-scheduling.md). Eleven plans each
  went through the engineering panel, plus the three UX lenses where a person sees the change, and a
  round-2 re-review wherever a blocker reshaped a plan. **What the panels changed most:**
  - ASSIGN-1 and RETIRE-1 now share one contract, so every writer refuses to reopen a period onto an
    archived program, and a retry after Undo replays rather than re-archiving.
  - The archive panel stages Take off and saves it with one Archive, so one Undo restores everyone.
  - PICK-1's field-by-field build would have silently dropped V1-22 chunk 2's `prescriptionId`.
  - Adding the archive column would break app-side inserts until `migrate` finished, so that PR holds the
    deploy.
    **Parallel-work gate 1 fails for every pair of lanes**: they all edit `write-path.md` or
    `programming.md`. So the lanes are orders of work, not concurrent tracks. New backlog rows: `WP-1`,
    `MOV-1`, `ASSIGN-1`, `TGT-1`, `ACT-1`. No code; implementation waits on plan approval and AUTH-1 1c.
