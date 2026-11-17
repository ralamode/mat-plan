- **2026-11-16** — **OPS-2 is planned: production's seed will write reference data only, and the plan
  says exactly what lets a seeded household be deleted** ([plan](../plans/ops-2-split-the-seed.md)).
  `migrate.yml` seeds production on every push, and since FAM-1 step 1 (#432) that seed no longer
  writes the program, but it still writes the seed household and three fixture profiles. So a deleted
  seed household comes back or wedges the job, ramp targets would reach every household's kids, and
  the fixture athlete added for the archive specs is in the live app. Two PRs: the household, the
  profiles and the ramp expansion move under #432's `fixtures` flag, and a soft-delete correction
  removes the fixture athlete. Drafted 2026-11-13, refreshed onto #432 and panelled before
  implementation; no code changes here.
