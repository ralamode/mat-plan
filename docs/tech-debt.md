# Tech-debt backlog

Known, **accepted** shortcuts and rough edges — deliberate trade-offs we chose to ship, recorded so
they're paid down on purpose rather than rediscovered. This is not a bug list (those get fixed) and
not the feature backlog ([plan.md](./plan.md)); it's the "we know, and here's the plan" ledger.

Each entry: **what & why it's debt → impact → proposed fix → severity**. Newest on top. When you pay
one down, delete it (git keeps the history) and reference this file in the PR.

Related: [lessons.md](./lessons.md) (failures → fixes, so a known trap costs one attempt),
[definition-of-done.md](./definition-of-done.md). Security-specific debt also appears in
[.github/SECURITY.md](../.github/SECURITY.md); cross-link rather than duplicate.

---

## Open

### `embedded-postgres` downloads a Postgres binary on every install, incl. CI that never uses it

- **What & why (PR #43; extended by chore/local-dev-db):** the ephemeral-DB screenshot flow
  (`apps/web/scripts/screenshot-ephemeral.ts`) and now the default local-dev launcher
  (`apps/web/scripts/dev-local.ts` — `pnpm dev`) both use `embedded-postgres` (a **dev** dependency) so
  neither a screenshot nor local play touches live Neon. Its platform package
  (`@embedded-postgres/<os>-<arch>`) fetches a real Postgres binary in a `postinstall` (allow-listed in
  `pnpm-workspace.yaml`). Pinned to a **beta** (`18.4.0-beta.17`). (Two consumers now — the tool is no
  longer manual-only, which slightly raises the value of keeping the binary available, but the CI
  install-cost concern below is unchanged: CI still never runs either flow.)
- **Impact:** every `pnpm install` — including the CI `quality` and `e2e` jobs, which provision
  Postgres via a **service container** and never invoke this tool — pays the binary download. Wasted
  install time/bandwidth for a manual-only, developer-facing utility. Low correctness risk.
- **Proposed fix:** make the binary fetch **on-demand / optional** rather than install-time — e.g.
  gate the `postinstall` off a CI env flag, move `embedded-postgres` behind an optional-dependency or
  a `pnpm install --filter` boundary the screenshot script triggers itself, or lazy-install on first
  `screenshot:ephemeral` run. Also **drop the beta pin** once a stable `embedded-postgres` releases.
- **Severity:** low (works today; purely an install-cost optimization).
