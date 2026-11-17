- **2026-11-17** — **A commit or PR that still holds merge-conflict markers now fails** (DX-17,
  [lessons](../lessons.md)). Twice a merge committed its markers and every check passed, because
  Prettier reflows them in a markdown table into rows and a blockquote. A guard now checks the staged
  files at commit, before Prettier rewrites them, and every tracked file in `format:check`, so in
  `pnpm verify` and CI. Its self-test runs in `guards:test`.
