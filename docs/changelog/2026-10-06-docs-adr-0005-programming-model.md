- **2026-10-06** — **ADR 0005: workouts become data, and the Authoring milestone is "edit what
  exists"** ([ADR](../decisions/0005-programming-model.md)). The program had no write path at all —
  changing one prescribed load meant editing TypeScript and deploying — because a workout is not a row:
  it is implicit in `(block_id, day_role)`, and `day_role` is a frozen CHECK. The ADR settles the model
  in eight decisions and defers scheduling to its own ADR. Two adversarial rounds across five lenses
  withdrew the first draft entirely: versioning was an abstraction before its first use (replaced by a
  prescription snapshot the export has been asking for), the metric retirement was under-counted by a
  milestone, and three claims the code contradicted were corrected. Round 2 found that `db:seed` runs on
  every push to `main` and would silently re-insert a removed prescription, which is why the milestone
  is not additive-only. Also files OBS-1/2/3 (observability, synthetic monitoring, analytics+consent),
  TEST-1/2 (four untested write surfaces; fixture personas from production shapes, never its data),
  UI-1 (the form becomes the day) and SET-1 (preferred units).
