- **2026-11-19** — **The database client packages have one version, set in one place.** `pg`,
  `@types/pg` and `@electric-sql/pglite` are declared by both the web app and the database package;
  since #622 that kept a dependency update from splitting the database library into two copies, but
  only while the two files named the same versions. Both now say `catalog:`, and the versions live
  once in `pnpm-workspace.yaml`. Nothing installed changes.
