- **2026-11-19** — **The synthetic-household guard uses the shared source scanner.** It carried its own
  copy of the comment-stripping `code()` helper, the last one inside `apps/web`; it now imports
  `test/source-scan.ts`, the same as the other structural guards. The tech-debt entry narrows to the
  one copy left in `packages/db`.
