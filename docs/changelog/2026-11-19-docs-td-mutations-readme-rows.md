- **2026-11-19** — **Every mutation patch has its README row, and a test keeps it that way.** Six
  patches (326–329, 500–501, from OPS-2) reached the mutation gate with no row saying what each one
  breaks and which assertion must go red. The rows are added, and
  `packages/db/scripts/mutations-readme.test.ts` fails if a patch has no row, a row names a patch that
  does not exist, or a patch is listed twice.
