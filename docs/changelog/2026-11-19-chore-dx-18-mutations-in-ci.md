- **2026-11-19** — **The mutation proof runs in CI.** `ci.yml` runs the patches in
  `packages/db/scripts/mutations/` as eight shards, and a `mutations-total` job checks that together
  they ran every patch exactly once. Every push to `main` runs them all, and a red run opens or
  updates one issue, "mutation gate red on main". On a pull request, `.github/scripts/changed-scopes.mjs`
  (the base's copy) decides whether the shards, `next build` and the e2e smoke are needed: a step
  skips only on a literal `false`, and any doubt runs everything. The runner gains `--shard`,
  `--only`, `--report` and `--list-paths`, and its lock moves onto the shared `pid-lock.mjs`.
  `pnpm verify` is now optional before a PR (DX-18 PR 2).
