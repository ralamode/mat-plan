- **2026-10-06** — **A high advisory cleared from the production tree, and the gate that missed it
  filed.** `source-map-js` reached production through `next > postcss` and `@sentry/nextjs > next >
postcss`, carrying GHSA-68fv-2mgg-jv7q (event-loop DoS via indexed source-map section offsets).
  Pinned to `>=1.2.2` with a `pnpm-workspace.yaml` override, annotated with the advisory and the path
  so it can be dropped when postcss's range stops admitting the vulnerable version. It was found only
  because a local `pnpm verify` ran during unrelated docs work — the **second** advisory to reach
  `main` that way, which is now filed as **SEC-5** rather than left as a note.
