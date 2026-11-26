- **2026-11-19** — **The migration snapshot chain is checked on every CI run and in `pnpm verify`.**
  `pnpm snapshots:check` (`.github/scripts/check-snapshot-chain.mjs`, with a self-test) fails when a
  snapshot's `prevId` is not the id of the snapshot before it, or is its own id (#139), the case
  `drizzle-kit check` passes. It was inline in the forward-only guard, which runs on pull requests
  only; it now runs as its own step before install, on pull requests and pushes to `main`. Gaps in
  the numbering are allowed (main has no `0018` snapshot). It refuses, rather than passes, when there
  is nothing to check or a file is malformed. [Plan](../plans/dx-snapshot-chain-script.md).
