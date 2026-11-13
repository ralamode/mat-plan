- **2026-11-13** — **`docs/principles.md`: the eight principles every plan and PR is held to, in one
  place, with a tie-break order** ([principles](../principles.md)). Most were already written, but
  scattered across AGENTS.md, `design.md`, ADR 0001, I18N-1 and RTL-1; one, **design for scale, build
  for now**, was not written anywhere. Each principle says what it means in a PR and what enforces
  it, and links to the rule rather than restating it. The order that breaks ties is safety, privacy,
  accessibility, scope, then performance polish, which keeps ADR 0001's "wherever it doesn't fight
  scope discipline". Two principles turned out to be unenforced, so two rows are filed: **`PERF-1`**
  (real-user Web Vitals as ADR 0001's amendment specifies, plus a client-bundle budget in CI, before
  Beta 1) and **`PERF-2`** (Lighthouse CI on the pages V1-12 already scans, before the club pilot).
  AGENTS.md links the page; the roadmap's Platform pillar gains `PERF-*`.
