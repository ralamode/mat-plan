# The import pins key each name by where it is defined, and a restricted name is only ever called

Tech debt: "The import pins hold names by barrel and by direct import, not by origin" (closed).

### Changed

- `apps/web/test/program-imports.test.ts` traces each name `packages/db/src/index.ts` publishes
  through its re-export graph (`originsOf` in `apps/web/test/import-graph.ts`) to the file and
  name that define it, and keys every restriction on that origin. A lane P writer re-published by
  another barrel under a new name is still lane P's; an ownership helper or an `OVERRIDES` name
  keeps its row under any name. A name whose origin cannot be traced fails closed.
- In a file a row permits (the program and day DALs, `lib/dal/entries.ts`), a restricted name is
  used only as the direct callee of a call. Exporting it, putting it in an object, handing it to a
  wrapper (`cache(s)`), assigning it, `.bind`, `.call`, `.apply`, a spread or a return is refused.
  The real tree had no such use.
