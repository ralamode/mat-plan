# Two migration-safety gaps recorded in tech-debt

Found in the review of #428 (the journal-order check).

- `drizzle-kit check` is defined but no workflow or `pnpm verify` runs it. `AGENTS.md` listed it as a
  CI gate, and no longer does. `docs/tech-debt.md` has the entry and the one-PR fix.
- The preview database, when refreshed from a branch by hand as `migrate-preview.yml` documents, can
  skip a migration main merges later, or apply a regenerated one twice. Preview is seed-only; the
  entry gives the fix.
