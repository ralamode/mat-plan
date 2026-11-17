# The program-tables guard sees every way into the database package

FAM-1, lane P. `apps/web/test/program-tables-stay-dark.test.ts`, which keeps lane P's writers and
reads inside the program and day DALs, missed four ways of reaching them. Each would have passed:

- `require('@mat-plan/db')`, now refused anywhere in `apps/web`, as `import()` already was;
- a relative path into `packages/db/` or a deep `@mat-plan/db/…` import, now refused anywhere in
  `apps/web`, so every import of the package goes through its name, which the other checks read;
- a `.mts`, `.cts`, `.js`, `.jsx`, `.mjs` or `.cjs` file, now scanned along with `.ts` and `.tsx`;
- an import placed between a string that opens a comment and one that closes it, which the
  comment-stripper removed. The import checks now read each file as written.

Each form has a case that fails without the change.
