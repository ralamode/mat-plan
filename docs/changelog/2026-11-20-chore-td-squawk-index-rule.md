# A new migration's index on an existing table must state why it is safe without CONCURRENTLY

Tech debt: "Squawk lints new migrations only", its CONCURRENTLY half closed (maintainer, 2026-11-20).

### Changed

- `.squawk.toml` no longer excludes `require-concurrent-index-creation`. `CONCURRENTLY` cannot run
  inside drizzle's single migrate transaction, so a new migration's plain `CREATE INDEX` on a table
  that already exists fails Squawk unless the line directly above it is
  `-- squawk-ignore require-concurrent-index-creation`, with the reason above that. An index on a
  table the same file creates is not flagged.
- AGENTS.md's Database rules, the `db-migration` skill and the definition of done say so, replacing
  "Indexes CONCURRENTLY", which no migration could follow.
- The 27 indexes in 0001–0026 that the rule now names are never linted (Squawk lints added files
  only). They stay listed in `docs/tech-debt.md`, now 47 findings under the repo's config.
- No open PR adds a migration, so none goes red.
