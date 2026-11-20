# The program-tables import pins compare resolved files, and run only when their scope changed

Tech debt: "The program-tables guard reads imports with regexes, so an unusual spelling slips past"
([plan](../plans/td-program-tables-import-graph.md)).

### Changed

- The import pins of three test files are one guard, `apps/web/test/program-imports.test.ts`, with
  one `ALLOWED_IN` table. Each specifier is resolved the way TypeScript resolves it
  (`importsOf` in `apps/web/test/source-scan.ts`), so a comment in the braces, a backtick,
  `require (`, a dot segment, a `node_modules` path or an `@/` walking out of `apps/web` lands on
  the same file and gets the same answer. A first-party specifier that does not resolve, a computed
  import and a loader the graph cannot follow (`require.context`, `createRequire`, …) fail closed.
- New rows: `packages/db/src/index.ts`'s runtime closure has no edge into `erasure/`; no non-test
  file reaches a test file; `packages/shared` and `packages/engine` reach no `packages/db` file.
  The premises the resolver rests on (the `@/` alias, the resolution options, `exports`, no
  `"imports"`, no bundler alias in `next.config.ts`) are assertions.
- `program-tables-stay-dark.test.ts` keeps the table shapes and the privacy-docs test, unscoped.
  `lib/dal/day/importers.test.ts` is deleted, and `lib/dal/entries.test.ts`'s importer pin with it.
- The guard is scoped: CI's new `run_import_pins` flag and the pre-push hook skip it only when
  `importPinsInScope` (`.github/scripts/changed-scopes.mjs`) finds no changed file it reads. Every
  run on `main` runs it.
- Two holes the regex guard also had stay open, as a new low tech-debt row: names are held by the
  name imported, not by origin, and a DAL could pass a writer on through a local binding.
