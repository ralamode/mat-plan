- **2026-11-20** — **On the preview route, a program's name on the day page is a link**
  ([guide](../features/program-contract.md), invariant 11; FAM-1 plan D49). The preview harness now
  passes the programs line its link, as the real page does from 15c PR 3. The preview has no
  `/programs/<id>`, so a name opens the preview's Program page for that program, or its Programs
  list when the fixtures hold no page for it (`programPreviewHref` in `preview-registry.ts`). Every
  link is a state the route lists, so the preview's accessibility walk measures each one. Nothing a
  family sees changes: this is the preview route only.
