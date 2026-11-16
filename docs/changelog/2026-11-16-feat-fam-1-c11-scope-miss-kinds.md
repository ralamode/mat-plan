- **2026-11-16** — **FAM-1: a program, workout or prescription id from another household is now
  reported, as an athlete's already is** ([guide](../features/write-path.md); contract change C11).
  `reportScopeMiss` takes four kinds of id. Each kind has its own Sentry message (`program scope
miss: …`, `workout scope miss: …`, `prescription scope miss: …`, beside the existing `profile
scope miss: …`), all under the one `scope_outcome` tag, and the event carries the public id the
  request sent and a fixed word for its kind, with no name, no household id and no account id (the
  maintainer's two decisions, 2026-11-16). For the three new kinds the probe asks whether a live
  row with that id exists in a household that is **not** the caller's, so the household's own id
  that a page does not serve is never reported as a probe. Nothing calls the new kinds yet: the
  program builder's actions (7a) and the day page's row actions (12b) do. **One step outside the
  code:** the Sentry alert's filter text changes from `profile scope miss: cross_household` to
  `scope miss: cross_household` ([runbook](../runbooks.md)). No schema change, no new dependency.
