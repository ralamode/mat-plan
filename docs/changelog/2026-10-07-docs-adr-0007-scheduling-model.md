- **2026-10-07** — **ADR 0007: the scheduling model is decided, and most of it is deliberately not
  authorized** ([ADR](../decisions/0007-scheduling-model.md)). The five questions
  [beta-1 §3b](../milestones/beta-1.md) deferred, settled with their alternatives recorded: recurrence
  is a **weekday set as rows** and `daily` is seven rows, not a kind — RRULE rejected on cost (the tree
  owns zero date dependencies), on model mismatch (it recurs over instants; this app schedules bare
  local dates) and because it cannot answer the live program's actual question, which is _which_ A/B
  variant rather than whether today is due. Rotation becomes **an anchor plus an ordered slot list on
  `program_blocks`** and stays **calendar-indexed** — the maintainer's override is preserved, and the
  anchor sits on the block rather than the assignment so one program cannot get N phases and
  desynchronize co-training siblings. `day_role` **splits in two**: a `workouts` row on the authored
  side, frozen **slug text** on the logged side, because an FK to a household-editable name would
  rewrite the CSV's `session_type` column for every past session — the defect
  `entries.prescribed_snapshot` exists to prevent, one column over. Dueness is **derived**; the day's
  verdict is **recorded and snapshots the dueness it judged**, at a boundary derived from
  `WRITABLE_DAY_RADIUS` (plus one day, because `getActiveLocalDay()` is per-device until
  `households.timezone` lands), which closes both of SCHED-1's open questions and keeps every CSV byte
  untouched.
  **The headline is the restraint.** A five-lens engineering panel returned **fourteen blocking
  findings** and the first draft was withdrawn: it authorized five tables and a `DROP COLUMN` on live
  data on the strength of deciding a shape. Two tables are now authorized — the assignment row and the
  weekday rows — and three need their own backlog row, because the `workouts` arc is **six PRs** whose
  first two make the feature it claimed to unblock unexecutable, and because `DAY_ROLES` has ten members
  while `PROGRAM_SEED` uses two, so a household can already add eight more days with zero schema change.
  `MOT-1` now ships **with** the verdict table rather than behind a derived-only era that the panel
  showed cannot be safe. V1-22 **A4 splits in two** and the **active-block marker its spec promised is
  withdrawn**. Also corrected here: `docs/architecture.md` §2d and the `docs/tech-debt.md` schedule row
  both still described the `DAY_ROLE_BY_WEEKDAY` weekday map deleted in #151. ⚠️ **After beta** — it
  unblocks Beta 1 rows (`SCHED-1`, `MOT-1`, V1-22 A4), not the Beta 0 critical path, and `CAT-2` was
  never gated on it.
