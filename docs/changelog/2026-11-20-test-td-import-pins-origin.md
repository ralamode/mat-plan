# The import pins key each name by where it is defined, and a restricted name is only ever called

Tech debt: "The import pins hold names by barrel and by direct import, not by origin", narrowed
to one remaining case (below).

### Changed

- `apps/web/test/program-imports.test.ts` traces each name `packages/db/src/index.ts` publishes
  through its re-export graph (`originsOf` in `apps/web/test/import-graph.ts`) to the file and
  name that define it, and keys every restriction on that origin. A lane P writer re-published by
  another barrel under a new name is still lane P's; an ownership helper or an `OVERRIDES` name
  keeps its row under any name. A value alias (`export const persist = saveWorkout`, `.bind`, a
  local `const`, `ns.x`, a destructured or `export import` binding) is traced like a re-export. A
  name the walk cannot trace, a name it did not publish, and an `export * as ns` of a module holding
  a restricted name fail closed; a test holds the walk's names equal to the TypeScript checker's.
- The walk reads exports and initializers, so it is backed by one structural pin: inside
  `packages/db/src`, every file that publishes a restricted name has exactly the importers, and the
  kinds of import, it has today (`DB_IMPORTERS`). A new importer fails the guard whatever it then
  does with the writer: a later reassignment, `Object.assign`, a function or namespace body, an
  alias of a namespace import.
- In a file a row permits (the program and day DALs, `lib/dal/entries.ts`), a restricted name is
  used only as the direct callee of a call. Exporting it, putting it in an object, handing it to a
  wrapper (`cache(s)`), assigning it, `.bind`, `.call`, `.apply`, a spread, a return or a class's
  `extends (…)` is refused. The real tree had no such use.
- Still open, as a narrowed low tech-debt row: a DAL can forward a writer through a wrapper function
  (`(...a) => saveWorkout(...a)`), the same shape as the allowed `cache(async (id) => …(id))`.
