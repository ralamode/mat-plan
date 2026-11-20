# The program-tables import pins: a plan to read the TypeScript import graph

Tech debt: "The program-tables guard reads imports with regexes, so an unusual spelling slips past".

- Plan: [`td-program-tables-import-graph.md`](../plans/td-program-tables-import-graph.md). The import
  pins move from text-matching regexes to imports resolved by TypeScript's own resolver, so the pins
  compare the files an import reaches, not how it is spelled. Panelled by five lenses on an earlier
  ESLint route, then by a security lens on this one.
- The guard runs only when a changed file is in its scope, and on any doubt (maintainer,
  2026-11-20).
- Implementation follows on this branch once the plan is approved.
