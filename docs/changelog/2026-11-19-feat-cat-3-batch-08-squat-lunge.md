- **2026-11-19** — **The movement library gains 50 squat and lunge movements** (`CAT-3`, catalog
  batch 8; [spec](../specs/cat-3-movement-library.md)): barbell, dumbbell, kettlebell, machine and
  bodyweight squats, split squats and Bulgarian split squats, forward, reverse, walking and lateral
  lunges, step-ups, and single-leg squats. Each entry was written in-house and approved by the
  maintainer row by row.

  Where people log a movement two ways, it gets two entries whose names say which (spec rule 10), for
  example Walking lunge (reps) and Dumbbell walking lunge (weight × reps). One entry, the overhead
  squat, is "Learn with a coach present", and its steps name the coach (K17). Four entries share a
  slug with an old built-in (Back squat, Front squat, Walking lunge, Bulgarian split squat), so the
  picker shows the library's taxonomy and "How to" on those rows until the fresh start (K22).

  The entries are in `packages/shared/src/catalog/data/batch-08.ts`, with their lines added to
  `shipped.json` and `approved.json`. No roadmap item moved.
