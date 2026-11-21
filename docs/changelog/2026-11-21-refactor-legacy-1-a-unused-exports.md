- **2026-11-21** — **Three shared exports the old log forms left with no caller are deleted**
  (`LEGACY-1` PR A, [plan](../plans/legacy-1-retire-strength-path.md)): `readsHouseholdProgram`,
  `STRENGTH_DAY_ROLES` and the keyed `ACTIVITY_INPUT_SHAPE` map. Nothing changes for a person: the
  kid-only program read was always the inline `PROGRAM_READ_KIND` conjunct in `programDayRows`, which
  the programming guide now says. Mutation 12 is re-cut for its moved context.
