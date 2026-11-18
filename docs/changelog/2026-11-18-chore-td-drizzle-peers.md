- **2026-11-18** — **A dependency update is much less likely to split the database library into two copies**
  (tech-debt entry paid off). The web app now declares the three database packages the shared
  database code uses (`pg`, `@types/pg`, `@electric-sql/pglite`) at the same versions, so an automatic update bumps both together, as long as the two manifests keep naming the same versions (nothing checks that yet). Before, an update to one of them could leave two copies of the same
  database library installed, which failed the build in files the update never touched. No code
  changes; the lockfile gains three entries and still resolves one copy.
