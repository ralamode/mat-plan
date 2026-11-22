- **2026-11-21** — **The legacy strength DAL is deleted** (`LEGACY-1` C1,
  [plan](../plans/legacy-1-retire-strength-path.md)): `logStrengthSession` and `editStrengthSet`
  in `apps/web/lib/dal/entries.ts`, with their tests. Nothing in the app had called either since FAM-1
  12f. The catalog-write-order test is retired deliberately with a record in its place; `TEN-2b-1`
  closes as overtaken, and `TEN-2b-2` is re-scoped, since its "unreferenced movement" predicate would
  now match items `newItem` makes on purpose. The writer and the schemas below go in C2.
