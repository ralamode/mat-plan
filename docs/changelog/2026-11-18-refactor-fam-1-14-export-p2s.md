- **2026-11-18** — **FAM-1 14a follow-ups: the export's last step is proved with the rest, and one
  session-owner check** (from #582's review; the maintainer's P2 rule, defaulted to fix). The
  `prescribed` resolution (`resolvePrescribed`, `rolesNeedingLiveMatch`) moves from `apps/web/lib/csv/`
  to `packages/db/src/queries/export-prescribed.ts`, beside the fold, so `db:verify`'s export proof fills
  `prescribed` through it (its own unit test still pins the `??` that matters). "The entry's session is its own athlete's" is one named condition,
  `entrySessionIsItsAthletes()`, which Change's locked read and the export's sessions join share.
  Mutations 350, 351, 358 and 365 are regenerated, each against its own call site. The export's
  error context names the day, and never the movement's slug, which can carry typed text.
