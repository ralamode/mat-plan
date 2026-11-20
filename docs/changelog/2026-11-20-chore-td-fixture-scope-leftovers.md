- **2026-11-20** — **Leftovers from retiring the old log forms are gone.** The screenshot script's
  `fixtureScope` lost its last caller when FAM-1 12f deleted the fixture writers. It is removed, and
  with it `scope.test.ts`'s named allowance for that file, so the household-scope guard is absolute
  again: exactly one module derives a scope. Comments that still named it, said the old form's
  `isEditableSet` mirrored the edit guard, or pointed at `resolveDayRole` are corrected, and the
  tech-debt entry that waited on `PICK-1` PR 4 (whose mount target, the strength form, is gone) now
  says where it does belong.
